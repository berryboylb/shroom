import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NetworkHealthOverlay } from '../NetworkHealthOverlay';
import { ConnectionQuality } from 'livekit-client';
import * as livekitComponents from '@livekit/components-react';

vi.mock('@livekit/components-react', () => ({
  useLocalParticipant: vi.fn(),
}));

describe('NetworkHealthOverlay', () => {
  it('does not render when quality is excellent', () => {
    vi.mocked(livekitComponents.useLocalParticipant).mockReturnValue({
      localParticipant: { connectionQuality: ConnectionQuality.Excellent }
    } as any);
    const { container } = render(<NetworkHealthOverlay />);
    expect(container.firstChild).toBeNull();
  });

  it('renders poor network warning when quality drops', () => {
    vi.mocked(livekitComponents.useLocalParticipant).mockReturnValue({
      localParticipant: { connectionQuality: ConnectionQuality.Poor }
    } as any);
    render(<NetworkHealthOverlay />);
    expect(screen.getByText('Poor Network Connection')).toBeDefined();
  });
});
