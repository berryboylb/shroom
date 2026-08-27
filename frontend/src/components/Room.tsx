import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { NetworkHealthOverlay } from './NetworkHealthOverlay';
import { DraggableRoomHeader } from './DraggableRoomHeader';
import { EmojiReactions } from './EmojiReactions';
import { VideoPresets } from 'livekit-client';

interface RoomProps {
  roomId: string;
  token: string;
  serverUrl: string;
  onDisconnected: () => void;
}

export function Room({ roomId, token, serverUrl, onDisconnected }: RoomProps) {
  // Read initial device preferences set during PreJoinScreen
  const initialVideo = sessionStorage.getItem('shroom_cam') !== 'false';
  const initialAudio = sessionStorage.getItem('shroom_mic') !== 'false';
  const videoId = sessionStorage.getItem('shroom_videoId');
  const audioId = sessionStorage.getItem('shroom_audioId');

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
            dtx: true
          }
        }}
        onDisconnected={onDisconnected}
        data-lk-theme="default"
        className="w-full h-full flex flex-col"
      >
        <NetworkHealthOverlay />
        <DraggableRoomHeader roomId={roomId} />
        <EmojiReactions />
        
        <div className="flex-1 p-4 pb-0 h-full">
          <VideoConference />
        </div>
        <RoomAudioRenderer />
      </LiveKitRoom>
    </div>
  );
}
