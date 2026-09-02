import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalRecording } from '../LocalRecording';

const getDisplayMedia = vi.fn();

vi.mock('@livekit/components-react', () => ({
  useDataChannel: vi.fn(),
  useLocalParticipant: () => ({
    localParticipant: {
      identity: 'local-user',
      name: 'Local user',
      publishData: vi.fn(),
    },
  }),
}));

describe('local recording notices', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getDisplayMedia.mockReset();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getDisplayMedia },
    });
    vi.stubGlobal('MediaRecorder', class {
      static isTypeSupported() { return true; }
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('automatically clears a cancelled screen-capture notice', async () => {
    getDisplayMedia.mockRejectedValueOnce(new DOMException('Permission denied', 'NotAllowedError'));
    render(<LocalRecording roomId="abc-defg-hij" />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start local recording' }));
      await Promise.resolve();
    });

    expect(screen.getByRole('status')).toHaveTextContent('Recording was cancelled');
    expect(screen.getByRole('button', { name: 'Dismiss recording notice' })).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(5_000));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
