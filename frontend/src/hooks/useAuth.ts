import { useCallback, useState } from 'react';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const setSession = useAuthStore(state => state.setSession);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<Error | null>(null);

  const loginGuest = useCallback((displayName: string) => {
    setIsLoggingIn(true);
    setLoginError(null);

    void authApi.loginGuest(displayName)
      .then((session) => {
        setSession(session);
      })
      .catch((error: unknown) => {
        const normalizedError = error instanceof Error ? error : new Error('Unable to sign in');
        setLoginError(normalizedError);
        console.error('Login failed:', normalizedError.message);
      })
      .finally(() => setIsLoggingIn(false));
  }, [setSession]);

  const loginGoogle = useCallback(async (credential: string) => {
    setIsLoggingIn(true);
    setLoginError(null);
    try {
      const session = await authApi.loginGoogle(credential);
      setSession(session);
      localStorage.setItem('shroom-account-session', '1');
      return session;
    } catch (error: unknown) {
      const normalizedError = error instanceof Error ? error : new Error('Unable to sign in with Google');
      setLoginError(normalizedError);
      throw normalizedError;
    } finally {
      setIsLoggingIn(false);
    }
  }, [setSession]);

  return {
    loginGuest,
    loginGoogle,
    isLoggingIn,
    loginError,
  };
}
