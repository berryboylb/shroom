import { apiClient } from '../lib/apiClient';
import type { AuthSession } from '../store/authStore';

interface AuthConfig {
  google_enabled: boolean;
  google_client_id: string;
}

export const authApi = {
  loginGuest: (displayName: string) => 
    apiClient<AuthSession>('/api/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ display_name: displayName }),
    }),
  getConfig: () => apiClient<AuthConfig>('/api/auth/config', {}, false),
  getGoogleNonce: () => apiClient<{ nonce: string }>('/api/auth/google/nonce', {}, false),
  loginGoogle: (credential: string) => apiClient<AuthSession>('/api/auth/google', {
    method: 'POST',
    body: JSON.stringify({ credential }),
  }, false),
  refresh: () => fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then(async response => {
    if (!response.ok) throw new Error('Session expired');
    return response.json() as Promise<AuthSession>;
  }),
  logout: () => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }),
};
