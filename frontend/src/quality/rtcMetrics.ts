import type { QualityMetrics } from './adaptiveQuality';

type StatsLike = {
  forEach(callback: (value: RTCStats) => void): void;
  get(id: string): RTCStats | undefined;
};

export interface DetailedQualityMetrics extends QualityMetrics {
  sendBitrateKbps: number;
  bytesSent: number;
  packetsSent: number;
  packetsLost: number;
  sampledAtMs: number;
  frameRate: number;
  resolution: { width: number; height: number };
  codec: string;
  candidateType: string;
  freezeCount: number;
}

export function extractQualityMetrics(report: StatsLike): DetailedQualityMetrics | null {
  let packetsSent = 0;
  let packetsLost = 0;
  let bytesSent = 0;
  let rttSeconds = 0;
  let jitterSeconds = 0;
  let frameRate = 0;
  let width = 0;
  let height = 0;
  let codec = 'unknown';
  let candidateType = 'unknown';
  let availableOutgoingBitrate = Number.MAX_SAFE_INTEGER;
  let freezeCount = 0;
  let sampledAtMs = 0;

  report.forEach(raw => {
    const stat = raw as RTCStats & Record<string, any>;
    sampledAtMs = Math.max(sampledAtMs, stat.timestamp || 0);
    if (stat.type === 'outbound-rtp' && !stat.isRemote) {
      packetsSent += stat.packetsSent || 0;
      bytesSent += stat.bytesSent || 0;
      if (stat.kind === 'video') {
        frameRate = Math.max(frameRate, stat.framesPerSecond || 0);
        width = Math.max(width, stat.frameWidth || 0);
        height = Math.max(height, stat.frameHeight || 0);
        freezeCount += stat.freezeCount || 0;
      }

      const remote = stat.remoteId ? report.get(stat.remoteId) as (RTCStats & Record<string, any>) | undefined : undefined;
      if (remote) {
        packetsLost += Math.max(0, remote.packetsLost || 0);
        rttSeconds = Math.max(rttSeconds, remote.roundTripTime || 0);
        jitterSeconds = Math.max(jitterSeconds, remote.jitter || 0);
      }

      const codecStat = stat.codecId ? report.get(stat.codecId) as (RTCStats & Record<string, any>) | undefined : undefined;
      if (codecStat?.mimeType && (codec === 'unknown' || stat.kind === 'video')) {
        codec = codecStat.mimeType.replace(/^(video|audio)\//, '');
      }
    }

    if (stat.type === 'candidate-pair' && stat.state === 'succeeded' && (stat.nominated || stat.selected)) {
      if (typeof stat.currentRoundTripTime === 'number') {
        rttSeconds = Math.max(rttSeconds, stat.currentRoundTripTime);
      }
      if (typeof stat.availableOutgoingBitrate === 'number') {
        availableOutgoingBitrate = stat.availableOutgoingBitrate;
      }
      const local = stat.localCandidateId
        ? report.get(stat.localCandidateId) as (RTCStats & Record<string, any>) | undefined
        : undefined;
      if (local?.candidateType) candidateType = local.candidateType;
    }
  });

  if (packetsSent === 0 && bytesSent === 0) return null;

  return {
    rttMs: rttSeconds * 1000,
    jitterMs: jitterSeconds * 1000,
    packetLossPercent: packetsSent + packetsLost > 0
      ? (packetsLost / (packetsSent + packetsLost)) * 100
      : 0,
    availableOutgoingBitrateKbps: availableOutgoingBitrate / 1000,
    sendBitrateKbps: 0,
    bytesSent,
    packetsSent,
    packetsLost,
    sampledAtMs,
    frameRate,
    resolution: { width, height },
    codec,
    candidateType,
    freezeCount,
  };
}
