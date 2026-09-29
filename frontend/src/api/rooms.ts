import { apiClient } from '../lib/apiClient';

interface RoomResponse {
  ID: string;
  Title: string;
  ApprovalRequired?: boolean;
}

export interface JoinRoomResponse {
  livekit_token?: string;
  room_id: string;
  status?: 'pending';
  is_host?: boolean;
  approval_required?: boolean;
}

export const roomsApi = {
  createRoom: (title: string, approvalRequired = false) =>
    apiClient<RoomResponse>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({ title, approval_required: approvalRequired }),
    }),
    
  joinRoom: (roomId: string) =>
    apiClient<JoinRoomResponse>(`/api/rooms/${roomId}/join`, {
      method: 'POST',
    }),
  pendingRequests: (roomId: string) => apiClient<Array<{participant_id: string; display_name: string; requested_at: string}>>(`/api/rooms/${roomId}/requests`),
  decideRequest: (roomId: string, participantId: string, approve: boolean) => apiClient<void>(`/api/rooms/${roomId}/requests/decision`, {
    method: 'POST', body: JSON.stringify({ participant_id: participantId, approve }),
  }),
  cancelRequest: (roomId: string) => apiClient<void>(`/api/rooms/${roomId}/requests/cancel`, { method: 'POST' }),
  sendFeedback: (roomId: string, rating: 'good' | 'problem', issue = '', note = '') => apiClient<void>(`/api/rooms/${roomId}/feedback`, {
    method: 'POST', body: JSON.stringify({ rating, issue, note }),
  }),
};
