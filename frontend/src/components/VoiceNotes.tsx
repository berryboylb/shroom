import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Mic, Square } from 'lucide-react';
import { useLocalParticipant, useRoomContext } from '@livekit/components-react';

const VOICE_NOTE_TOPIC = 'shroom-voice-note';
const MAX_DURATION_SECONDS = 60;
const MAX_BYTES = 750_000;

type VoiceNote = {
  id: string;
  sender: string;
  url: string;
  timestamp: number;
  local: boolean;
};

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}

function copyChunk(chunk: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(new ArrayBuffer(chunk.byteLength));
  copy.set(chunk);
  return copy.buffer;
}

function VoiceNotePlayer({ note }: { note: VoiceNote }) {
  const [playbackError, setPlaybackError] = useState(false);
  const time = new Date(note.timestamp).toLocaleTimeString(navigator.language, { timeStyle: 'short' });

  return (
    <li className="lk-chat-entry shroom-voice-note" data-lk-message-origin={note.local ? 'local' : 'remote'}>
      <span className="lk-meta-data shroom-voice-note-meta">
        <strong className="lk-participant-name">{note.sender}</strong>
        <span className="lk-timestamp">{time}</span>
      </span>
      <span className="lk-message-body shroom-voice-note-body">
        <audio
          controls
          controlsList="nodownload noplaybackrate"
          preload="metadata"
          src={note.url}
          aria-label={`Voice note from ${note.sender}`}
          onCanPlay={() => setPlaybackError(false)}
          onError={() => setPlaybackError(true)}
        />
        {playbackError && <span role="alert" className="shroom-voice-note-playback-error">This recording could not be played.</span>}
      </span>
    </li>
  );
}

export function VoiceNotes() {
  const room = useRoomContext();
  const { localParticipant } = useLocalParticipant();
  const [formTarget, setFormTarget] = useState<HTMLFormElement | null>(null);
  const [listTarget, setListTarget] = useState<HTMLUListElement | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef<number | undefined>(undefined);
  const timeoutRef = useRef<number | undefined>(undefined);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    room.registerByteStreamHandler(VOICE_NOTE_TOPIC, async (reader, participantInfo) => {
      if ((reader.info.size ?? 0) > MAX_BYTES || !reader.info.mimeType.startsWith('audio/')) return;
      try {
        const chunks = await reader.readAll({ signal: AbortSignal.timeout(30_000) });
        const blob = new Blob(chunks.map(copyChunk), { type: reader.info.mimeType });
        if (!blob.size || blob.size > MAX_BYTES) return;
        const url = URL.createObjectURL(blob);
        objectUrlsRef.current.push(url);
        const participant = room.getParticipantByIdentity(participantInfo.identity);
        setNotes(current => current.some(note => note.id === reader.info.id) ? current : [
          ...current,
          {
            id: reader.info.id,
            sender: participant?.name || participantInfo.identity || 'Participant',
            url,
            timestamp: reader.info.timestamp || Date.now(),
            local: false,
          },
        ]);
      } catch {
        setError('A voice note could not be received.');
      }
    });
    return () => room.unregisterByteStreamHandler(VOICE_NOTE_TOPIC);
  }, [room]);

  useEffect(() => {
    const updateTargets = () => {
      setFormTarget(document.querySelector<HTMLFormElement>('.lk-chat-form'));
      setListTarget(document.querySelector<HTMLUListElement>('.lk-chat-messages'));
    };
    const frame = window.requestAnimationFrame(updateTargets);
    const observer = new MutationObserver(updateTargets);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(''), 5_000);
    return () => window.clearTimeout(timer);
  }, [error]);

  useEffect(() => () => {
    window.clearInterval(timerRef.current);
    window.clearTimeout(timeoutRef.current);
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    streamRef.current?.getTracks().forEach(track => track.stop());
    objectUrlsRef.current.forEach(url => URL.revokeObjectURL(url));
  }, []);

  const stopRecording = useCallback(() => {
    window.clearInterval(timerRef.current);
    window.clearTimeout(timeoutRef.current);
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const sendRecording = useCallback(async (blob: Blob) => {
    if (!blob.size) {
      setError('Nothing was recorded. Check your microphone and try again.');
      return;
    }
    if (blob.size > MAX_BYTES) {
      setError('Voice note is too large. Keep it under one minute.');
      return;
    }

    const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timestamp = Date.now();
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.push(url);
    setNotes(current => [...current, {
      id,
      sender: localParticipant.name || localParticipant.identity || 'You',
      url,
      timestamp,
      local: true,
    }]);
    setSending(true);
    try {
      const extension = blob.type.includes('mp4') ? 'm4a' : 'webm';
      const file = new File([blob], `voice-note-${timestamp}.${extension}`, { type: blob.type });
      await localParticipant.sendFile(file, {
        topic: VOICE_NOTE_TOPIC,
        mimeType: blob.type,
        compress: false,
      });
    } catch {
      setError('Voice note could not be sent. Check your connection and try again.');
    } finally {
      setSending(false);
    }
  }, [localParticipant]);

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice notes are not supported by this browser.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: sessionStorage.getItem('shroom_audioId') || undefined,
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000,
      });
      chunksRef.current = [];
      streamRef.current = stream;
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      recorder.ondataavailable = event => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || mimeType || 'audio/webm' });
        recorderRef.current = null;
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        setRecording(false);
        setElapsed(0);
        void sendRecording(blob);
      };
      recorder.start();
      setRecording(true);
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed(Math.min(MAX_DURATION_SECONDS, Math.floor((Date.now() - startedAtRef.current) / 1_000)));
      }, 250);
      timeoutRef.current = window.setTimeout(stopRecording, MAX_DURATION_SECONDS * 1_000);
    } catch {
      setError('Microphone access is required to record a voice note.');
    }
  };

  return (
    <>
      {listTarget && createPortal(notes.map(note => <VoiceNotePlayer key={note.id} note={note} />), listTarget)}
      {formTarget && createPortal(
        <>
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={sending}
            aria-label={recording ? 'Stop and send voice note' : 'Record voice note'}
            title={recording ? 'Stop and send voice note' : 'Record voice note'}
            className={`shroom-voice-note-button ${recording ? 'is-recording' : ''}`}
          >
            {sending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : recording ? <Square aria-hidden="true" className="h-4 w-4" /> : <Mic aria-hidden="true" className="h-4 w-4" />}
            {recording && <span aria-hidden="true">{formatTime(elapsed)}</span>}
          </button>
          {error && <span role="alert" className="shroom-voice-note-error">{error}</span>}
        </>,
        formTarget,
      )}
    </>
  );
}
