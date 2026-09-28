import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { HostApproval } from './HostApproval';
import { roomsApi } from '../api/rooms';

vi.mock('../api/rooms', () => ({ roomsApi: { pendingRequests: vi.fn(), decideRequest: vi.fn() } }));

beforeEach(() => {
  vi.mocked(roomsApi.pendingRequests).mockResolvedValue([{ participant_id: 'guest-1', display_name: 'Ada', requested_at: new Date().toISOString() }]);
  vi.mocked(roomsApi.decideRequest).mockResolvedValue(undefined);
});

it('lets the host admit a waiting participant', async () => {
  render(<HostApproval roomId="room-1" />);
  fireEvent.click(await screen.findByRole('button', { name: /Join requests 1/ }));
  expect(screen.getByText('Ada')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Admit' }));
  await waitFor(() => expect(roomsApi.decideRequest).toHaveBeenCalledWith('room-1', 'guest-1', true));
});
