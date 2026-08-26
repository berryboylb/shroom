import { apiClient } from '../lib/apiClient';

interface LoginResponse {
  access_token: string;
}

export const authApi = {
  loginGuest: (displayName: string) => 
    apiClient<LoginResponse>('/api/auth/guest', {
      method: 'POST',
      body: JSON.stringify({ display_name: displayName }),
    }),
};
