import { randomUUID } from 'node:crypto';
const samples = new Map();
const normalizeIso = (value) => new Date(value).toISOString();
export const recordFirstReceipt = (sku, vendorId, poId, lineId, approvedAt, firstReceiptAt) => {
    if (!approvedAt) {
        return;
    }
    const key = `${poId}::${lineId}`;
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
export const recordFinalReceipt = (poId, lineId, finalReceiptAt) => {
    const key = `${poId}::${lineId}`;
    const existing = samples.get(key);
    if (!existing) {
        return;
    }
    existing.finalReceiptAt = normalizeIso(finalReceiptAt);
};
const computeStatistics = (values) => {
    if (!values.length) {
        return null;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const mean = sorted.reduce((sum, value) => sum + value, 0) / n;
    const variance = sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / n;
    const stddev = Math.sqrt(Math.max(variance, 0));
    const percentile = (position) => {
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
export const getLeadTimeStats = (sku, vendorId) => {
    const normalizedSku = sku.trim().toUpperCase();
    const normalizedVendor = vendorId.trim().toUpperCase();
    const relevant = Array.from(samples.values()).filter((entry) => entry.sku === normalizedSku && entry.vendorId === normalizedVendor && entry.firstReceiptAt);
    const durations = [];
    let lastSampleAt = null;
    relevant.forEach((entry) => {
        if (!entry.firstReceiptAt)
            return;
        const start = new Date(entry.approvedAt).getTime();
        const end = entry.finalReceiptAt
            ? new Date(entry.finalReceiptAt).getTime()
            : new Date(entry.firstReceiptAt).getTime();
        if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
            durations.push(Math.round((end - start) / 86_400_000));
            lastSampleAt = entry.createdAt;
        }
    });
    const stats = computeStatistics(durations);
    if (!stats) {
        return null;
    }
    return {
        sku: normalizedSku,
        vendorId: normalizedVendor,
        count: stats.n,
        l50: stats.l50,
        l90: stats.l90,
        sigma: stats.stddev,
        lastSampleAt,
    };
};
export const recordLeadTimeSample = (sku, vendorId, poId, lineId, approvedAt, firstReceiptAt) => recordFirstReceipt(sku, vendorId, poId, lineId, approvedAt, firstReceiptAt);
export const recordFinalLeadTime = (poId, lineId, finalReceiptAt) => recordFinalReceipt(poId, lineId, finalReceiptAt);
