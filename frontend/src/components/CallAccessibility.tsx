import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalParticipant, useParticipants, useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { Hand, Users, X } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';

interface RaisedHand {
  participantId: string;
  displayName: string;
  raisedAt: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (
    target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  );
}

export function CallAccessibility({ roomId }: { roomId: string }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const accessToken = useAuthStore(state => state.accessToken);
  const setAccessToken = useAuthStore(state => state.setAccessToken);
  const setDisplayName = useAuthStore(state => state.setDisplayName);
  const [announcement, setAnnouncement] = useState('Call connected');
  const [showParticipants, setShowParticipants] = useState(false);
  const [raisedHands, setRaisedHands] = useState<RaisedHand[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const pushToTalkWasMuted = useRef(false);

  const localHandPosition = raisedHands.findIndex(hand => hand.participantId === localParticipant.identity);
  const isHandRaised = localHandPosition >= 0;

  useEffect(() => {
    if (!accessToken) return;
    let disposed = false;
    let reconnectTimer: number | undefined;

    const connect = (token: string) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
      socketRef.current = socket;
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ type: 'ws:authenticate', payload: { token } }));
      });
      socket.addEventListener('message', event => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'ws:authenticated') {
            socket.send(JSON.stringify({ type: 'room:join', payload: { roomId } }));
          } else if (message.type === 'hand_queue:updated' && Array.isArray(message.payload?.queue)) {
            setRaisedHands(message.payload.queue);
          }
        } catch {
          // Ignore malformed signaling messages; the call itself remains usable.
        }
      });
      socket.addEventListener('close', async () => {
        if (disposed) return;
        try {
          const session = await authApi.refresh();
          if (disposed) return;
          setAccessToken(session.access_token);
          setDisplayName(session.display_name);
          reconnectTimer = window.setTimeout(() => connect(session.access_token), 1500);
        } catch {
          if (!disposed) reconnectTimer = window.setTimeout(() => connect(token), 1500);
        }
      });
    };

    connect(accessToken);
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [accessToken, roomId, setAccessToken, setDisplayName]);

  const toggleHand = useCallback(() => {
    const nextRaised = !isHandRaised;
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      setAnnouncement('Hand raise is reconnecting. Try again shortly.');
      return;
    }
    socketRef.current.send(JSON.stringify({
      type: 'room:hand:set',
      payload: { raised: nextRaised },
    }));
    setAnnouncement(nextRaised ? 'Hand raise requested' : 'Hand lower requested');
  }, [isHandRaised]);

  useEffect(() => {
    const grid = document.querySelector<HTMLElement>('.lk-video-conference');
    grid?.setAttribute('tabindex', '-1');
    grid?.focus({ preventScroll: true });

    const joined = (participant: { name?: string; identity: string }) =>
      setAnnouncement(`${participant.name || participant.identity} joined the call`);
    const left = (participant: { name?: string; identity: string }) =>
      setAnnouncement(`${participant.name || participant.identity} left the call`);
    room.on(RoomEvent.ParticipantConnected, joined);
    room.on(RoomEvent.ParticipantDisconnected, left);
    return () => {
      room.off(RoomEvent.ParticipantConnected, joined);
      room.off(RoomEvent.ParticipantDisconnected, left);
    };
  }, [room]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.repeat && event.code !== 'Space') return;

      if (event.key.toLowerCase() === 'm') {
        localParticipant.setMicrophoneEnabled(!localParticipant.isMicrophoneEnabled);
        setAnnouncement(localParticipant.isMicrophoneEnabled ? 'Microphone muted' : 'Microphone on');
      } else if (event.key.toLowerCase() === 'v') {
        localParticipant.setCameraEnabled(!localParticipant.isCameraEnabled);
        setAnnouncement(localParticipant.isCameraEnabled ? 'Camera off' : 'Camera on');
      } else if (event.key.toLowerCase() === 'l') {
        room.disconnect();
      } else if (event.key.toLowerCase() === 'p') {
        setShowParticipants(value => !value);
      } else if (event.key.toLowerCase() === 'r') {
        toggleHand();
      } else if (event.code === 'Space' && !event.repeat) {
        event.preventDefault();
        pushToTalkWasMuted.current = !localParticipant.isMicrophoneEnabled;
        if (pushToTalkWasMuted.current) localParticipant.setMicrophoneEnabled(true);
        setAnnouncement('Push to talk active');
      } else if (event.key === 'Escape') {
        setShowParticipants(false);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space' && pushToTalkWasMuted.current && !isTypingTarget(event.target)) {
        event.preventDefault();
        localParticipant.setMicrophoneEnabled(false);
        pushToTalkWasMuted.current = false;
        setAnnouncement('Microphone muted');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [localParticipant, room, toggleHand]);

  return (
    <>
      <div className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</div>
      <button
        type="button"
        aria-label="Toggle participant list (P)"
        aria-expanded={showParticipants}
        onClick={() => setShowParticipants(value => !value)}
        className="shroom-call-tool shroom-call-tool-participants"
      >
        <Users aria-hidden="true" className="h-5 w-5" />
      </button>
      <button
        type="button"
        aria-label={isHandRaised ? `Lower hand, position ${localHandPosition + 1}` : 'Raise hand (R)'}
        aria-pressed={isHandRaised}
        onClick={toggleHand}
        className={`shroom-call-tool shroom-call-tool-hand ${isHandRaised ? 'is-raised' : ''}`}
      >
        <Hand aria-hidden="true" className="h-5 w-5" />
        {isHandRaised && (
          <span className="absolute -right-1 -top-1 flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-1 text-xs font-bold text-slate-950">
            {localHandPosition + 1}
          </span>
        )}
      </button>
      {showParticipants && (
        <aside
          aria-label="Participants"
          className="shroom-participant-panel"
        >
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold">Participants <span className="text-white/45">({participants.length})</span></h2>
            <button
              type="button"
              aria-label="Close participant list"
              onClick={() => setShowParticipants(false)}
              className="shroom-panel-close"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </button>
          </div>
          {raisedHands.length > 0 && (
            <section aria-labelledby="raised-hands-heading" className="mb-4">
              <h3 id="raised-hands-heading" className="mb-2 text-sm font-semibold text-amber-300">
                Raised hands ({raisedHands.length})
              </h3>
              <ol className="space-y-2">
                {raisedHands.map((hand, index) => (
                  <li key={hand.participantId} className="flex items-center gap-2 rounded-xl bg-amber-500/15 px-3 py-2">
                    <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-400 text-xs font-bold text-slate-950">{index + 1}</span>
                    <Hand aria-hidden="true" className="h-4 w-4 text-amber-300" />
                    <span>{hand.displayName}{hand.participantId === localParticipant.identity ? ' (You)' : ''}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <ul className="space-y-2">
            {participants.map(participant => (
              <li key={participant.identity} className="flex items-center justify-between rounded-xl bg-slate-800 px-3 py-2">
                <span>{participant.name || participant.identity}{participant.isLocal ? ' (You)' : ''}</span>
                {raisedHands.findIndex(hand => hand.participantId === participant.identity) >= 0 && (
                  <span className="text-sm text-amber-300" aria-label={`Hand raised, position ${raisedHands.findIndex(hand => hand.participantId === participant.identity) + 1}`}>
                    ✋ {raisedHands.findIndex(hand => hand.participantId === participant.identity) + 1}
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="sr-only">Shortcuts: M microphone, V camera, L leave, R raise hand, hold Space to talk, P participants.</p>
        </aside>
      )}
    </>
  );
}
