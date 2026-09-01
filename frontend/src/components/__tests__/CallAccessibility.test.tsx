import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../../store/authStore';
import { authApi } from '../../api/auth';
import { CallAccessibility } from '../CallAccessibility';

const localParticipant = {
  identity: 'alice',
  name: 'Alice',
  isLocal: true,
  isMicrophoneEnabled: true,
  isCameraEnabled: true,
  setMicrophoneEnabled: vi.fn(),
  setCameraEnabled: vi.fn(),
};

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({ on: vi.fn(), off: vi.fn(), disconnect: vi.fn() }),
  useParticipants: () => [localParticipant, { identity: 'bob', name: 'Bob', isLocal: false }],
  useLocalParticipant: () => ({ localParticipant }),
}));

class FakeWebSocket {
  static OPEN = 1;
  static instances: FakeWebSocket[] = [];
  readyState = FakeWebSocket.OPEN;
  sent: string[] = [];
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor() {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit('open'));
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }

  send(message: string) {
    this.sent.push(message);
    const parsed = JSON.parse(message);
    if (parsed.type === 'ws:authenticate') {
      queueMicrotask(() => this.emit('message', { data: JSON.stringify({ type: 'ws:authenticated' }) } as MessageEvent));
    }
  }

  close() {}

  emit(type: string, event = {} as MessageEvent) {
    this.listeners.get(type)?.forEach(listener => listener(event));
  }
}

describe('ordered raised hands', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    useAuthStore.getState().setAccessToken('access-token');
  });

  afterEach(() => {
    useAuthStore.getState().clearAuth();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('raises and lowers through signaling and displays server queue positions', async () => {
    render(<CallAccessibility roomId="room-1" />);
    const socket = FakeWebSocket.instances[0];

    await waitFor(() => expect(socket.sent.some(message => JSON.parse(message).type === 'room:join')).toBe(true));
    socket.emit('message', {
      data: JSON.stringify({
        type: 'hand_queue:updated',
        payload: { queue: [
          { participantId: 'bob', displayName: 'Bob', raisedAt: '2026-09-01T12:00:00Z' },
          { participantId: 'alice', displayName: 'Alice', raisedAt: '2026-09-01T12:00:01Z' },
        ] },
      }),
    } as MessageEvent);

    fireEvent.click(await screen.findByRole('button', { name: 'Toggle participant list (P)' }));
    expect(screen.getByRole('heading', { name: 'Raised hands (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lower hand, position 2' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Lower hand, position 2' }));
    expect(JSON.parse(socket.sent[socket.sent.length - 1] || '{}')).toEqual({
      type: 'room:hand:set',
      payload: { raised: false },
    });
  });

  it('refreshes authentication before reconnecting the signaling socket', async () => {
    vi.useFakeTimers();
    vi.spyOn(authApi, 'refresh').mockResolvedValue({
      access_token: 'refreshed-token',
      display_name: 'Alice',
    });
    const { unmount } = render(<CallAccessibility roomId="room-1" />);
    await vi.runAllTicks();

    FakeWebSocket.instances[0].emit('close');
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(1500);

    expect(authApi.refresh).toHaveBeenCalledOnce();
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
    await vi.runAllTicks();
    const reconnectMessages = FakeWebSocket.instances.flatMap(socket => socket.sent.map(message => JSON.parse(message)));
    expect(reconnectMessages).toContainEqual({
      type: 'ws:authenticate',
      payload: { token: 'refreshed-token' },
    });

    unmount();
    vi.useRealTimers();
  });
});
