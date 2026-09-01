import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, MicOff, Video, VideoOff, ArrowRight, Settings2 } from 'lucide-react';
import { ShroomLogo } from './ShroomLogo';

interface Props {
  roomId: string;
  displayName: string;
  encrypted?: boolean;
  encryptionSupported?: boolean;
  encryptionAvailable?: boolean;
  onJoin: (micEnabled: boolean, camEnabled: boolean, videoId?: string, audioId?: string, enableE2EE?: boolean) => void;
  onCancel: () => void;
}

export function PreJoinScreen({ roomId, encrypted = false, encryptionSupported = true, encryptionAvailable = false, onJoin, onCancel }: Props) {
  const [micEnabled, setMicEnabled] = useState(true);
  const [camEnabled, setCamEnabled] = useState(true);
  
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideo, setSelectedVideo] = useState<string>('');
  const [selectedAudio, setSelectedAudio] = useState<string>('');
  const [showSettings, setShowSettings] = useState(false);
  const [enableE2EE, setEnableE2EE] = useState(false);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);

  // Isolate stream dependency to avoid infinite loops
  const streamRef = useRef<MediaStream | null>(null);
  useEffect(() => { streamRef.current = stream; }, [stream]);

  const loadMedia = async (vid: string, aud: string) => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
      const constraints: MediaStreamConstraints = {
        video: vid ? { deviceId: { exact: vid } } : true,
        audio: aud ? { deviceId: { exact: aud } } : true,
      };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(s);
      
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
      setAudioDevices(devices.filter(d => d.kind === 'audioinput'));
      
      if (!vid) setSelectedVideo(s.getVideoTracks()[0]?.getSettings().deviceId || '');
      if (!aud) setSelectedAudio(s.getAudioTracks()[0]?.getSettings().deviceId || '');
    } catch (e) {
      console.warn(e);
      setError('Failed to switch device.');
    }
  };

  useEffect(() => {
    loadMedia('', '');
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const handleVideoChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedVideo(val);
    loadMedia(val, selectedAudio);
  };

  const handleAudioChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setSelectedAudio(val);
    loadMedia(selectedVideo, val);
  };

  // Update track states when buttons are toggled
  useEffect(() => {
    if (stream) {
      stream.getAudioTracks().forEach(t => t.enabled = micEnabled);
      stream.getVideoTracks().forEach(t => t.enabled = camEnabled);
    }
  }, [micEnabled, camEnabled, stream]);

  // Attach stream to video element when it renders
  useEffect(() => {
    if (videoRef.current && stream && camEnabled) {
      videoRef.current.srcObject = stream;
    }
  }, [stream, camEnabled]);

  const inAppBrowserWarning = (() => {
    const ua = navigator.userAgent || navigator.vendor;
    const rules = ['FBAV', 'FBAN', 'Instagram', 'Line', 'Snapchat', 'LinkedIn', 'Twitter', 'MicroMessenger', 'WeChat', 'WhatsApp', 'Slack'];
    return rules.some(rule => ua.includes(rule));
  })();

  return (
    <div className="min-h-[100dvh] bg-slate-950 flex flex-col items-center justify-center p-6 relative overflow-hidden font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-slate-900 rounded-[2rem] p-5 md:p-8 shadow-2xl border border-slate-800 relative z-10 flex flex-col items-center max-w-[95vw] sm:max-w-2xl"
      >
        {inAppBrowserWarning && (
          <div className="w-full bg-amber-500/20 border border-amber-500/50 text-amber-400 p-3 rounded-xl mb-6 text-sm font-medium flex items-center justify-between">
            <span><strong>Warning:</strong> You are using an in-app browser. If you experience lag or dropped audio, please open this link in Safari or Chrome.</span>
          </div>
        )}

        <div className="flex items-center justify-between w-full mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white shadow-md">
              <ShroomLogo className="w-5 h-5" />
            </div>
            <h2 className="text-2xl font-bold text-white">Ready to join?</h2>
          </div>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Device settings"
            aria-expanded={showSettings}
            className={`p-2 rounded-xl transition-colors ${showSettings ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-white'}`}
          >
            <><Settings2 className="w-5 h-5" /> <span className="text-sm font-bold hidden sm:inline">Device Settings</span></>
          </button>
        </div>

        <div className="w-full aspect-video bg-black rounded-2xl overflow-hidden relative shadow-inner mb-6">
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
              aria-label={micEnabled ? 'Turn microphone off' : 'Turn microphone on'}
              className={`p-4 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 ${micEnabled ? 'bg-slate-800/80 text-white backdrop-blur-md hover:bg-slate-700' : 'bg-red-500 text-white'}`}
            >
              {micEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </button>
            <button
              onClick={() => setCamEnabled(!camEnabled)}
              aria-label={camEnabled ? 'Turn camera off' : 'Turn camera on'}
              className={`p-4 rounded-full shadow-lg transition-all hover:scale-105 active:scale-95 ${camEnabled ? 'bg-slate-800/80 text-white backdrop-blur-md hover:bg-slate-700' : 'bg-red-500 text-white'}`}
            >
              {camEnabled ? <Video className="w-6 h-6" /> : <VideoOff className="w-6 h-6" />}
            </button>
          </div>
        </div>

        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="w-full bg-slate-950 rounded-2xl p-4 mb-6 border border-slate-800 overflow-hidden"
            >
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Camera</label>
                  <select 
                    aria-label="Camera"
                    value={selectedVideo} 
                    onChange={handleVideoChange}
                    className="w-full bg-slate-900 border border-slate-800 text-sm text-white rounded-xl p-3 outline-none focus:border-blue-500 transition-colors"
                  >
                    {videoDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${d.deviceId.slice(0,5)}`}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Microphone</label>
                  <select 
                    aria-label="Microphone"
                    value={selectedAudio} 
                    onChange={handleAudioChange}
                    className="w-full bg-slate-900 border border-slate-800 text-sm text-white rounded-xl p-3 outline-none focus:border-blue-500 transition-colors"
                  >
                    {audioDevices.map(d => (
                      <option key={d.deviceId} value={d.deviceId}>{d.label || `Mic ${d.deviceId.slice(0,5)}`}</option>
                    ))}
                  </select>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {error && (
          <p role="alert" className="text-amber-400 text-sm font-medium mb-6 bg-amber-400/10 py-2 px-4 rounded-lg w-full text-center">
            {error}
          </p>
        )}

        {(encrypted || encryptionAvailable) && (
          <div className="mb-5 w-full rounded-xl border border-emerald-700/50 bg-emerald-950/30 p-3 text-sm text-emerald-200">
            {encrypted && encryptionSupported ? (
              <p><strong>End-to-end encrypted room.</strong> The media key came from the private part of your invite link.</p>
            ) : encrypted ? (
              <p role="alert"><strong>This encrypted room needs a compatible browser.</strong> Open the link in a current Chrome, Edge, or Firefox release.</p>
            ) : (
              <label className="flex cursor-pointer items-start gap-3">
                <input type="checkbox" checked={enableE2EE} onChange={event => setEnableE2EE(event.target.checked)} className="mt-1 h-5 w-5" />
                <span><strong>Use end-to-end encryption</strong><br />Invitees need a compatible browser and the complete private link.</span>
              </label>
            )}
          </div>
        )}

        <div className="w-full flex gap-4">
          <button
            onClick={onCancel}
            className="flex-1 py-4 rounded-2xl font-bold text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onJoin(micEnabled, camEnabled, selectedVideo, selectedAudio, enableE2EE)}
            disabled={encrypted && !encryptionSupported}
            className="flex-[2] bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 rounded-2xl shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center justify-center gap-2"
          >
            Join <span className="truncate max-w-[100px] sm:max-w-[150px] inline-block align-bottom">{roomId}</span> <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
