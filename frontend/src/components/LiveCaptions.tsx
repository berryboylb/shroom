import { useCallback, useEffect, useRef, useState } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { Captions, CaptionsOff } from 'lucide-react';

type SpeechRecognitionInstance = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: any) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

type CaptionLine = { speaker: string; text: string };

export function LiveCaptions() {
  const { localParticipant } = useLocalParticipant();
  const [enabled, setEnabled] = useState(false);
  const [line, setLine] = useState<CaptionLine | null>(null);
  const recognition = useRef<SpeechRecognitionInstance | null>(null);
  const shouldRestart = useRef(false);

  const Recognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
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
    recognition.current?.stop();
    recognition.current = null;
    setEnabled(false);
  }, []);

  const start = useCallback(() => {
    if (!supported || recognition.current) return;
    const instance: SpeechRecognitionInstance = new Recognition();
    instance.continuous = true;
    instance.interimResults = true;
    instance.lang = navigator.language || 'en-US';
    shouldRestart.current = true;
    instance.onresult = (event: any) => {
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
    instance.onerror = stop;
    instance.onend = () => {
      recognition.current = null;
      if (shouldRestart.current) {
        try { instance.start(); recognition.current = instance; } catch { stop(); }
      }
    };
    recognition.current = instance;
    instance.start();
    setEnabled(true);
  }, [Recognition, localParticipant, stop, supported]);

  useEffect(() => stop, [stop]);

  return (
    <>
      <button
        type="button"
        onClick={enabled ? stop : start}
        disabled={!supported}
        aria-label={supported ? (enabled ? 'Turn live captions off' : 'Turn live captions on') : 'Live captions unsupported in this browser'}
        aria-pressed={enabled}
        title={supported ? 'Live captions' : 'Live captions are not supported by this browser'}
        className="absolute right-16 top-20 z-40 min-h-11 min-w-11 rounded-full bg-slate-900/90 p-3 text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
      >
        {enabled ? <CaptionsOff aria-hidden="true" className="h-5 w-5" /> : <Captions aria-hidden="true" className="h-5 w-5" />}
      </button>
      {enabled && line && (
        <div aria-live="polite" aria-atomic="true" className="absolute bottom-28 left-1/2 z-50 max-w-2xl -translate-x-1/2 rounded-xl bg-black/85 px-5 py-3 text-center text-white shadow-xl">
          <strong>{line.speaker}:</strong> {line.text}
        </div>
      )}
    </>
  );
}
