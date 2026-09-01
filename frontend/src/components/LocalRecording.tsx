import { useCallback, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { Circle, Square } from 'lucide-react';

const MAX_RECORDING_BYTES = 100 * 1024 * 1024;

export function LocalRecording({ roomId }: { roomId: string }) {
  const { localParticipant } = useLocalParticipant();
  const [recording, setRecording] = useState(false);
  const [notice, setNotice] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const bytes = useRef(0);

  const publishStatus = useCallback((active: boolean) => {
    const payload = new TextEncoder().encode(JSON.stringify({
      type: 'recording-status',
      active,
      participant: localParticipant.name || localParticipant.identity,
    }));
    localParticipant.publishData(payload, { reliable: true });
  }, [localParticipant]);

  useDataChannel((message) => {
    try {
      const payload = JSON.parse(new TextDecoder().decode(message.payload));
      if (payload.type === 'recording-status') {
        setNotice(payload.active ? `${payload.participant || 'A participant'} started a local recording.` : 'Local recording stopped.');
      }
    } catch {
      // Ignore unrelated data-channel messages.
    }
  });

  const stop = useCallback(() => {
    if (recorder.current?.state === 'recording') recorder.current.stop();
    stream.current?.getTracks().forEach(track => track.stop());
  }, []);

  const start = async () => {
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') return;
    try {
      const capture = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const nextRecorder = new MediaRecorder(capture, MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus')
        ? { mimeType: 'video/webm;codecs=vp8,opus' }
        : undefined);
      chunks.current = [];
      bytes.current = 0;
      stream.current = capture;
      recorder.current = nextRecorder;
      nextRecorder.ondataavailable = event => {
        if (!event.data.size) return;
        bytes.current += event.data.size;
        chunks.current.push(event.data);
        if (bytes.current >= MAX_RECORDING_BYTES) {
          setNotice('Recording reached the 100 MB safety limit and was stopped.');
          stop();
        }
      };
      nextRecorder.onstop = () => {
        const blob = new Blob(chunks.current, { type: nextRecorder.mimeType || 'video/webm' });
        if (blob.size) {
          const link = document.createElement('a');
          link.href = URL.createObjectURL(blob);
          link.download = `shroom-${roomId}-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
          link.click();
          window.setTimeout(() => URL.revokeObjectURL(link.href), 1_000);
        }
        stream.current?.getTracks().forEach(track => track.stop());
        recorder.current = null;
        stream.current = null;
        setRecording(false);
        publishStatus(false);
      };
      capture.getVideoTracks()[0]?.addEventListener('ended', stop, { once: true });
      nextRecorder.start(1_000);
      setRecording(true);
      setNotice('You are recording locally. The file stays on this device.');
      publishStatus(true);
    } catch {
      setNotice('Recording was cancelled or screen capture permission was denied.');
    }
  };

  const runtimeMediaDevices = navigator.mediaDevices as unknown as { getDisplayMedia?: unknown } | undefined;
  const supported = typeof runtimeMediaDevices?.getDisplayMedia === 'function' && typeof MediaRecorder !== 'undefined';

  return (
    <>
      <button
        type="button"
        onClick={recording ? stop : start}
        disabled={!supported}
        aria-label={supported ? (recording ? 'Stop local recording' : 'Start local recording') : 'Local recording unsupported in this browser'}
        aria-pressed={recording}
        className={`absolute right-28 top-20 z-40 min-h-11 min-w-11 rounded-full p-3 text-white shadow-lg disabled:opacity-40 ${recording ? 'bg-red-600' : 'bg-slate-900/90'}`}
      >
        {recording ? <Square aria-hidden="true" className="h-5 w-5" /> : <Circle aria-hidden="true" className="h-5 w-5" />}
      </button>
      {notice && (
        <div role="status" aria-live="assertive" className="absolute left-1/2 top-32 z-50 -translate-x-1/2 rounded-xl bg-red-950/90 px-4 py-2 text-sm font-semibold text-white shadow-xl">
          {notice}
        </div>
      )}
    </>
  );
}
