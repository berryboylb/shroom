import { useMutation } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const setAccessToken = useAuthStore(state => state.setAccessToken);

  const loginMutation = useMutation({
    mutationFn: (displayName: string) => authApi.loginGuest(displayName),
    onSuccess: (data) => {
      setAccessToken(data.access_token);
    },
    onError: (error) => {
      // Centralized error handling could integrate with a Toast library here
      console.error('Login failed:', error.message);
    },
  });

  return {
    loginGuest: loginMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
  };
}
