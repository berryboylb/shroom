import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { NetworkHealthOverlay } from './NetworkHealthOverlay';
import { DraggableRoomHeader } from './DraggableRoomHeader';
import { EmojiReactions } from './EmojiReactions';
import { ChimeController } from './ChimeController';
import { DeviceStateSync } from './DeviceStateSync';
import { CallAccessibility } from './CallAccessibility';
import { ReconnectingOverlay } from './ReconnectingOverlay';
import { DeviceRecovery } from './DeviceRecovery';
import { LiveCaptions } from './LiveCaptions';
import { LocalRecording } from './LocalRecording';
import { ExternalE2EEKeyProvider, VideoPresets, type RoomOptions } from 'livekit-client';
import E2EEWorker from 'livekit-client/e2ee-worker?worker';
import { useEffect, useState } from 'react';

interface RoomProps {
  roomId: string;
  token: string;
  serverUrl: string;
  e2eeKey?: string;
  onDisconnected: () => void;
}

export function Room({ roomId, token, serverUrl, e2eeKey, onDisconnected }: RoomProps) {
  const [e2ee, setE2EE] = useState<RoomOptions['e2ee']>();

  useEffect(() => {
    if (!e2eeKey) return;
    let cancelled = false;
    const worker = new E2EEWorker();
    const keyProvider = new ExternalE2EEKeyProvider();
    keyProvider.setKey(e2eeKey).then(() => {
      if (!cancelled) setE2EE({ keyProvider, worker });
    });
    return () => {
      cancelled = true;
      worker.terminate();
    };
  }, [e2eeKey]);

  // Read initial device preferences set during PreJoinScreen
  const initialVideo = sessionStorage.getItem('shroom_cam') !== 'false';
  const initialAudio = sessionStorage.getItem('shroom_mic') !== 'false';
  const videoId = sessionStorage.getItem('shroom_videoId');
  const audioId = sessionStorage.getItem('shroom_audioId');

  if (e2eeKey && !e2ee) {
    return <div role="status" className="flex h-[100dvh] items-center justify-center bg-slate-950 text-white">Preparing end-to-end encryption…</div>;
  }

  return (
    <div className="relative h-[100dvh] w-screen bg-slate-50 dark:bg-slate-950 overflow-hidden font-sans">
      <LiveKitRoom
        video={initialVideo}
        audio={initialAudio}
        token={token}
        serverUrl={serverUrl}
        options={{ 
          adaptiveStream: true, 
          dynacast: true,
          e2ee,
          videoCaptureDefaults: {
            deviceId: videoId || undefined,
          },
          audioCaptureDefaults: {
            deviceId: audioId || undefined,
          },
          publishDefaults: {
            simulcast: true,
            videoSimulcastLayers: [
              VideoPresets.h1080,
              VideoPresets.h720,
              VideoPresets.h360,
            ],
            audioPreset: { maxBitrate: 32_000 },
            dtx: false // DISABLED: DTX causes one-way audio on strict NATs due to UDP connection timeouts during silence
          }
        }}
        connectOptions={{
          autoSubscribe: true,
        }}
        onDisconnected={onDisconnected}
        data-lk-theme="default"
        className="w-full h-full flex flex-col"
      >
        <NetworkHealthOverlay roomId={roomId} />
        <DraggableRoomHeader roomId={roomId} />
        <EmojiReactions />
        <ChimeController />
        <DeviceStateSync />
        <CallAccessibility roomId={roomId} />
        <ReconnectingOverlay />
        <DeviceRecovery />
        <LiveCaptions />
        <LocalRecording roomId={roomId} />
        
        <div className="flex-1 p-0 sm:p-4 sm:pb-0 h-full">
          <VideoConference />
        </div>
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
