import { describe, expect, it } from 'vitest';

import { computeLeadTimeBaseline, computeServiceLevelBaseline } from '../../server/src/services/forecastBaselines.js';

describe('forecast baselines', () => {
  it('falls back to default lead time when SKU is missing', () => {
    const baseline = computeLeadTimeBaseline({ sku: '' });
    expect(baseline.leadTimeDays).toBe(14);
    expect(baseline.notes.some((note) => note.includes('기본'))).toBe(true);
  });

  it('uses base service level when product metadata is unavailable', () => {
    const baseline = computeServiceLevelBaseline({ sku: '' });
    expect(baseline.serviceLevelPercent).toBeGreaterThanOrEqual(95);
    expect(baseline.notes.some((note) => note.includes('기본'))).toBe(true);
  });
});
