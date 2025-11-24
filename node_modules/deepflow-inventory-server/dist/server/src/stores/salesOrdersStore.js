import { randomUUID } from 'node:crypto';
import { getAvailableInventoryForSku, InventoryReservationError, releaseInventoryReservation, reserveInventoryForSku, } from './inventoryStore.js';
const ORDER_NUMBER_PREFIX = 'SO';
const ORDER_NUMBER_SEQUENCE_WIDTH = 3;
const KST_OFFSET_HOURS = 9;
const KST_OFFSET_MS = KST_OFFSET_HOURS * 60 * 60 * 1000;
const ORDER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DEFAULT_TENANT_ID = 'default';
const SEQUENCE_KEY_DELIMITER = '::';
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
const buildCurrentKstOrderDate = () => {
    const shifted = new Date(Date.now() + KST_OFFSET_MS);
    return formatOrderDateParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
};
const normalizeTenantId = (value) => {
    if (typeof value !== 'string') {
        return DEFAULT_TENANT_ID;
    }
    const trimmed = value.trim();
    return trimmed === '' ? DEFAULT_TENANT_ID : trimmed;
};
const buildOrderNumber = (dateKey, sequence) => `${ORDER_NUMBER_PREFIX}-${dateKey}-${padOrderNumberSequence(sequence)}`;
export const parseOrderDateContext = (value) => parseCandidateOrderDate(value);
export const resolveOrderDateContext = (value) => parseCandidateOrderDate(value) ?? buildCurrentKstOrderDate();
const salesOrders = new Map();
const orderSequenceByTenantDate = new Map();
const orderNumbersInUse = new Set();
const buildSequenceCacheKey = (tenantId, dateKey) => `${tenantId}${SEQUENCE_KEY_DELIMITER}${dateKey}`;
const buildOrderNumberCacheKey = (tenantId, orderNumber) => `${tenantId}${SEQUENCE_KEY_DELIMITER}${orderNumber}`;
const extractSequenceFromOrderNumber = (orderNumber, dateKey) => {
    const prefix = `${ORDER_NUMBER_PREFIX}-${dateKey}-`;
    if (!orderNumber.startsWith(prefix)) {
        return undefined;
    }
    const sequencePart = orderNumber.slice(prefix.length);
    if (!sequencePart) {
        return undefined;
    }
    const value = Number.parseInt(sequencePart, 10);
    return Number.isNaN(value) ? undefined : value;
};
const getRecordTenantId = (record) => normalizeTenantId(record.tenantId);
const computeMaxSequenceForContext = (context) => {
    let highest = 0;
    for (const record of salesOrders.values()) {
        if (getRecordTenantId(record) !== context.tenantId) {
            continue;
        }
        if (record.orderDate !== context.orderDate) {
            continue;
        }
        const candidate = record.orderSequence ?? extractSequenceFromOrderNumber(record.orderNumber, context.dateKey);
        if (typeof candidate === 'number' && candidate > highest) {
            highest = candidate;
        }
    }
    return highest;
};
const syncSequenceCacheForContext = (context) => {
    const cacheKey = buildSequenceCacheKey(context.tenantId, context.dateKey);
    const cached = orderSequenceByTenantDate.get(cacheKey) ?? 0;
    const highestFromOrders = computeMaxSequenceForContext(context);
    const max = Math.max(cached, highestFromOrders);
    if (max !== cached) {
        orderSequenceByTenantDate.set(cacheKey, max);
    }
    return max;
};
const allocateSequenceForContext = (context) => {
    const cacheKey = buildSequenceCacheKey(context.tenantId, context.dateKey);
    const base = syncSequenceCacheForContext(context);
    const next = base + 1;
    orderSequenceByTenantDate.set(cacheKey, next);
    return next;
};
const peekSequenceForContext = (context) => syncSequenceCacheForContext(context) + 1;
const isOrderNumberReserved = (tenantId, orderNumber) => orderNumbersInUse.has(buildOrderNumberCacheKey(tenantId, orderNumber));
const markOrderNumberAsUsed = (tenantId, orderNumber) => {
    orderNumbersInUse.add(buildOrderNumberCacheKey(tenantId, orderNumber));
};
const unmarkOrderNumberAsUsed = (tenantId, orderNumber) => {
    orderNumbersInUse.delete(buildOrderNumberCacheKey(tenantId, orderNumber));
};
export const buildSalesOrderNumberContext = (dateContext, tenantId) => ({
    ...dateContext,
    tenantId: normalizeTenantId(tenantId),
});
export const allocateSalesOrderNumberForContext = (context) => {
    const sequence = allocateSequenceForContext(context);
    return {
        ...context,
        sequence,
        orderNumber: buildOrderNumber(context.dateKey, sequence),
    };
};
export const peekNextSalesOrderNumberForContext = (context) => {
    const sequence = peekSequenceForContext(context);
    return {
        ...context,
        sequence,
        orderNumber: buildOrderNumber(context.dateKey, sequence),
    };
};
const sanitizeStringValue = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
};
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
    const normalizeLineValue = (value) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    const lines = input.lines
        .map((line) => ({
        sku: normalizeSku(line.sku),
        orderedQty: ensurePositiveNumber(line.orderedQty),
        productName: line.productName?.trim() || undefined,
        unit: line.unit?.trim() || undefined,
        unitPrice: normalizeLineValue(line.unitPrice),
        amount: normalizeLineValue(line.amount),
        taxAmount: normalizeLineValue(line.taxAmount),
        taxLabel: line.taxLabel?.trim() || undefined,
        currency: line.currency?.trim() || undefined,
        taxTypeId: line.taxTypeId?.trim() || undefined,
    }))
        .filter((line) => line.sku && line.orderedQty > 0)
        .map((line) => ({
        id: randomUUID(),
        soId: id,
        sku: line.sku,
        orderedQty: line.orderedQty,
        shippedQty: 0,
        status: 'open',
        productName: line.productName,
        unit: line.unit,
        unitPrice: line.unitPrice,
        amount: line.amount,
        taxAmount: line.taxAmount,
        taxLabel: line.taxLabel,
        currency: line.currency,
        taxTypeId: line.taxTypeId,
        createdAt: now,
        updatedAt: now,
    }));
    const requestedQuantities = new Map();
    lines.forEach((line) => {
        if (line.orderedQty <= 0) {
            return;
        }
        const existing = requestedQuantities.get(line.sku) ?? 0;
        requestedQuantities.set(line.sku, existing + line.orderedQty);
    });
    for (const [sku, qty] of requestedQuantities.entries()) {
        const available = getAvailableInventoryForSku(sku);
        if (qty > available) {
            throw new InventoryReservationError(`SKU ${sku}에 ${available}개만 가용합니다.`);
        }
    }
    const sanitizedCustomerId = input.customerId.trim();
    const sanitizedCustomerName = sanitizeStringValue(input.customerName) ?? sanitizedCustomerId;
    const sanitizedOrderNumber = sanitizeStringValue(input.orderNumber);
    const orderDateContext = resolveOrderDateContext(input.orderDate);
    const numberingContext = buildSalesOrderNumberContext(orderDateContext, input.tenantId);
    const generatedNumber = sanitizedOrderNumber === undefined
        ? allocateSalesOrderNumberForContext(numberingContext)
        : undefined;
    const finalOrderNumber = sanitizedOrderNumber ?? generatedNumber?.orderNumber ?? `SO-${randomUUID().slice(0, 8)}`;
    const finalSequence = generatedNumber?.sequence ??
        extractSequenceFromOrderNumber(finalOrderNumber, numberingContext.dateKey);
    if (sanitizedOrderNumber && isOrderNumberReserved(numberingContext.tenantId, finalOrderNumber)) {
        throw new Error('이미 사용 중인 주문번호입니다.');
    }
    const reservations = [];
    try {
        for (const line of lines) {
            if (line.orderedQty <= 0) {
                continue;
            }
            reserveInventoryForSku(line.sku, line.orderedQty);
            reservations.push({ sku: line.sku, qty: line.orderedQty });
        }
        markOrderNumberAsUsed(numberingContext.tenantId, finalOrderNumber);
        const record = {
            id,
            tenantId: numberingContext.tenantId,
            customerId: sanitizedCustomerId,
            customerName: sanitizedCustomerName,
            status: lines.length ? 'open' : 'closed',
            orderNumber: finalOrderNumber,
            orderDate: numberingContext.orderDate,
            orderSequence: finalSequence,
            memo: input.memo?.trim() || null,
            createdAt: now,
            confirmedAt: now,
            updatedAt: now,
            promisedDate: input.promisedDate ?? null,
            lines,
        };
        salesOrders.set(id, record);
        return { ...record, lines: [...record.lines] };
    }
    catch (error) {
        reservations.forEach((entry) => releaseInventoryReservation(entry.sku, entry.qty));
        throw error;
    }
};
export const listSalesOrders = (filters = {}) => {
    const { from, to, tenantId } = filters;
    return Array.from(salesOrders.values())
        .filter((record) => {
        if (tenantId && getRecordTenantId(record) !== tenantId) {
            return false;
        }
        if (from !== undefined || to !== undefined) {
            const timestamp = Date.parse(record.orderDate);
            if (Number.isNaN(timestamp)) {
                return false;
            }
            if (from !== undefined && timestamp < from) {
                return false;
            }
            if (to !== undefined && timestamp > to) {
                return false;
            }
        }
        return true;
    })
        .map((record) => ({ ...record, lines: [...record.lines] }));
};
export const getSalesOrder = (id) => {
    const record = salesOrders.get(id);
    return record ? { ...record, lines: [...record.lines] } : null;
};
export const cancelSalesOrder = (id) => {
    const record = salesOrders.get(id);
    if (!record) {
        return null;
    }
    record.lines.forEach((line) => {
        const remaining = Math.max(0, line.orderedQty - line.shippedQty);
        if (remaining > 0) {
            releaseInventoryReservation(line.sku, remaining);
        }
    });
    record.status = 'canceled';
    record.updatedAt = new Date().toISOString();
    salesOrders.set(id, record);
    return { ...record, lines: [...record.lines] };
};
export const deleteSalesOrder = (id) => {
    const record = salesOrders.get(id);
    if (!record) {
        return null;
    }
    record.lines.forEach((line) => {
        const remaining = Math.max(0, line.orderedQty - line.shippedQty);
        if (remaining > 0) {
            releaseInventoryReservation(line.sku, remaining);
        }
    });
    unmarkOrderNumberAsUsed(getRecordTenantId(record), record.orderNumber);
    salesOrders.delete(id);
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
    const finalUpdatedAt = shippedAt ?? new Date().toISOString();
    line.updatedAt = finalUpdatedAt;
    record.status = deriveOrderStatus(record.lines);
    record.updatedAt = finalUpdatedAt;
    salesOrders.set(soId, record);
    return {
        order: { ...record, lines: [...record.lines] },
        previousShippedQty,
        line: { ...line },
    };
};
const salesOrderDrafts = new Map();
const cloneLines = (lines) => lines.map((line) => ({ ...line }));
export const saveSalesOrderDraft = (payload) => {
    const normalizedId = payload.id?.trim();
    if (!payload.customerId.trim()) {
        throw new Error('customerId is required');
    }
    if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
        throw new Error('lines are required');
    }
    const now = new Date().toISOString();
    const id = normalizedId || `SOD-${randomUUID().slice(0, 8)}`;
    const existing = normalizedId ? salesOrderDrafts.get(normalizedId) : undefined;
    if (normalizedId && !existing) {
        throw new Error('Draft not found');
    }
    const draftTenantId = normalizeTenantId(payload.tenantId ?? existing?.tenantId);
    const sanitizedShippingMode = payload.shippingMode?.trim();
    const effectiveShippingMode = sanitizedShippingMode || existing?.shippingMode || '즉시출고';
    const shippingNoteValue = payload.shippingNote?.trim() ?? existing?.shippingNote ?? null;
    const warehouseValue = payload.warehouse?.trim() ?? existing?.warehouse ?? '';
    const record = {
        id,
        status: 'draft',
        customerId: payload.customerId.trim(),
        customerName: payload.customerName?.trim() || undefined,
        orderNumber: payload.orderNumber?.trim() || undefined,
        orderDate: payload.orderDate?.trim() || undefined,
        tenantId: draftTenantId,
        memo: payload.memo?.trim() ?? null,
        promisedDate: payload.promisedDate ?? null,
        shippingMode: effectiveShippingMode,
        shippingNote: shippingNoteValue,
        warehouse: warehouseValue,
        lines: cloneLines(payload.lines),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
    };
    salesOrderDrafts.set(id, record);
    return { ...record, lines: cloneLines(record.lines) };
};
const getDraftTimestamp = (draft) => {
    const value = draft.orderDate || draft.createdAt;
    if (!value) {
        return null;
    }
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
};
const cloneDraft = (draft) => ({
    ...draft,
    lines: cloneLines(draft.lines),
});
export const listSalesOrderDrafts = (filters = {}) => {
    const { from, to, tenantId } = filters;
    return Array.from(salesOrderDrafts.values())
        .filter((draft) => {
        if (tenantId && getRecordTenantId(draft) !== tenantId) {
            return false;
        }
        if (from !== undefined || to !== undefined) {
            const timestamp = getDraftTimestamp(draft);
            if (timestamp === null) {
                return false;
            }
            if (from !== undefined && timestamp < from) {
                return false;
            }
            if (to !== undefined && timestamp > to) {
                return false;
            }
        }
        return true;
    })
        .sort((a, b) => {
        const aTime = Date.parse(a.updatedAt);
        const bTime = Date.parse(b.updatedAt);
        if (Number.isNaN(aTime) || Number.isNaN(bTime)) {
            return 0;
        }
        return bTime - aTime;
    })
        .map(cloneDraft);
};
export const getSalesOrderDraft = (id) => {
    const draft = salesOrderDrafts.get(id);
    return draft ? cloneDraft(draft) : null;
};
export const deleteSalesOrderDraft = (id) => {
    const draft = salesOrderDrafts.get(id);
    if (!draft) {
        return null;
    }
    salesOrderDrafts.delete(id);
    return cloneDraft(draft);
};
