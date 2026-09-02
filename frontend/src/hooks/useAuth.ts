import { useCallback, useState } from 'react';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const setAccessToken = useAuthStore(state => state.setAccessToken);
  const setDisplayName = useAuthStore(state => state.setDisplayName);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<Error | null>(null);

  const loginGuest = useCallback((displayName: string) => {
    setIsLoggingIn(true);
    setLoginError(null);

    void authApi.loginGuest(displayName)
      .then((session) => {
        setAccessToken(session.access_token);
        setDisplayName(session.display_name);
      })
      .catch((error: unknown) => {
        const normalizedError = error instanceof Error ? error : new Error('Unable to sign in');
        setLoginError(normalizedError);
        console.error('Login failed:', normalizedError.message);
      })
      .finally(() => setIsLoggingIn(false));
  }, [setAccessToken, setDisplayName]);

  return {
    loginGuest,
    isLoggingIn,
    loginError,
  };
}
