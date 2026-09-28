package room

import (
	"context"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"regexp"
	"strings"
	"time"
)

var metaTag = regexp.MustCompile(`(?is)<meta\s+[^>]*>`)
var metaAttr = regexp.MustCompile(`(?i)([a-z-]+)\s*=\s*["']([^"']*)["']`)
var titleTag = regexp.MustCompile(`(?is)<title[^>]*>(.*?)</title>`)

type LinkPreview struct {
	URL         string `json:"url"`
	Domain      string `json:"domain"`
	Title       string `json:"title"`
	Description string `json:"description"`
	ImageURL    string `json:"image_url,omitempty"`
}

func allowedPreviewIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	blocked := []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32"}
	for _, cidr := range blocked {
		prefix := netip.MustParsePrefix(cidr)
		if prefix.Contains(ip) {
			return false
		}
	}
	return true
}

func validPreviewURL(raw string) (*url.URL, error) {
	u, err := url.Parse(raw)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Hostname() == "" || u.User != nil {
		return nil, errors.New("invalid URL")
	}
	if port := u.Port(); port != "" && port != "80" && port != "443" {
		return nil, errors.New("unsupported port")
	}
	if net.ParseIP(u.Hostname()) != nil {
		return nil, errors.New("IP addresses are not supported")
	}
	return u, nil
}

func safePreviewClient() (*http.Client, *http.Transport) {
	transport := &http.Transport{Proxy: nil, DisableKeepAlives: true, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil || len(ips) == 0 {
			return nil, errors.New("could not resolve host")
		}
		for _, ip := range ips {
			if !allowedPreviewIP(ip) {
				return nil, errors.New("host has a restricted address")
			}
		}
		return (&net.Dialer{Timeout: 2 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}}
	client := &http.Client{Transport: transport, Timeout: 4 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many redirects")
		}
		_, err := validPreviewURL(req.URL.String())
		return err
	}}
	return client, transport
}

func fetchLinkPreview(ctx context.Context, raw string) (*LinkPreview, error) {
	u, err := validPreviewURL(raw)
	if err != nil {
		return nil, err
	}
	client, transport := safePreviewClient()
	defer transport.CloseIdleConnections()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "ShroomLinkPreview/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !strings.Contains(strings.ToLower(resp.Header.Get("Content-Type")), "text/html") {
		return nil, errors.New("no HTML preview")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024))
	if err != nil {
		return nil, err
	}
	page := string(data)
	preview := &LinkPreview{URL: resp.Request.URL.String(), Domain: resp.Request.URL.Hostname()}
	for _, tag := range metaTag.FindAllString(page, -1) {
		attrs := map[string]string{}
		for _, pair := range metaAttr.FindAllStringSubmatch(tag, -1) {
			attrs[strings.ToLower(pair[1])] = html.UnescapeString(pair[2])
		}
		name := strings.ToLower(attrs["property"])
		if name == "" {
			name = strings.ToLower(attrs["name"])
		}
		if name == "og:title" || name == "twitter:title" {
			if preview.Title == "" {
				preview.Title = attrs["content"]
			}
		}
		if name == "og:description" || name == "description" {
			if preview.Description == "" {
				preview.Description = attrs["content"]
			}
		}
		if name == "og:image" && preview.ImageURL == "" {
			if image, err := resp.Request.URL.Parse(attrs["content"]); err == nil {
				if _, err := validPreviewURL(image.String()); err == nil {
					preview.ImageURL = image.String()
				}
			}
		}
	}
	if preview.Title == "" {
		if matches := titleTag.FindStringSubmatch(page); len(matches) == 2 {
			preview.Title = html.UnescapeString(matches[1])
		}
	}
	preview.Title = strings.TrimSpace(preview.Title)
	preview.Description = strings.TrimSpace(preview.Description)
	if len(preview.Title) > 160 {
		preview.Title = preview.Title[:160]
	}
	if len(preview.Description) > 280 {
		preview.Description = preview.Description[:280]
	}
	if preview.Title == "" {
		preview.Title = preview.Domain
	}
	return preview, nil
}

func (h *Handler) HandleLinkPreviewImage(w http.ResponseWriter, r *http.Request) {
	raw := r.URL.Query().Get("url")
	if len(raw) > 2048 {
		http.Error(w, "URL too long", http.StatusBadRequest)
		return
	}
	u, err := validPreviewURL(raw)
	if err != nil {
		http.Error(w, "Invalid image URL", http.StatusBadRequest)
		return
	}
	client, transport := safePreviewClient()
	defer transport.CloseIdleConnections()
	req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, u.String(), nil)
	if err != nil {
		http.Error(w, "Invalid image URL", http.StatusBadRequest)
		return
	}
	resp, err := client.Do(req)
	if err != nil {
		http.Error(w, "Image unavailable", http.StatusUnprocessableEntity)
		return
	}
	defer resp.Body.Close()
	contentType := strings.ToLower(strings.Split(resp.Header.Get("Content-Type"), ";")[0])
	if resp.StatusCode != http.StatusOK || (contentType != "image/jpeg" && contentType != "image/png" && contentType != "image/webp") || resp.ContentLength > 256*1024 {
		http.Error(w, "Image unavailable", http.StatusUnprocessableEntity)
		return
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 256*1024+1))
	if err != nil || len(data) > 256*1024 {
		http.Error(w, "Image unavailable", http.StatusUnprocessableEntity)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(data)
}

func (h *Handler) HandleLinkPreview(w http.ResponseWriter, r *http.Request) {
	if len(r.URL.Query().Get("url")) > 2048 {
		http.Error(w, "URL too long", http.StatusBadRequest)
		return
	}
	preview, err := fetchLinkPreview(r.Context(), r.URL.Query().Get("url"))
	if err != nil {
		http.Error(w, "Preview unavailable", http.StatusUnprocessableEntity)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "private, max-age=300")
	json.NewEncoder(w).Encode(preview)
}
