import { useEffect, useState } from 'react';
import { useRoomContext } from '@livekit/components-react';

export function DeviceRecovery() {
  const room = useRoomContext();
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!navigator.mediaDevices?.addEventListener) return;

    let timer: number | undefined;
    const recover = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(async () => {
        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const kinds: MediaDeviceKind[] = ['audioinput', 'videoinput'];

          for (const kind of kinds) {
            const available = devices.filter(device => device.kind === kind);
            const activeId = room.getActiveDevice(kind);
            if (!activeId || available.some(device => device.deviceId === activeId)) continue;

            const replacement = available[0];
            const label = kind === 'audioinput' ? 'Microphone' : 'Camera';
            if (!replacement) {
              setMessage(`${label} disconnected. No replacement device is available.`);
              continue;
            }

            await room.switchActiveDevice(kind, replacement.deviceId);
            sessionStorage.setItem(kind === 'audioinput' ? 'shroom_audioId' : 'shroom_videoId', replacement.deviceId);
            setMessage(`${label} disconnected. Switched to ${replacement.label || 'the default device'}.`);
          }
        } catch {
          setMessage('A media device changed. Open device settings if audio or video does not recover.');
        }
      }, 600);
    };

    navigator.mediaDevices.addEventListener('devicechange', recover);
    return () => {
      window.clearTimeout(timer);
      navigator.mediaDevices.removeEventListener('devicechange', recover);
    };
  }, [room]);

  if (!message) return null;
  return (
    <div role="status" aria-live="assertive" className="shroom-call-notice shroom-device-notice">
      {message}
    </div>
  );
}
