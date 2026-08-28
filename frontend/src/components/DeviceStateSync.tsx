import { useEffect } from 'react';
import { useLocalParticipant } from '@livekit/components-react';

export function DeviceStateSync() {
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    if (!localParticipant) return;

    const syncState = () => {
      const isMicOn = localParticipant.isMicrophoneEnabled;
      const isCamOn = localParticipant.isCameraEnabled;

      sessionStorage.setItem('shroom_mic', isMicOn ? 'true' : 'false');
      sessionStorage.setItem('shroom_cam', isCamOn ? 'true' : 'false');
    };

    // Initial sync
    syncState();

    // The state in localParticipant is updated reactively, but we can also hook into events
    // just to ensure sessionStorage is instantly updated.
    localParticipant.on('trackMuted', syncState);
    localParticipant.on('trackUnmuted', syncState);
    localParticipant.on('localTrackPublished', syncState);
    localParticipant.on('localTrackUnpublished', syncState);

    return () => {
      localParticipant.off('trackMuted', syncState);
      localParticipant.off('trackUnmuted', syncState);
      localParticipant.off('localTrackPublished', syncState);
      localParticipant.off('localTrackUnpublished', syncState);
    };
  }, [localParticipant]);

  return null;
}
