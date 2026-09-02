import { useEffect, useState } from 'react';
import { useConnectionState, useRoomContext } from '@livekit/components-react';
import { ConnectionState, RoomEvent } from 'livekit-client';
import { Loader2, Wifi } from 'lucide-react';

export function ReconnectingOverlay() {
  const room = useRoomContext();
  const state = useConnectionState(room);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && !navigator.onLine);
  const [transportLost, setTransportLost] = useState(false);

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

  useEffect(() => {
    if (typeof room.on !== 'function' || typeof room.off !== 'function') return;
    const reconnecting = () => setTransportLost(true);
    const connected = () => setTransportLost(false);
    room.on(RoomEvent.Reconnecting, reconnecting);
    room.on(RoomEvent.SignalReconnecting, reconnecting);
    room.on(RoomEvent.Disconnected, reconnecting);
    room.on(RoomEvent.Connected, connected);
    const statePoll = window.setInterval(() => {
      if (room.state === 'connected') setTransportLost(false);
      else if (room.state === 'reconnecting' || room.state === 'disconnected') setTransportLost(true);
    }, 250);
    return () => {
      room.off(RoomEvent.Reconnecting, reconnecting);
      room.off(RoomEvent.SignalReconnecting, reconnecting);
      room.off(RoomEvent.Disconnected, reconnecting);
      room.off(RoomEvent.Connected, connected);
      window.clearInterval(statePoll);
    };
  }, [room]);

  const reconnecting = offline || transportLost || state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;

  return reconnecting ? <DelayedReconnectingOverlay /> : null;
}

function DelayedReconnectingOverlay() {
  const [visible, setVisible] = useState(false);
  const [networkMessage, setNetworkMessage] = useState('');

  useEffect(() => {
    // Avoid flashing the overlay for a transient reconnect.
    const timer = window.setTimeout(() => setVisible(true), 3_000);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="absolute inset-0 z-[70] flex items-center justify-center bg-slate-950/75 p-4 text-white backdrop-blur-sm sm:p-6"
    >
      <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-slate-900 p-6 text-center shadow-2xl sm:rounded-3xl sm:p-8">
        <Loader2 aria-hidden="true" className="mx-auto mb-4 h-10 w-10 animate-spin text-blue-400" />
        <h2 className="text-xl font-semibold sm:text-2xl">Reconnecting…</h2>
        <p className="mt-2 text-sm leading-6 text-slate-300 sm:text-base">Your audio and video will resume automatically.</p>
        <button
          type="button"
          onClick={() => setNetworkMessage(navigator.onLine
            ? 'Your browser is online. Re-establishing the secure media connection.'
            : 'This device appears to be offline. Check Wi-Fi or mobile data.')}
          className="shroom-primary-button mt-6 min-h-11 px-5 py-3 text-sm"
        >
          <Wifi aria-hidden="true" className="h-5 w-5" /> Check connection
        </button>
        {networkMessage && <p className="mt-4 text-sm text-slate-300" aria-live="polite">{networkMessage}</p>}
      </div>
    </div>
  );
}
