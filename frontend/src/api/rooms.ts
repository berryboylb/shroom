import { apiClient } from '../lib/apiClient';

interface RoomResponse {
  ID: string;
  Title: string;
}

interface JoinRoomResponse {
  livekit_token: string;
  room_id: string;
}

export const roomsApi = {
  createRoom: (title: string) =>
    apiClient<RoomResponse>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
    
  joinRoom: (roomId: string) =>
    apiClient<JoinRoomResponse>(`/api/rooms/${roomId}/join`, {
      method: 'POST',
    }),
};
