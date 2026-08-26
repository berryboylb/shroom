import { useState, useEffect, useCallback } from 'react';
import {
  LiveKitRoom,
  VideoConference,
  RoomAudioRenderer,
  useLocalParticipant,
  useRoomContext
} from '@livekit/components-react';
import { VideoPresets } from 'livekit-client';
import { Mic, MicOff, Video, VideoOff, PhoneOff, MonitorUp } from 'lucide-react';

interface CallProps {
  roomId: string;
  token: string;
  serverUrl: string;
  onLeave: () => void;
}

// Custom floating pill using LiveKit hooks
function CallControls({ onLeave }: { onLeave: () => void }) {
  const room = useRoomContext();
  const { isMicrophoneEnabled, isCameraEnabled, isScreenShareEnabled, localParticipant } = useLocalParticipant();
  const [isVisible, setIsVisible] = useState(true);

  // Auto-hide logic
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleMouseMove = () => {
      setIsVisible(true);
      clearTimeout(timeout);
      timeout = setTimeout(() => setIsVisible(false), 3000);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(timeout);
    };
  }, []);

  const toggleMic = useCallback(() => {
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [localParticipant, isMicrophoneEnabled]);

  const toggleCam = useCallback(() => {
    localParticipant.setCameraEnabled(!isCameraEnabled);
  }, [localParticipant, isCameraEnabled]);

  const toggleScreen = useCallback(() => {
    localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
  }, [localParticipant, isScreenShareEnabled]);

  const handleDisconnect = () => {
    room.disconnect();
    onLeave();
  };

  return (
    <div 
      className={`absolute bottom-8 left-1/2 -translate-x-1/2 z-50 transition-opacity duration-300 ${isVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
    >
      <div className="flex items-center gap-2 bg-surface-dark/90 dark:bg-surface-light/90 backdrop-blur-md px-4 py-3 rounded-pill shadow-2xl border border-white/10 dark:border-black/10">
        
        <button 
          onClick={toggleMic}
          className={`p-3 rounded-full transition-transform hover:scale-105 active:scale-95 ${!isMicrophoneEnabled ? 'bg-destructive text-white' : 'bg-surface-light/10 text-paper dark:text-pitch hover:bg-surface-light/20'}`}
        >
          {isMicrophoneEnabled ? <Mic size={20} /> : <MicOff size={20} />}
        </button>

        <button 
          onClick={toggleCam}
          className={`p-3 rounded-full transition-transform hover:scale-105 active:scale-95 ${!isCameraEnabled ? 'bg-destructive text-white' : 'bg-surface-light/10 text-paper dark:text-pitch hover:bg-surface-light/20'}`}
        >
          {isCameraEnabled ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
        
        <button 
          onClick={toggleScreen}
          className={`p-3 rounded-full transition-transform hover:scale-105 active:scale-95 ${isScreenShareEnabled ? 'bg-acid text-pitch' : 'bg-surface-light/10 text-paper dark:text-pitch hover:bg-surface-light/20'}`}
        >
          <MonitorUp size={20} />
        </button>

        <div className="w-px h-6 bg-white/20 dark:bg-black/20 mx-2" />

        <button 
          onClick={handleDisconnect}
          className="px-6 py-3 bg-destructive text-white font-semibold rounded-pill hover:scale-105 active:scale-95 transition-transform flex items-center gap-2"
        >
          <PhoneOff size={18} />
          Leave
        </button>
        
      </div>
    </div>
  );
}

function RoomInfo({ roomId }: { roomId: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="absolute bottom-8 left-8 z-50 text-paper mix-blend-difference drop-shadow-md cursor-pointer" 
         onClick={() => {
           navigator.clipboard.writeText(roomId);
           setCopied(true);
           setTimeout(() => setCopied(false), 2000);
         }}>
      <p className="text-sm font-semibold opacity-70 uppercase tracking-widest mb-1">Room Code</p>
      <p className="text-xl font-mono font-bold tracking-tight">
        {copied ? 'Copied!' : roomId}
      </p>
    </div>
  );
}

export function Call({ roomId, token, serverUrl, onLeave }: CallProps) {
  return (
    <div className="relative w-screen h-screen bg-pitch overflow-hidden">
      <LiveKitRoom
        video={true}
        audio={true}
        token={token}
        serverUrl={serverUrl}
        options={{ 
          adaptiveStream: true, 
          dynacast: true,
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
        onDisconnected={onLeave}
      >
        <RoomInfo roomId={roomId} />
        <VideoConference />
        <RoomAudioRenderer />
        <CallControls onLeave={onLeave} />
      </LiveKitRoom>
    </div>
  );
}
