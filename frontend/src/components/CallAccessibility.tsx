import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalParticipant, useParticipants, useRoomContext } from '@livekit/components-react';
import { LocalVideoTrack, RoomEvent, Track, supportsAudioOutputSelection } from 'livekit-client';
import { Hand, Users, X, SwitchCamera } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { authApi } from '../api/auth';
import { getSoundPreference, playHandChime, setSoundPreference, type SoundPreference } from '../utils/audio';
import { LightVideoEnhancement } from '../lib/videoEnhancement';

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

export function CallAccessibility({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
  const room = useRoomContext();
  const participants = useParticipants();
  const { localParticipant } = useLocalParticipant();
  const localParticipantId = localParticipant.identity;
  const accessToken = useAuthStore(state => state.accessToken);
  const setAccessToken = useAuthStore(state => state.setAccessToken);
  const setDisplayName = useAuthStore(state => state.setDisplayName);
  const [announcement, setAnnouncement] = useState('Call connected');
  const [showParticipants, setShowParticipants] = useState(false);
  const [raisedHands, setRaisedHands] = useState<RaisedHand[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const raisedHandsRef = useRef<RaisedHand[]>([]);
  const pendingHandState = useRef<boolean | null>(null);
  const receivedHandQueue = useRef(false);
  const [soundPreference, updateSoundPreference] = useState<SoundPreference>(getSoundPreference);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedOutput, setSelectedOutput] = useState(() => localStorage.getItem('shroom-audio-output') || 'default');
  const [deviceError, setDeviceError] = useState('');
  const [enhancementEnabled, setEnhancementEnabled] = useState(false);
  const pushToTalkWasMuted = useRef(false);

  const localHandPosition = raisedHands.findIndex(hand => hand.participantId === localParticipant.identity);
  const isHandRaised = localHandPosition >= 0;

  useEffect(() => {
    const refresh = () => void navigator.mediaDevices?.enumerateDevices().then(setDevices).catch(() => {});
    refresh();
    navigator.mediaDevices?.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', refresh);
  }, []);

  const flipCamera = async () => {
    const cameras = devices.filter(device => device.kind === 'videoinput' && device.deviceId);
    try {
      if (cameras.length >= 2) {
        const current = room.getActiveDevice('videoinput');
        const next = cameras[(cameras.findIndex(device => device.deviceId === current) + 1) % cameras.length];
        await room.switchActiveDevice('videoinput', next.deviceId);
      } else {
        const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
        if (!(track instanceof LocalVideoTrack)) throw new Error('Camera unavailable');
        const current = track.mediaStreamTrack.getSettings().facingMode;
        await track.restartTrack({ facingMode: current === 'environment' ? 'user' : 'environment' });
      }
      setDeviceError('');
    }
    catch { setDeviceError('Could not switch camera.'); }
  };

  const changeOutput = async (deviceId: string) => {
    try {
      await room.switchActiveDevice('audiooutput', deviceId);
      localStorage.setItem('shroom-audio-output', deviceId);
      setSelectedOutput(deviceId);
      setDeviceError('');
    } catch { setDeviceError('Could not switch speaker. Use your system sound settings.'); }
  };

  const toggleEnhancement = async () => {
    const track = localParticipant.getTrackPublication(Track.Source.Camera)?.track;
    if (!(track instanceof LocalVideoTrack)) { setDeviceError('Turn on your camera first.'); return; }
    try {
      if (enhancementEnabled) await track.stopProcessor();
      else await track.setProcessor(new LightVideoEnhancement());
      setEnhancementEnabled(value => !value);
      setDeviceError('');
    } catch { setDeviceError('Video enhancement is unavailable on this device.'); }
  };

  useEffect(() => {
    if (!accessToken) return;
    let disposed = false;
    let reconnectTimer: number | undefined;

    const connect = (token: string) => {
      receivedHandQueue.current = false;
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
            if (pendingHandState.current !== null) {
              socket.send(JSON.stringify({
                type: 'room:hand:set',
                payload: { raised: pendingHandState.current },
              }));
              pendingHandState.current = null;
            }
          } else if (message.type === 'hand_queue:updated' && Array.isArray(message.payload?.queue)) {
            const nextHands = message.payload.queue as RaisedHand[];
            const previousIds = new Set(raisedHandsRef.current.map(hand => hand.participantId));
            const newRemoteHand = nextHands.some(hand =>
              hand.participantId !== localParticipantId && !previousIds.has(hand.participantId)
            );
            raisedHandsRef.current = nextHands;
            setRaisedHands(nextHands);
            window.dispatchEvent(new CustomEvent('shroom-hands-updated', { detail: nextHands }));
            if (newRemoteHand && receivedHandQueue.current) {
              playHandChime();
              setAnnouncement('A participant raised their hand');
            }
            receivedHandQueue.current = true;
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
  }, [accessToken, localParticipantId, roomId, setAccessToken, setDisplayName]);

  const toggleHand = useCallback(() => {
    const nextRaised = !isHandRaised;
    if (nextRaised) playHandChime();
    const message = {
      type: 'room:hand:set',
      payload: { raised: nextRaised },
    };
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify(message));
    } else {
      pendingHandState.current = nextRaised;
    }
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
        onLeave();
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
  }, [localParticipant, room, toggleHand, onLeave]);

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
      {(devices.filter(device => device.kind === 'videoinput').length > 1 || navigator.maxTouchPoints > 0) && <button type="button" className="shroom-call-tool shroom-call-tool-flip" aria-label="Flip camera" onClick={() => void flipCamera()}><SwitchCamera aria-hidden="true" className="h-5 w-5" /></button>}
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
          <label className="mt-4 block text-sm text-white/75" htmlFor="call-sounds">Call sounds</label>
          <select id="call-sounds" className="shroom-input mt-2 w-full" value={soundPreference} onChange={event => {
            const value = event.target.value as SoundPreference;
            setSoundPreference(value);
            updateSoundPreference(value);
          }}>
            <option value="all">Join, leave, and hands</option>
            <option value="hands">Raised hands only</option>
            <option value="off">Off</option>
          </select>
          {supportsAudioOutputSelection() ? <>
            <label className="mt-4 block text-sm text-white/75" htmlFor="call-speaker">Speaker</label>
            <select id="call-speaker" className="shroom-input mt-2 w-full" value={selectedOutput} onChange={event => void changeOutput(event.target.value)}>
              <option value="default">System default</option>
              {devices.filter(device => device.kind === 'audiooutput' && device.deviceId !== 'default').map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Speaker'}</option>)}
            </select>
          </> : <p className="mt-4 text-xs text-white/50">Speaker selection is controlled by your browser or device.</p>}
          <label className="mt-4 flex items-center gap-3 text-sm text-white/75"><input type="checkbox" checked={enhancementEnabled} onChange={() => void toggleEnhancement()} /> Enhance video</label>
          {deviceError && <p role="alert" className="mt-3 text-sm text-amber-300">{deviceError}</p>}
        </aside>
      )}
    </>
  );
}
