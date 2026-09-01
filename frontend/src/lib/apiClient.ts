import { useAuthStore } from '../store/authStore';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export async function apiClient<T>(endpoint: string, options: RequestInit = {}, mayRefresh = true): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  
  const headers = new Headers(options.headers || {});
  headers.set('Content-Type', 'application/json');
  
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include',
  });

  if (response.status === 401 && mayRefresh && endpoint !== '/api/auth/guest') {
    const refresh = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refresh.ok) {
      const data = await refresh.json() as { access_token: string };
      useAuthStore.getState().setAccessToken(data.access_token);
      return apiClient<T>(endpoint, options, false);
    }
    useAuthStore.getState().clearAuth();
  }

  if (!response.ok) {
    let errorMessage = response.statusText;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorMessage;
    } catch {
      // Ignored
    }
    throw new ApiError(response.status, errorMessage);
  }

  const contentType = response.headers.get('content-type');
  if (contentType && (contentType.includes('application/json') || contentType.includes('text/plain'))) {
    return response.json();
  }
  
  return null as T;
}
