export type QualityTier = 'critical' | 'poor' | 'fair' | 'good' | 'excellent';

export interface QualityMetrics {
  rttMs: number;
  jitterMs: number;
  packetLossPercent: number;
  availableOutgoingBitrateKbps: number;
}

const rank: Record<QualityTier, number> = {
  critical: 0,
  poor: 1,
  fair: 2,
  good: 3,
  excellent: 4,
};

export function computeQualityTier(metrics: QualityMetrics): QualityTier {
  const { rttMs, packetLossPercent: loss, availableOutgoingBitrateKbps: bandwidth } = metrics;

  if (rttMs > 500 || loss > 10 || bandwidth < 50) return 'critical';
  if (rttMs >= 350 || loss >= 5 || bandwidth < 300) return 'poor';
  if (rttMs >= 200 || loss >= 2 || bandwidth < 800) return 'fair';
  if (rttMs >= 100 || loss >= 0.5 || bandwidth < 2500) return 'good';
  return 'excellent';
}

/** Downgrades immediately and requires repeated healthy samples to upgrade. */
export class AdaptiveQualityController {
  private tier: QualityTier;
  private stableSamples = 0;

  constructor(initialTier: QualityTier = 'excellent', private readonly samplesToUpgrade = 5) {
    this.tier = initialTier;
  }

  get currentTier(): QualityTier {
    return this.tier;
  }

  update(metrics: QualityMetrics): QualityTier {
    const target = computeQualityTier(metrics);

    if (rank[target] < rank[this.tier]) {
      this.tier = target;
      this.stableSamples = 0;
    } else if (rank[target] > rank[this.tier]) {
      this.stableSamples += 1;
      if (this.stableSamples >= this.samplesToUpgrade) {
        this.tier = target;
        this.stableSamples = 0;
      }
    } else {
      this.stableSamples = 0;
    }

    return this.tier;
  }
}
