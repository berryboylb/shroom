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

export function PreJoinScreen({ roomId, displayName, encrypted = false, encryptionSupported = true, encryptionAvailable = false, onJoin, onCancel }: Props) {
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
    // Media capture synchronizes with browser devices and updates state only after those APIs resolve.
    // oxlint-disable-next-line react/set-state-in-effect
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
    <div className="shroom-prejoin shroom-prejoin-shell min-h-[100dvh] font-sans">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="shroom-prejoin-card relative z-10 flex w-full max-w-2xl flex-col items-center"
      >
        {inAppBrowserWarning && (
          <div className="w-full bg-amber-500/20 border border-amber-500/50 text-amber-400 p-3 rounded-xl mb-6 text-sm font-medium flex items-center justify-between">
            <span><strong>Warning:</strong> You are using an in-app browser. If you experience lag or dropped audio, please open this link in Safari or Chrome.</span>
          </div>
        )}

        <div className="shroom-prejoin-header">
          <div className="shroom-prejoin-meta">
            <div className="shroom-mark shrink-0">
              <ShroomLogo className="w-5 h-5" />
            </div>
            <p className="shroom-prejoin-kicker">
              <span className="shroom-prejoin-kicker-label">Private room</span>
              <span aria-hidden="true">·</span>
              <span className="shroom-prejoin-room-code" title={roomId}>{roomId}</span>
            </p>
          </div>
          <button 
            type="button"
            onClick={() => setShowSettings(!showSettings)}
            aria-label="Device settings"
            aria-expanded={showSettings}
            className={`shroom-prejoin-settings-button ${showSettings ? 'is-active' : ''}`}
          >
            <Settings2 aria-hidden="true" className="h-4 w-4" />
            <span className="hidden sm:inline">Devices</span>
          </button>
          <div className="shroom-prejoin-title-block">
            <h1 className="shroom-prejoin-title">Ready when you are?</h1>
            <p className="shroom-prejoin-identity">Joining as {displayName}</p>
          </div>
        </div>

        <div className="shroom-preview w-full aspect-video rounded-2xl overflow-hidden relative mb-6">
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
            <div className="shroom-camera-off h-full w-full bg-slate-800 text-slate-500">
              <VideoOff className="shroom-camera-off-icon opacity-50" />
              <p className="shroom-camera-off-label">Camera is off</p>
            </div>
          )}
          
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2.5 sm:bottom-4 sm:gap-3">
            <button
              onClick={() => setMicEnabled(!micEnabled)}
              aria-label={micEnabled ? 'Turn microphone off' : 'Turn microphone on'}
              className={`shroom-device-button ${micEnabled ? '' : 'is-off'}`}
            >
              {micEnabled ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6" />}
            </button>
            <button
              onClick={() => setCamEnabled(!camEnabled)}
              aria-label={camEnabled ? 'Turn camera off' : 'Turn camera on'}
              className={`shroom-device-button ${camEnabled ? '' : 'is-off'}`}
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
              className="shroom-settings w-full rounded-2xl p-4 mb-6 overflow-hidden"
            >
              <div className="flex flex-col gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Camera</label>
                  <select 
                    aria-label="Camera"
                    value={selectedVideo} 
                    onChange={handleVideoChange}
                    className="shroom-input w-full text-sm"
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
                    className="shroom-input w-full text-sm"
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
          <div className="shroom-encryption-panel">
            {encrypted && encryptionSupported ? (
              <p><strong>End-to-end encrypted.</strong> This room uses the private key in your invite link.</p>
            ) : encrypted ? (
              <p role="alert"><strong>Compatible browser required.</strong> Open this link in a current Chrome, Edge, or Firefox release.</p>
            ) : (
              <label className="shroom-encryption-option">
                <input type="checkbox" checked={enableE2EE} onChange={event => setEnableE2EE(event.target.checked)} />
                <span>
                  <strong>End-to-end encryption</strong>
                  <small>Requires compatible browsers and the complete private link.</small>
                </span>
              </label>
            )}
          </div>
        )}

        <div className="shroom-prejoin-actions">
          <button
            type="button"
            onClick={onCancel}
            className="shroom-quiet-button shroom-prejoin-action flex-1"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onJoin(micEnabled, camEnabled, selectedVideo, selectedAudio, enableE2EE)}
            disabled={encrypted && !encryptionSupported}
            className="shroom-primary-button shroom-prejoin-action min-w-0 flex-[2]"
          >
            <span>Join room</span><ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />
          </button>
        </div>
      </motion.div>
    </div>
  );
}
