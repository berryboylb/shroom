import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetworkHealthOverlay } from '../NetworkHealthOverlay';
import * as livekitComponents from '@livekit/components-react';

vi.mock('@livekit/components-react', () => ({
  useLocalParticipant: vi.fn(),
  useRoomContext: () => ({ on: vi.fn(), off: vi.fn() }),
}));

describe('NetworkHealthOverlay', () => {
  it('does not render before quality metrics are available', () => {
    vi.mocked(livekitComponents.useLocalParticipant).mockReturnValue({
      localParticipant: {
        identity: 'tester',
        videoTrackPublications: new Map(),
        audioTrackPublications: new Map(),
      }
    } as any);
    const { container } = render(<NetworkHealthOverlay roomId="room-one" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders an audio-first warning when measured quality drops', async () => {
    const stats = new Map([
      ['audio', { id: 'audio', type: 'outbound-rtp', kind: 'audio', packetsSent: 100, bytesSent: 1000, remoteId: 'remote' }],
      ['remote', { id: 'remote', type: 'remote-inbound-rtp', packetsLost: 8, roundTripTime: 0.4, jitter: 0.04 }],
      ['pair', { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, availableOutgoingBitrate: 200_000 }],
    ]);
    vi.mocked(livekitComponents.useLocalParticipant).mockReturnValue({
      localParticipant: {
        identity: 'tester',
        isCameraEnabled: false,
        videoTrackPublications: new Map(),
        audioTrackPublications: new Map([['mic', { track: { getRTCStatsReport: vi.fn().mockResolvedValue(stats) } }]]),
      }
    } as any);
    render(<NetworkHealthOverlay roomId="room-one" />);
    expect(await screen.findByText(/Video paused/)).toBeDefined();
  });
});
