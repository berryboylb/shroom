import { Fragment, useEffect, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { useAuthStore } from '../../store/authStore';

const urlPattern = /https?:\/\/[^\s<]+|\b(?:www\.)[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s<]*)?/gi;

export function LinkifiedMessage({ message }: { message: string }) {
  const [preview, setPreview] = useState<{url: string; domain: string; title: string; description: string; image_url?: string} | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const firstUrl = message.match(urlPattern)?.[0];
  useEffect(() => {
    if (!firstUrl) return;
    let alive = true;
    const clean = firstUrl.replace(/[),.!?;:]+$/, '');
    const url = clean.startsWith('http') ? clean : `https://${clean}`;
    void apiClient<{url: string; domain: string; title: string; description: string; image_url?: string}>(`/api/link-preview?url=${encodeURIComponent(url)}`).then(data => {
      if (alive) setPreview(data);
    }).catch(() => {});
    return () => { alive = false; };
  }, [firstUrl]);
  useEffect(() => {
    if (!preview?.image_url) return;
    let alive = true;
    let objectUrl: string | undefined;
    const token = useAuthStore.getState().accessToken;
    void fetch(`/api/link-preview/image?url=${encodeURIComponent(preview.image_url)}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }).then(async response => {
      if (!response.ok) throw new Error('Image unavailable');
      return response.blob();
    }).then(blob => {
      if (!alive) return;
      objectUrl = URL.createObjectURL(blob);
      setImageUrl(objectUrl);
    }).catch(() => {});
    return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [preview?.image_url]);
  const content = [];
  let last = 0;
  for (const match of message.matchAll(urlPattern)) {
    const index = match.index;
    content.push(message.slice(last, index));
    const raw = match[0];
    const clean = raw.replace(/[),.!?;:]+$/, '');
    const trailing = raw.slice(clean.length);
    const href = clean.startsWith('http') ? clean : `https://${clean}`;
    let safeUrl: string | null = null;
    try {
      const url = new URL(href);
      if (url.protocol === 'https:' || url.protocol === 'http:') safeUrl = url.href;
    } catch { /* Invalid URLs remain plain text. */ }
    if (safeUrl) content.push(<a key={index} href={safeUrl} target="_blank" rel="noopener noreferrer" className="shroom-chat-link">{clean}</a>);
    else content.push(clean);
    content.push(trailing);
    last = index + raw.length;
  }
  content.push(message.slice(last));
  return <Fragment>{content}{preview && <a className="shroom-link-preview" href={preview.url} target="_blank" rel="noopener noreferrer">
    {imageUrl && <img src={imageUrl} alt="" className="shroom-link-preview-image" />}
    <span className="shroom-link-preview-domain">{preview.domain}</span>
    <strong>{preview.title}</strong>
    {preview.description && <span>{preview.description}</span>}
  </a>}</Fragment>;
}
