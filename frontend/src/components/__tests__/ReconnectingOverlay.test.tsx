import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectionState } from 'livekit-client';
import { ReconnectingOverlay } from '../ReconnectingOverlay';

let connectionState = ConnectionState.Connected;

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({}),
  useConnectionState: () => connectionState,
}));

describe('reconnection recovery UI', () => {
  afterEach(() => {
    vi.useRealTimers();
    connectionState = ConnectionState.Connected;
  });

  it('hides brief network blips and announces sustained reconnection', () => {
    vi.useFakeTimers();
    connectionState = ConnectionState.Reconnecting;
    render(<ReconnectingOverlay />);

    act(() => { vi.advanceTimersByTime(2_999); });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('alert')).toHaveTextContent('Reconnecting');
    expect(screen.getByText(/resume automatically/)).toBeInTheDocument();
  });
});
