package room

import (
	"net/netip"
	"testing"
)

func TestPreviewRejectsLocalAndNonWebURLs(t *testing.T) {
	for _, raw := range []string{
		"http://127.0.0.1/secret", "http://[::1]/", "http://example.com:8080/",
		"file:///etc/passwd", "https://user:pass@example.com/", "javascript:alert(1)",
	} {
		if _, err := validPreviewURL(raw); err == nil {
			t.Errorf("accepted unsafe URL %q", raw)
		}
	}
	if _, err := validPreviewURL("https://example.com/path"); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{"127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "::1", "fc00::1", "::ffff:127.0.0.1", "240.0.0.1"} {
		if allowedPreviewIP(netip.MustParseAddr(raw)) {
			t.Errorf("allowed restricted address %s", raw)
		}
	}
}
