import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { roomsApi } from './api/rooms';

vi.mock('./hooks/useAuth', () => ({
  useAuth: () => ({ loginGuest: vi.fn(), isLoggingIn: false, loginError: null }),
}));

vi.mock('./store/authStore', () => ({
  useAuthStore: (selector: (state: {
    accessToken: string;
    displayName: string;
    isGuest: boolean;
    avatarUrl: null;
    setSession: ReturnType<typeof vi.fn>;
    clearAuth: ReturnType<typeof vi.fn>;
  }) => unknown) => selector({
    accessToken: 'guest-token',
    displayName: 'Femi',
    isGuest: true,
    avatarUrl: null,
    setSession: vi.fn(),
    clearAuth: vi.fn(),
  }),
}));

vi.mock('./api/rooms', () => ({
  roomsApi: {
    createRoom: vi.fn(),
    joinRoom: vi.fn(),
  },
}));

vi.mock('./components/PreJoinScreen', () => ({
  PreJoinScreen: ({ roomId, encrypted, onJoin }: { roomId: string; encrypted?: boolean; onJoin: (mic: boolean, cam: boolean) => void }) => (
    <div data-testid="prejoin">
      Device choices for {roomId}{encrypted ? ' (Encrypted)' : ''}
      <button onClick={() => onJoin(false, false)}>Confirm devices</button>
    </div>
  ),
}));

vi.mock('./components/Room', () => ({
  Room: ({ roomId }: { roomId: string }) => <div data-testid="room">Meeting {roomId}</div>,
}));

vi.mock('./components/GoogleLoginPage', () => ({
  GoogleLoginPage: () => <div data-testid="google-login-page">Google login</div>,
}));

describe('room entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  const expectDeviceGate = async (roomId: string) => {
    expect(await screen.findByTestId('prejoin')).toHaveTextContent(roomId);
    expect(screen.queryByTestId('room')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm devices' }));

    await waitFor(() => expect(screen.getByTestId('room')).toHaveTextContent(roomId));
  };

  it('uses a dedicated login page', async () => {
    window.history.replaceState({}, '', '/login');
    render(<App />);
    expect(await screen.findByTestId('google-login-page')).toBeInTheDocument();
  });

  it('requires device confirmation when creating a room', async () => {
    vi.mocked(roomsApi.createRoom).mockResolvedValue({ ID: 'new-room-id', Title: 'Instant Room' });
    vi.mocked(roomsApi.joinRoom).mockResolvedValue({
      room_id: 'new-room-id',
      livekit_token: 'new-room-token',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Start Instant Call/i }));

    await expectDeviceGate('new-room-id');
  });

  it('asks for host approval without entering the media room', async () => {
    vi.mocked(roomsApi.joinRoom).mockResolvedValue({ room_id: 'secure-room', status: 'pending' });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Join with link' }));
    fireEvent.change(await screen.findByPlaceholderText('Paste room link or code'), { target: { value: 'secure-room' } });
    fireEvent.click(screen.getByRole('button', { name: /Join Call/i }));
    expect(await screen.findByTestId('prejoin')).toHaveTextContent('secure-room');
    expect(roomsApi.joinRoom).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm devices' }));
    expect(await screen.findByText('Waiting for the host')).toBeInTheDocument();
    expect(screen.queryByTestId('room')).not.toBeInTheDocument();
  });

  it('requires device confirmation when manually joining by code', async () => {
    vi.mocked(roomsApi.joinRoom).mockResolvedValue({
      room_id: 'abc-defg-hij',
      livekit_token: 'joined-room-token',
    });

    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Join with link' }));
    fireEvent.change(await screen.findByPlaceholderText('Paste room link or code'), {
      target: { value: 'abc-defg-hij' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Join Call/i }));

    await expectDeviceGate('abc-defg-hij');
  });

  it('requires device confirmation when opening a shared room URL', async () => {
    window.history.replaceState({}, '', '/abc-defg-hij');
    vi.mocked(roomsApi.joinRoom).mockResolvedValue({
      room_id: 'abc-defg-hij',
      livekit_token: 'shared-room-token',
    });

    render(<App />);

    await expectDeviceGate('abc-defg-hij');
  });

  it('keeps an encrypted invite key in the private URL fragment while gating entry', async () => {
    window.history.replaceState({}, '', '/secure-room#key=private-secret');
    vi.mocked(roomsApi.joinRoom).mockResolvedValue({
      room_id: 'secure-room',
      livekit_token: 'secure-room-token',
    });

    render(<App />);

    expect(await screen.findByTestId('prejoin')).toHaveTextContent('secure-room (Encrypted)');
    expect(roomsApi.joinRoom).not.toHaveBeenCalled();
    expect(screen.queryByTestId('room')).not.toBeInTheDocument();
  });

  it('resumes directly when refreshing the exact room active in this tab', async () => {
    window.history.replaceState({}, '', '/abc-defg-hij');
    sessionStorage.setItem('activeRoom', JSON.stringify({
      id: 'abc-defg-hij',
      url: 'ws://localhost',
      token: 'previous-livekit-token',
    }));

    render(<App />);

    expect(await screen.findByTestId('room')).toHaveTextContent('abc-defg-hij');
    expect(screen.queryByTestId('prejoin')).not.toBeInTheDocument();
    expect(roomsApi.joinRoom).not.toHaveBeenCalled();
  });

  it('does not treat a saved session for another room as permission to skip pre-join', async () => {
    window.history.replaceState({}, '', '/shared-room');
    sessionStorage.setItem('activeRoom', JSON.stringify({
      id: 'different-room',
      url: 'ws://localhost',
      token: 'different-room-token',
    }));
    vi.mocked(roomsApi.joinRoom).mockResolvedValue({
      room_id: 'shared-room',
      livekit_token: 'shared-room-token',
    });

    render(<App />);

    await expectDeviceGate('shared-room');
  });
});
