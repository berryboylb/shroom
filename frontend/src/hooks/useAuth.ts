import { useMutation } from '@tanstack/react-query';
import { authApi } from '../api/auth';
import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const setAccessToken = useAuthStore(state => state.setAccessToken);
  const setDisplayName = useAuthStore(state => state.setDisplayName);

  const loginMutation = useMutation({
    mutationFn: (displayName: string) => authApi.loginGuest(displayName).then(res => ({ ...res, displayName })),
    onSuccess: (data) => {
      setAccessToken(data.access_token);
      setDisplayName(data.displayName);
    },
    onError: (error) => {
      console.error('Login failed:', error.message);
    },
  });

  return {
    loginGuest: loginMutation.mutate,
    isLoggingIn: loginMutation.isPending,
    loginError: loginMutation.error,
  };
}
