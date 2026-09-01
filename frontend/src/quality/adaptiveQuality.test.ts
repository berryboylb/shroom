import { describe, expect, it } from 'vitest';
import { AdaptiveQualityController, computeQualityTier, type QualityMetrics } from './adaptiveQuality';

const excellent: QualityMetrics = {
  rttMs: 40,
  jitterMs: 4,
  packetLossPercent: 0.1,
  availableOutgoingBitrateKbps: 4000,
};

describe('adaptive quality', () => {
  it('maps measurements to the documented quality tiers', () => {
    expect(computeQualityTier(excellent)).toBe('excellent');
    expect(computeQualityTier({ ...excellent, availableOutgoingBitrateKbps: 1200 })).toBe('good');
    expect(computeQualityTier({ ...excellent, packetLossPercent: 3 })).toBe('fair');
    expect(computeQualityTier({ ...excellent, rttMs: 400 })).toBe('poor');
    expect(computeQualityTier({ ...excellent, packetLossPercent: 11 })).toBe('critical');
  });

  it('downgrades immediately but upgrades only after five stable samples', () => {
    const controller = new AdaptiveQualityController();
    const poor = { ...excellent, rttMs: 400 };

    expect(controller.update(poor)).toBe('poor');
    for (let sample = 0; sample < 4; sample += 1) {
      expect(controller.update(excellent)).toBe('poor');
    }
    expect(controller.update(excellent)).toBe('excellent');
  });
});
