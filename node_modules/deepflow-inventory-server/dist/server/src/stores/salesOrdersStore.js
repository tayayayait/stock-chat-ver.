import { randomUUID } from 'node:crypto';
const ORDER_NUMBER_PREFIX = 'SO';
const ORDER_NUMBER_SEQUENCE_WIDTH = 3;
const KST_OFFSET_HOURS = 9;
const KST_OFFSET_MS = KST_OFFSET_HOURS * 60 * 60 * 1000;
const ORDER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const padOrderNumberSequence = (sequence) => String(sequence).padStart(ORDER_NUMBER_SEQUENCE_WIDTH, '0');
const formatOrderDateParts = (year, month, day) => {
    const yearStr = String(year).padStart(4, '0');
    const monthStr = String(month).padStart(2, '0');
    const dayStr = String(day).padStart(2, '0');
    return {
        dateKey: `${yearStr}${monthStr}${dayStr}`,
        orderDate: `${yearStr}-${monthStr}-${dayStr}`,
    };
};
const parseCandidateOrderDate = (value) => {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    const timestamp = Date.parse(trimmed);
    if (Number.isNaN(timestamp)) {
        const match = ORDER_DATE_PATTERN.exec(trimmed);
        if (!match) {
            return null;
        }
        const [, year, month, day] = match;
        const fallback = Date.parse(`${year}-${month}-${day}T00:00:00+09:00`);
        if (Number.isNaN(fallback)) {
            return null;
        }
        return formatOrderDateParts(year, month, day);
    }
    const shifted = new Date(timestamp + KST_OFFSET_MS);
    return formatOrderDateParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
};
const orderSequenceByDate = new Map();
const peekSequenceForDate = (dateKey) => orderSequenceByDate.get(dateKey) ?? 0;
const buildOrderNumber = (dateKey, sequence) => `${ORDER_NUMBER_PREFIX}-${dateKey}-${padOrderNumberSequence(sequence)}`;
export const parseOrderDateContext = (value) => parseCandidateOrderDate(value);
export const peekNextSalesOrderNumberForContext = (context) => {
    const sequence = peekSequenceForDate(context.dateKey) + 1;
    return {
        ...context,
        sequence,
        orderNumber: buildOrderNumber(context.dateKey, sequence),
    };
};
const salesOrders = new Map();
const normalizeSku = (value) => value.trim().toUpperCase();
const ensurePositiveNumber = (value) => Math.max(0, Math.round(value));
const deriveLineStatus = (orderedQty, shippedQty) => {
    if (shippedQty >= orderedQty && orderedQty > 0) {
        return 'closed';
    }
    if (shippedQty > 0) {
        return 'partial';
    }
    return 'open';
};
const deriveOrderStatus = (lines) => {
    if (lines.every((line) => line.status === 'closed')) {
        return 'closed';
    }
    if (lines.some((line) => line.status === 'partial')) {
        return 'packed';
    }
    return 'open';
};
export const createSalesOrder = (input) => {
    const now = new Date().toISOString();
    const id = `SO-${randomUUID().slice(0, 8)}`;
    const lines = input.lines
        .map((line) => ({
        sku: normalizeSku(line.sku),
        orderedQty: ensurePositiveNumber(line.orderedQty),
    }))
        .filter((line) => line.sku && line.orderedQty > 0)
        .map((line) => ({
        id: randomUUID(),
        soId: id,
        sku: line.sku,
        orderedQty: line.orderedQty,
        shippedQty: 0,
        status: 'open',
        createdAt: now,
        updatedAt: now,
    }));
    const record = {
        id,
        customerId: input.customerId.trim(),
        memo: input.memo?.trim() || null,
        status: lines.length ? 'open' : 'closed',
        createdAt: now,
        promisedDate: input.promisedDate ?? null,
        lines,
    };
    salesOrders.set(id, record);
    return { ...record, lines: [...record.lines] };
};
export const listSalesOrders = () => Array.from(salesOrders.values()).map((record) => ({ ...record, lines: [...record.lines] }));
export const getSalesOrder = (id) => {
    const record = salesOrders.get(id);
    return record ? { ...record, lines: [...record.lines] } : null;
};
export const cancelSalesOrder = (id) => {
    const record = salesOrders.get(id);
    if (!record) {
        return null;
    }
    record.status = 'canceled';
    salesOrders.set(id, record);
    return { ...record, lines: [...record.lines] };
};
export const recordSalesShipment = (soId, lineId, quantity, shippedAt) => {
    const record = salesOrders.get(soId);
    if (!record) {
        return null;
    }
    const line = record.lines.find((entry) => entry.id === lineId);
    if (!line) {
        return null;
    }
    const qty = Math.min(line.orderedQty, ensurePositiveNumber(quantity));
    if (qty <= 0) {
        return null;
    }
    const previousShippedQty = line.shippedQty;
    line.shippedQty = Math.min(line.orderedQty, line.shippedQty + qty);
    line.status = deriveLineStatus(line.orderedQty, line.shippedQty);
    line.updatedAt = shippedAt ?? new Date().toISOString();
    record.status = deriveOrderStatus(record.lines);
    salesOrders.set(soId, record);
    return {
        order: { ...record, lines: [...record.lines] },
        previousShippedQty,
        line: { ...line },
    };
};
