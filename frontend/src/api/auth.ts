import { apiClient } from '../lib/apiClient';

interface LoginResponse {
  access_token: string;
  display_name: string;
}

export const authApi = {
  loginGuest: (displayName: string) => 
    apiClient<LoginResponse>('/api/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ display_name: displayName }),
    }),
  refresh: () => fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then(async response => {
    if (!response.ok) throw new Error('Session expired');
    return response.json() as Promise<LoginResponse>;
  }),
  logout: () => fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }),
};
