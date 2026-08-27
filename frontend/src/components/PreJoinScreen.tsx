import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Mic, MicOff, Video, VideoOff, ArrowRight } from 'lucide-react';
import { ShroomLogo } from './ShroomLogo';

interface Props {
  roomId: string;
  displayName: string;
  onJoin: (micEnabled: boolean, camEnabled: boolean) => void;
  onCancel: () => void;
}

export function PreJoinScreen({ roomId, onJoin, onCancel }: Props) {
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    let activeStream: MediaStream | null = null;
    
    async function setupMedia() {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        activeStream = s;
        setStream(s);
        if (videoRef.current) {
          videoRef.current.srcObject = s;
        }
      } catch (err: any) {
        console.warn('Media access denied or unavailable', err);
        setError('Camera/Microphone access denied. You can still join as a viewer.');
        setMicEnabled(false);
        setCamEnabled(false);
      }
    }
    
    setupMedia();
    
    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  // Update track states when buttons are toggled
  useEffect(() => {
    if (stream) {
      stream.getAudioTracks().forEach(t => t.enabled = micEnabled);
      stream.getVideoTracks().forEach(t => t.enabled = camEnabled);
    }
  }, [micEnabled, camEnabled, stream]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-slate-900 rounded-[2rem] p-8 shadow-2xl border border-slate-800 relative z-10 flex flex-col items-center"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white">
            <ShroomLogo className="w-5 h-5" />
          </div>
          <h2 className="text-2xl font-bold text-white">Ready to join?</h2>
        </div>

        <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden relative shadow-inner mb-8">
          {stream && camEnabled ? (
            <video 
              ref={videoRef}
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover mirror"
              style={{ transform: 'scaleX(-1)' }}
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center bg-slate-800 text-slate-500">
              <VideoOff className="w-12 h-12 mb-3 opacity-50" />
              <p className="font-medium text-sm">Camera is off</p>
            </div>
          )}
          
          <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-4">
            <button
              onClick={() => setMicEnabled(!micEnabled)}
              className={`p-4 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 ${micEnabled ? 'bg-slate-800/80 text-white backdrop-blur-md hover:bg-slate-700' : 'bg-red-500 text-white'}`}
            >
              {micEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </button>
            <button
              onClick={() => setCamEnabled(!camEnabled)}
              className={`p-4 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 ${camEnabled ? 'bg-slate-800/80 text-white backdrop-blur-md hover:bg-slate-700' : 'bg-red-500 text-white'}`}
            >
              {camEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {error && (
          <p className="text-amber-400 text-sm font-medium mb-6 bg-amber-400/10 py-2 px-4 rounded-lg w-full text-center">
            {error}
          </p>
        )}

        <div className="w-full flex gap-4">
          <button
            onClick={onCancel}
            className="flex-1 py-4 rounded-2xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onJoin(micEnabled, camEnabled)}
            className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2"
          >
            Join {roomId} <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
