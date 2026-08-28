import { useLocalParticipant } from '@livekit/components-react';
import { ConnectionQuality } from 'livekit-client';
import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/authStore';
import { apiClient } from '../lib/apiClient';

export function NetworkHealthOverlay() {
  const { localParticipant } = useLocalParticipant();
  const token = useAuthStore(state => state.accessToken);
  const lastReportedQuality = useRef<ConnectionQuality | null>(null);

  // If localParticipant isn't ready yet, default to Unknown
  const quality = localParticipant ? localParticipant.connectionQuality : ConnectionQuality.Unknown;

  useEffect(() => {
    if (quality !== lastReportedQuality.current && quality !== ConnectionQuality.Unknown) {
      lastReportedQuality.current = quality;
      
      const qualityString = quality === ConnectionQuality.Excellent ? 'excellent' :
                            quality === ConnectionQuality.Good ? 'good' :
                            quality === ConnectionQuality.Poor ? 'poor' : 'lost';
                            
      if (token) {
        apiClient('/api/telemetry', {
          method: 'POST',
          body: JSON.stringify({
            roomId: 'active-room',
            participantName: localParticipant?.identity || 'client',
            quality: qualityString,
            browser: navigator.userAgent
          }),
        }).catch(e => console.error("Telemetry failed", e));
      }
    }
  }, [quality, token, localParticipant]);

  if (quality === ConnectionQuality.Excellent || quality === ConnectionQuality.Good || quality === ConnectionQuality.Unknown) {
    return null;
  }

  return (
    <div className="absolute top-20 sm:top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center space-x-2 animate-pulse">
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
      </svg>
      <span className="font-semibold text-sm">Poor Network Connection</span>
    </div>
  );
}
