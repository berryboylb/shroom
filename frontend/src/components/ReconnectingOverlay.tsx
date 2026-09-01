import { useEffect, useState } from 'react';
import { useConnectionState, useRoomContext } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { Loader2, Wifi } from 'lucide-react';

export function ReconnectingOverlay() {
  const room = useRoomContext();
  const state = useConnectionState(room);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);

  useEffect(() => {
    const wentOffline = () => setOffline(true);
    const cameOnline = () => setOffline(false);
    window.addEventListener('offline', wentOffline);
    window.addEventListener('online', cameOnline);
    return () => {
      window.removeEventListener('offline', wentOffline);
      window.removeEventListener('online', cameOnline);
    };
  }, []);

  const reconnecting = offline || state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;

  return reconnecting ? <DelayedReconnectingOverlay /> : null;
}

function DelayedReconnectingOverlay() {
  const [visible, setVisible] = useState(false);
  const [networkMessage, setNetworkMessage] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 3_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="absolute inset-0 z-[70] flex items-center justify-center bg-slate-950/75 p-6 text-white backdrop-blur-sm"
    >
      <div className="max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-8 text-center shadow-2xl">
        <Loader2 aria-hidden="true" className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-400" />
        <h2 className="text-2xl font-bold">Reconnecting…</h2>
        <p className="mt-2 text-slate-300">Your audio and video will resume automatically.</p>
        <button
          type="button"
          onClick={() => setNetworkMessage(navigator.onLine
            ? 'Your browser is online. Re-establishing the secure media connection.'
            : 'This device appears to be offline. Check Wi-Fi or mobile data.')}
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-bold hover:bg-blue-700"
        >
          <Wifi aria-hidden="true" className="h-5 w-5" /> Check connection
        </button>
        {networkMessage && <p className="mt-4 text-sm text-slate-300" aria-live="polite">{networkMessage}</p>}
      </div>
    </div>
  );
}
