import { useMutation, useQuery } from '@tanstack/react-query';
import { roomsApi } from '../api/rooms';
import { useAuthStore } from '../store/authStore';

export function useRooms() {
  const createRoomMutation = useMutation({
    mutationFn: (title: string) => roomsApi.createRoom(title),
    onError: (error) => {
      console.error('Failed to create room:', error.message);
    }
  });

  return {
    createRoom: createRoomMutation.mutateAsync,
    isCreatingRoom: createRoomMutation.isPending,
    createRoomError: createRoomMutation.error,
  };
}

export function useRoomToken(roomId: string | null) {
  const accessToken = useAuthStore(state => state.accessToken);

  return useQuery({
    queryKey: ['livekit-token', roomId],
    queryFn: () => roomsApi.joinRoom(roomId!),
    enabled: !!roomId && !!accessToken,
    retry: 1,
  });
}
