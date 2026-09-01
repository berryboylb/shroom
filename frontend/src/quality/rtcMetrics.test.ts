import { describe, expect, it } from 'vitest';
import { extractQualityMetrics } from './rtcMetrics';

function report(values: Array<Record<string, any>>) {
  const map = new Map(values.map(value => [value.id, value]));
  return map as unknown as RTCStatsReport;
}

describe('RTC quality metrics', () => {
  it('extracts network, codec, resolution, and candidate information', () => {
    const metrics = extractQualityMetrics(report([
      { id: 'out', type: 'outbound-rtp', kind: 'video', packetsSent: 950, bytesSent: 100_000, frameWidth: 1280, frameHeight: 720, framesPerSecond: 30, remoteId: 'remote', codecId: 'codec' },
      { id: 'remote', type: 'remote-inbound-rtp', packetsLost: 50, roundTripTime: 0.12, jitter: 0.02 },
      { id: 'codec', type: 'codec', mimeType: 'video/H264' },
      { id: 'pair', type: 'candidate-pair', state: 'succeeded', nominated: true, currentRoundTripTime: 0.1, availableOutgoingBitrate: 1_200_000, localCandidateId: 'local' },
      { id: 'local', type: 'local-candidate', candidateType: 'relay' },
    ]));

    expect(metrics).toMatchObject({
      rttMs: 120,
      jitterMs: 20,
      packetLossPercent: 5,
      availableOutgoingBitrateKbps: 1200,
      resolution: { width: 1280, height: 720 },
      codec: 'H264',
      candidateType: 'relay',
    });
  });
});
