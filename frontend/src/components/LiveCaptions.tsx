import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { Captions, CaptionsOff } from 'lucide-react';

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  start(): void;
  stop(): void;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
};

type RecognitionAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';
type RecognitionConstructor = {
  new(): SpeechRecognitionInstance;
  available?: (options: { langs: string[]; processLocally: boolean; quality?: 'dictation' }) => Promise<RecognitionAvailability>;
  install?: (options: { langs: string[]; processLocally: boolean; quality?: 'dictation' }) => Promise<boolean>;
};

type CaptionLine = { speaker: string; text: string };

export function LiveCaptions() {
  const { localParticipant } = useLocalParticipant();
  const [enabled, setEnabled] = useState(false);
  const [line, setLine] = useState<CaptionLine | null>(null);
  const [error, setError] = useState('');
  const [activity, setActivity] = useState<'listening' | 'reconnecting' | 'downloading'>('listening');
  const recognition = useRef<SpeechRecognitionInstance | null>(null);
  const shouldRestart = useRef(false);
  const restartTimer = useRef<number | undefined>(undefined);
  const networkRetries = useRef(0);

  const Recognition = ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition) as RecognitionConstructor | undefined;
  const supported = Boolean(Recognition);

  useDataChannel((message) => {
    try {
      const payload = JSON.parse(new TextDecoder().decode(message.payload));
      if (payload.type === 'caption' && typeof payload.text === 'string') {
        setLine({ speaker: payload.speaker || 'Participant', text: payload.text.slice(0, 300) });
      }
    } catch {
      // Ignore unrelated or malformed data-channel messages.
    }
  });

  const stop = useCallback(() => {
    shouldRestart.current = false;
    window.clearTimeout(restartTimer.current);
    try { recognition.current?.stop(); } catch { /* The browser may have already ended it. */ }
    recognition.current = null;
    networkRetries.current = 0;
    setEnabled(false);
  }, []);

  const start = useCallback(async () => {
    if (!supported || recognition.current) return;
    setError('');
    setLine(null);
    setActivity('listening');
    networkRetries.current = 0;
    const instance: SpeechRecognitionInstance = new Recognition!();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = navigator.language || 'en-US';
    shouldRestart.current = true;
    recognition.current = instance;
    setEnabled(true);

    if (typeof Recognition?.available === 'function') {
      try {
        const options = { langs: [instance.lang], processLocally: true, quality: 'dictation' as const };
        const availability = await Recognition.available(options);
        if (!shouldRestart.current) return;
        if (availability === 'available') {
          instance.processLocally = true;
        } else if ((availability === 'downloadable' || availability === 'downloading') && typeof Recognition.install === 'function') {
          setActivity('downloading');
          const installed = await Recognition.install(options);
          if (!shouldRestart.current) return;
          if (installed) instance.processLocally = true;
        }
      } catch {
        // Some browsers expose the local API before it is usable; fall back to their speech service.
      }
    }

    instance.onstart = () => setActivity('listening');
    instance.onresult = (event: any) => {
      networkRetries.current = 0;
      setActivity('listening');
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const text = String(event.results[index][0].transcript).trim();
        if (!text) continue;
        setLine({ speaker: 'You', text });
        if (event.results[index].isFinal) {
          const data = new TextEncoder().encode(JSON.stringify({
            type: 'caption',
            speaker: localParticipant.name || localParticipant.identity,
            text: text.slice(0, 300),
          }));
          localParticipant.publishData(data, { reliable: true });
        } else {
          interim = text;
        }
      }
      if (interim) setLine({ speaker: 'You', text: interim });
    };
    instance.onerror = event => {
      if (event.error === 'no-speech') return;
      if (event.error === 'aborted' && !shouldRestart.current) return;
      if (event.error === 'network' && networkRetries.current < 3) {
        networkRetries.current += 1;
        setActivity('reconnecting');
        return;
      }
      shouldRestart.current = false;
      recognition.current = null;
      setEnabled(false);
      setError(event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Allow microphone access to use live captions.'
        : event.error === 'audio-capture'
          ? 'No microphone is available for live captions.'
          : event.error === 'network'
            ? 'Chrome’s speech service is unavailable. Check your connection and try again.'
            : event.error === 'language-not-supported'
              ? 'This browser has no speech pack for your current language.'
              : 'Live captions lost the browser speech service. Try again.');
    };
    instance.onend = () => {
      recognition.current = null;
      if (shouldRestart.current) {
        const delay = networkRetries.current ? 500 * (2 ** (networkRetries.current - 1)) : 150;
        restartTimer.current = window.setTimeout(() => {
          try {
            instance.start();
            recognition.current = instance;
          } catch {
            stop();
            setError('Live captions could not restart. Try again.');
          }
        }, delay);
      }
    };
    try {
      instance.start();
    } catch {
      recognition.current = null;
      shouldRestart.current = false;
      setError('Live captions could not start. Try again.');
    }
  }, [Recognition, localParticipant, stop, supported]);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(''), 5_000);
    return () => window.clearTimeout(timer);
  }, [error]);

  return (
    <>
      <button
        type="button"
        onClick={enabled ? stop : start}
        disabled={!supported}
        aria-label={supported ? (enabled ? 'Turn live captions off' : 'Turn live captions on') : 'Live captions unsupported in this browser'}
        aria-pressed={enabled}
        title={supported ? 'Live captions' : 'Live captions are not supported by this browser'}
        className={`shroom-call-tool shroom-call-tool-captions disabled:cursor-not-allowed disabled:opacity-40 ${enabled ? 'is-active' : ''}`}
      >
        {enabled ? <CaptionsOff aria-hidden="true" className="h-5 w-5" /> : <Captions aria-hidden="true" className="h-5 w-5" />}
        <span className="shroom-call-tool-label">Captions</span>
      </button>
      {enabled && (
        <div aria-live="polite" aria-atomic="true" className="shroom-call-notice shroom-caption-line">
          {line
            ? <><strong>{line.speaker}:</strong> {line.text}</>
            : <><strong>Captions:</strong> {activity === 'downloading' ? 'Preparing offline speech…' : activity === 'reconnecting' ? 'Reconnecting…' : 'Listening…'}</>}
        </div>
      )}
      {!enabled && error && <div role="alert" className="shroom-call-notice shroom-caption-line shroom-caption-error">{error}</div>}
    </>
  );
}
