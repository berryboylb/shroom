import { useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { LocalVideoTrack, RoomEvent, VideoQuality } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { apiClient } from '../lib/apiClient';
import { AdaptiveQualityController, type QualityTier } from '../quality/adaptiveQuality';
import { extractQualityMetrics, type DetailedQualityMetrics } from '../quality/rtcMetrics';

const publishingQuality: Partial<Record<QualityTier, VideoQuality>> = {
  excellent: VideoQuality.HIGH,
  good: VideoQuality.MEDIUM,
  fair: VideoQuality.LOW,
};

export function NetworkHealthOverlay({ roomId }: { roomId: string }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();
  const token = useAuthStore(state => state.accessToken);
  const controller = useRef(new AdaptiveQualityController());
  const [tier, setTier] = useState<QualityTier>('excellent');
  const [metrics, setMetrics] = useState<DetailedQualityMetrics | null>(null);
  const autoPausedVideo = useRef(false);
  const lastTelemetryAt = useRef(0);
  const previousSample = useRef<{ bytes: number; packetsSent: number; packetsLost: number; at: number } | null>(null);
  const reconnectCount = useRef(0);
  const appliedTier = useRef<QualityTier | null>(null);

  useEffect(() => {
    const countReconnect = () => { reconnectCount.current += 1; };
    room.on(RoomEvent.Reconnecting, countReconnect);
    return () => { room.off(RoomEvent.Reconnecting, countReconnect); };
  }, [room]);

  useEffect(() => {
    if (!localParticipant) return;

    let cancelled = false;

    const sample = async () => {
      const publications = [
        ...localParticipant.videoTrackPublications.values(),
        ...localParticipant.audioTrackPublications.values(),
      ];

      for (const publication of publications) {
        const report = await publication.track?.getRTCStatsReport();
        if (!report) continue;
        const nextMetrics = extractQualityMetrics(report);
        if (!nextMetrics || cancelled) continue;
        if (previousSample.current && nextMetrics.sampledAtMs > previousSample.current.at) {
          nextMetrics.sendBitrateKbps = Math.max(0,
            (nextMetrics.bytesSent - previousSample.current.bytes) * 8 /
            (nextMetrics.sampledAtMs - previousSample.current.at)
          );
          const sentDelta = Math.max(0, nextMetrics.packetsSent - previousSample.current.packetsSent);
          const lostDelta = Math.max(0, nextMetrics.packetsLost - previousSample.current.packetsLost);
          if (sentDelta + lostDelta > 0) {
            nextMetrics.packetLossPercent = lostDelta / (sentDelta + lostDelta) * 100;
          }
        }
        previousSample.current = {
          bytes: nextMetrics.bytesSent,
          packetsSent: nextMetrics.packetsSent,
          packetsLost: nextMetrics.packetsLost,
          at: nextMetrics.sampledAtMs,
        };

        const nextTier = controller.current.update(nextMetrics);
        setMetrics(nextMetrics);
        setTier(nextTier);

        const maxQuality = publishingQuality[nextTier];
        if (appliedTier.current !== nextTier) {
          for (const videoPublication of localParticipant.videoTrackPublications.values()) {
            if (maxQuality !== undefined && videoPublication.track instanceof LocalVideoTrack) {
              videoPublication.track.setPublishingQuality(maxQuality);
            }
          }
          appliedTier.current = nextTier;
        }

        const shouldPauseVideo = nextTier === 'poor' || nextTier === 'critical';
        if (shouldPauseVideo && localParticipant.isCameraEnabled && !autoPausedVideo.current) {
          autoPausedVideo.current = true;
          sessionStorage.setItem('shroom_adaptive_video_paused', 'true');
          await localParticipant.setCameraEnabled(false);
        } else if (!shouldPauseVideo && autoPausedVideo.current) {
          await localParticipant.setCameraEnabled(true);
          autoPausedVideo.current = false;
          sessionStorage.removeItem('shroom_adaptive_video_paused');
        }

        const now = Date.now();
        if (token && now - lastTelemetryAt.current >= 30_000) {
          lastTelemetryAt.current = now;
          apiClient('/api/telemetry', {
            method: 'POST',
            body: JSON.stringify({
              roomId,
              participantName: localParticipant.identity || 'client',
              quality: nextTier,
              browser: navigator.userAgent,
              metrics: { ...nextMetrics, reconnectCount: reconnectCount.current },
            }),
          }).catch(error => console.warn('Telemetry unavailable', error));
        }
        break;
      }
    };

    sample();
    const interval = window.setInterval(sample, 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      sessionStorage.removeItem('shroom_adaptive_video_paused');
    };
  }, [localParticipant, roomId, token]);

  if (tier === 'excellent' || tier === 'good') {
    return null;
  }

  const isAudioOnly = tier === 'poor' || tier === 'critical';
  const message = isAudioOnly
    ? 'Video paused — poor connection. Audio remains active.'
    : 'Network is unstable — video quality reduced.';

  return (
    <div
      role="status"
      aria-live={isAudioOnly ? 'assertive' : 'polite'}
      className="absolute top-20 sm:top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center space-x-2"
      title={metrics ? `RTT ${Math.round(metrics.rttMs)} ms · loss ${metrics.packetLossPercent.toFixed(1)}%` : undefined}
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
      </svg>
      <span className="font-semibold text-sm">{message}</span>
    </div>
  );
}
