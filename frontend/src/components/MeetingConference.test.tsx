import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { MeetingConference } from './MeetingConference';

const chatState = vi.hoisted(() => ({ messages: [] as Array<{ timestamp: number; from: { identity: string }; message: string }> }));

vi.mock('@livekit/components-react', () => ({
  useTracks: () => [
    { source: 'camera', participant: { identity: 'ada', name: 'Ada', isLocal: false } },
    { source: 'screen_share', participant: { identity: 'local', name: 'You', isLocal: true } },
  ],
  useLocalParticipant: () => ({ localParticipant: { identity: 'local', setScreenShareEnabled: vi.fn() }, isScreenShareEnabled: false }),
  useChat: () => ({ chatMessages: chatState.messages }),
  useTrackRefContext: () => ({ source: 'camera', participant: { identity: 'ada', name: 'Ada', isLocal: false } }),
  GridLayout: ({ tracks, children }: { tracks: unknown[]; children: React.ReactNode }) => <div data-testid="grid" data-count={tracks.length}>{children}</div>,
  ParticipantTile: () => <div>Participant video</div>,
  ControlBar: () => <div>Call controls</div>,
  Chat: () => <div>Chat</div>,
}));

it('hides the local share preview and outlines a raised hand tile', () => {
  chatState.messages = [];
  render(<MeetingConference onLeave={vi.fn()} />);
  expect(screen.getByTestId('grid')).toHaveAttribute('data-count', '1');
  act(() => window.dispatchEvent(new CustomEvent('shroom-hands-updated', { detail: [{ participantId: 'ada', displayName: 'Ada' }] })));
  expect(screen.getByLabelText('Ada raised a hand, position 1')).toBeInTheDocument();
  expect(screen.getByText('Participant video').parentElement).toHaveClass('has-raised-hand');
  expect(screen.getByRole('button', { name: 'Share screen' }).closest('.shroom-controls')).toBeInTheDocument();
  expect(screen.getAllByText('Chat').some(element => element.closest('.shroom-conference-main'))).toBe(true);
});

it('calls leave immediately from the call controls', () => {
  chatState.messages = [];
  const onLeave = vi.fn();
  render(<MeetingConference onLeave={onLeave} />);
  fireEvent.click(screen.getByRole('button', { name: 'Leave' }));
  expect(onLeave).toHaveBeenCalledOnce();
});

it('counts unread remote chat messages and clears the count when chat opens', () => {
  chatState.messages = [];
  const { rerender } = render(<MeetingConference onLeave={vi.fn()} />);
  chatState.messages = [{ timestamp: Date.now() + 1000, from: { identity: 'ada' }, message: 'Hello' }];
  rerender(<MeetingConference onLeave={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Open chat, 1 unread messages' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open chat, 1 unread messages' }));
  expect(screen.queryByText('1')).not.toBeInTheDocument();
});
