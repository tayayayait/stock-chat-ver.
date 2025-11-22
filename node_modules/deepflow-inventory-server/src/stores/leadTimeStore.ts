import { randomUUID } from 'node:crypto';

type LineKey = `${string}::${string}`;

interface LeadTimeSample {
  id: string;
  sku: string;
  vendorId: string;
  lineKey: LineKey;
  approvedAt: string;
  firstReceiptAt: string | null;
  finalReceiptAt: string | null;
  createdAt: string;
}

const samples = new Map<LineKey, LeadTimeSample>();

const normalizeIso = (value: string): string => new Date(value).toISOString();

export const recordFirstReceipt = (
  sku: string,
  vendorId: string,
  poId: string,
  lineId: string,
  approvedAt: string,
  firstReceiptAt: string,
): void => {
  if (!approvedAt) {
    return;
  }
  const key = `${poId}::${lineId}` as LineKey;
  const existing = samples.get(key);
  if (existing) {
    if (!existing.firstReceiptAt) {
      existing.firstReceiptAt = normalizeIso(firstReceiptAt);
    }
    return;
  }
  samples.set(key, {
    id: randomUUID(),
    sku,
    vendorId,
    lineKey: key,
    approvedAt: normalizeIso(approvedAt),
    firstReceiptAt: normalizeIso(firstReceiptAt),
    finalReceiptAt: null,
    createdAt: new Date().toISOString(),
  });
};

export const recordFinalReceipt = (
  poId: string,
  lineId: string,
  finalReceiptAt: string,
): void => {
  const key = `${poId}::${lineId}` as LineKey;
  const existing = samples.get(key);
  if (!existing) {
    return;
  }
  existing.finalReceiptAt = normalizeIso(finalReceiptAt);
};

const computeStatistics = (values: number[]) => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
  const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
  const stddev = Math.sqrt(Math.max(variance, 0));
  const percentile = (position: number) => {
    const idx = Math.min(n - 1, Math.floor((position / 100) * n));
    return sorted[idx];
  };
  return {
    n,
    mean,
    stddev,
    l50: percentile(50),
    l90: percentile(90),
    recent: sorted[n - 1],
  };
};

export interface LeadTimeStats {
  sku: string;
  vendorId: string;
  count: number;
  l50: number;
  l90: number;
  sigma: number;
  lastSampleAt: string | null;
}

const buildLeadTimeStats = (
  sku: string,
  vendorId: string,
  durations: number[],
  lastSampleAt: string | null,
): LeadTimeStats | null => {
  const stats = computeStatistics(durations);
  if (!stats) {
    return null;
  }
  return {
    sku,
    vendorId,
    count: stats.n,
    l50: stats.l50,
    l90: stats.l90,
    sigma: stats.stddev,
    lastSampleAt,
  };
};

const collectLeadTimeDurations = (entries: LeadTimeSample[]) => {
  const durations: number[] = [];
  let lastSampleAt: string | null = null;
  entries.forEach((entry) => {
    if (!entry.firstReceiptAt) {
      return;
    }
    const start = Date.parse(entry.approvedAt);
    const end = entry.finalReceiptAt ? Date.parse(entry.finalReceiptAt) : Date.parse(entry.firstReceiptAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      return;
    }
    durations.push(Math.round((end - start) / 86_400_000));
    lastSampleAt = entry.createdAt;
  });
  return { durations, lastSampleAt };
};

export const getLeadTimeStats = (sku: string, vendorId: string): LeadTimeStats | null => {
  const normalizedSku = sku.trim().toUpperCase();
  const normalizedVendor = vendorId.trim().toUpperCase();
  const relevant = Array.from(samples.values()).filter(
    (entry) => entry.sku === normalizedSku && entry.vendorId === normalizedVendor,
  );
  const { durations, lastSampleAt } = collectLeadTimeDurations(relevant);
  return buildLeadTimeStats(normalizedSku, normalizedVendor, durations, lastSampleAt);
};

export const getLeadTimeStatsForSku = (sku: string): LeadTimeStats | null => {
  const normalizedSku = sku.trim().toUpperCase();
  const relevant = Array.from(samples.values()).filter((entry) => entry.sku === normalizedSku);
  const { durations, lastSampleAt } = collectLeadTimeDurations(relevant);
  return buildLeadTimeStats(normalizedSku, 'AGGREGATED', durations, lastSampleAt);
};

export const recordLeadTimeSample = (
  sku: string,
  vendorId: string,
  poId: string,
  lineId: string,
  approvedAt: string,
  firstReceiptAt: string,
) => recordFirstReceipt(sku, vendorId, poId, lineId, approvedAt, firstReceiptAt);

export const recordFinalLeadTime = (poId: string, lineId: string, finalReceiptAt: string) =>
  recordFinalReceipt(poId, lineId, finalReceiptAt);
