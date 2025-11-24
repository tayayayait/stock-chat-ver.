import { randomUUID } from 'node:crypto';
const ORDER_NUMBER_PREFIX = 'PO';
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
const buildCurrentKstOrderDate = () => {
    const shifted = new Date(Date.now() + KST_OFFSET_MS);
    return formatOrderDateParts(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
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
const incrementSequenceForDate = (dateKey) => {
    const next = peekSequenceForDate(dateKey) + 1;
    orderSequenceByDate.set(dateKey, next);
    return next;
};
const buildOrderNumber = (dateKey, sequence) => `${ORDER_NUMBER_PREFIX}-${dateKey}-${padOrderNumberSequence(sequence)}`;
export const parseOrderDateContext = (value) => parseCandidateOrderDate(value);
export const resolveOrderDateContext = (value) => parseCandidateOrderDate(value) ?? buildCurrentKstOrderDate();
export const allocatePurchaseOrderNumberForContext = (context) => {
    const sequence = incrementSequenceForDate(context.dateKey);
    return {
        ...context,
        sequence,
        orderNumber: buildOrderNumber(context.dateKey, sequence),
    };
};
export const peekNextPurchaseOrderNumberForContext = (context) => {
    const sequence = peekSequenceForDate(context.dateKey) + 1;
    return {
        ...context,
        sequence,
        orderNumber: buildOrderNumber(context.dateKey, sequence),
    };
};
const purchaseOrders = new Map();
const normalizeSku = (value) => value.trim().toUpperCase();
const ensurePositiveNumber = (value) => Math.max(0, Math.round(value));
const sanitizeStringValue = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
};
const sanitizeCurrencyValue = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.round(value);
};
const sanitizeLineInput = (line) => ({
    sku: normalizeSku(line.sku ?? ''),
    orderedQty: ensurePositiveNumber(line.orderedQty ?? 0),
    productName: sanitizeStringValue(line.productName),
    unit: sanitizeStringValue(line.unit),
    unitPrice: sanitizeCurrencyValue(line.unitPrice),
    amount: sanitizeCurrencyValue(line.amount),
    taxAmount: sanitizeCurrencyValue(line.taxAmount),
    taxLabel: sanitizeStringValue(line.taxLabel),
    currency: sanitizeStringValue(line.currency),
    taxTypeId: sanitizeStringValue(line.taxTypeId),
});
const buildLineRecords = (poId, sanitizedLines, timestamp, options) => {
    const filtered = options?.allowEmptyLines
        ? sanitizedLines
        : sanitizedLines.filter((line) => line.sku && line.orderedQty > 0);
    return filtered.map((line) => ({
        id: randomUUID(),
        poId,
        sku: line.sku,
        orderedQty: line.orderedQty,
        receivedQty: 0,
        status: 'open',
        unit: line.unit ?? 'EA',
        productName: line.productName,
        unitPrice: line.unitPrice,
        taxAmount: line.taxAmount,
        taxLabel: line.taxLabel,
        amount: line.amount,
        currency: line.currency,
        taxTypeId: line.taxTypeId,
        createdAt: timestamp,
        updatedAt: timestamp,
    }));
};
const deriveLineStatus = (orderedQty, receivedQty) => {
    if (receivedQty >= orderedQty && orderedQty > 0) {
        return 'closed';
    }
    if (receivedQty > 0) {
        return 'partial';
    }
    return 'open';
};
const deriveOrderStatus = (lines) => {
    if (lines.every((line) => line.status === 'closed')) {
        return 'closed';
    }
    if (lines.some((line) => line.status !== 'open')) {
        return 'partial';
    }
    return 'open';
};
export const createPurchaseOrder = (input) => {
    const now = new Date().toISOString();
    const id = `PO-${randomUUID().slice(0, 8)}`;
    const sanitizedVendorId = input.vendorId.trim();
    const sanitizedVendorName = sanitizeStringValue(input.vendorName) ?? sanitizedVendorId;
    const sanitizedOrderNumber = sanitizeStringValue(input.orderNumber) ?? id;
    const sanitizedLines = input.lines.map(sanitizeLineInput);
    const sanitizedReceivingMode = sanitizeStringValue(input.receivingMode);
    const sanitizedReceivingNote = sanitizeStringValue(input.receivingNote);
    const sanitizedWarehouse = sanitizeStringValue(input.warehouse);
    const lines = buildLineRecords(id, sanitizedLines, now);
    const orderDateContext = resolveOrderDateContext(input.orderDate);
    const isDraft = input.status === 'draft';
    const generatedOrderNumber = isDraft ? null : allocatePurchaseOrderNumberForContext(orderDateContext);
    const finalOrderNumber = generatedOrderNumber?.orderNumber ?? sanitizedOrderNumber;
    const finalOrderSequence = generatedOrderNumber?.sequence;
    const recordStatus = input.status === 'draft'
        ? 'draft'
        : lines.length
            ? deriveOrderStatus(lines)
            : 'closed';
    const record = {
        id,
        vendorId: sanitizedVendorId,
        vendorName: sanitizedVendorName,
        orderNumber: finalOrderNumber,
        receivingMode: sanitizedReceivingMode,
        receivingNote: sanitizedReceivingNote,
        warehouse: sanitizedWarehouse,
        memo: input.memo?.trim() || null,
        status: recordStatus,
        createdAt: now,
        approvedAt: null,
        promisedDate: input.promisedDate ?? null,
        orderDate: orderDateContext.orderDate,
        orderSequence: finalOrderSequence,
        lines,
    };
    purchaseOrders.set(id, record);
    return { ...record };
};
const applyDraftUpdate = (record, input) => {
    const now = new Date().toISOString();
    const sanitizedVendorId = input.vendorId.trim();
    const sanitizedVendorName = sanitizeStringValue(input.vendorName) ?? sanitizedVendorId;
    const sanitizedOrderNumber = sanitizeStringValue(input.orderNumber) ?? record.orderNumber;
    const orderDateUpdate = input.orderDate !== undefined ? parseOrderDateContext(input.orderDate) : null;
    record.vendorId = sanitizedVendorId;
    record.vendorName = sanitizedVendorName;
    record.orderNumber = sanitizedOrderNumber;
    if (orderDateUpdate) {
        record.orderDate = orderDateUpdate.orderDate;
    }
    if (input.memo !== undefined) {
        record.memo = input.memo.trim() || null;
    }
    if (input.promisedDate !== undefined) {
        const trimmedDate = input.promisedDate.trim();
        record.promisedDate = trimmedDate === '' ? null : trimmedDate;
    }
    if (input.receivingMode !== undefined) {
        record.receivingMode = sanitizeStringValue(input.receivingMode);
    }
    if (input.receivingNote !== undefined) {
        record.receivingNote = sanitizeStringValue(input.receivingNote);
    }
    if (input.warehouse !== undefined) {
        record.warehouse = sanitizeStringValue(input.warehouse);
    }
    if (input.lines) {
        const sanitizedLines = input.lines.map(sanitizeLineInput);
        record.lines = buildLineRecords(record.id, sanitizedLines, now);
    }
    purchaseOrders.set(record.id, record);
    return { ...record, lines: [...record.lines] };
};
export const savePurchaseOrderDraft = (input) => {
    if (input.id) {
        const existing = purchaseOrders.get(input.id);
        if (!existing) {
            throw new Error('Purchase order not found');
        }
        if (existing.status !== 'draft') {
            throw new Error('Drafts can only be updated while in draft status');
        }
        return applyDraftUpdate(existing, input);
    }
    const created = createPurchaseOrder({ ...input, status: 'draft' });
    return created;
};
export const listPurchaseOrders = (options) => {
    const { from, to } = options ?? {};
    const records = Array.from(purchaseOrders.values()).filter((record) => {
        const createdAtMs = Date.parse(record.createdAt);
        if (Number.isNaN(createdAtMs)) {
            return true;
        }
        if (from !== undefined && createdAtMs < from) {
            return false;
        }
        if (to !== undefined && createdAtMs > to) {
            return false;
        }
        return true;
    });
    return records.map((record) => ({ ...record, lines: [...record.lines] }));
};
export const getPurchaseOrder = (id) => {
    const record = purchaseOrders.get(id);
    return record ? { ...record, lines: [...record.lines] } : null;
};
export const approvePurchaseOrder = (id, approvedAt) => {
    const record = purchaseOrders.get(id);
    if (!record) {
        return null;
    }
    record.approvedAt = approvedAt ?? new Date().toISOString();
    purchaseOrders.set(id, record);
    return { ...record, lines: [...record.lines] };
};
export const cancelPurchaseOrder = (id) => {
    const record = purchaseOrders.get(id);
    if (!record) {
        return null;
    }
    record.status = 'canceled';
    purchaseOrders.set(id, record);
    return { ...record, lines: [...record.lines] };
};
export const deletePurchaseOrder = (id) => {
    const record = purchaseOrders.get(id);
    if (!record) {
        return null;
    }
    purchaseOrders.delete(id);
    return { ...record, lines: [...record.lines] };
};
export const recordPurchaseReceipt = (poId, lineId, quantity, receivedAt) => {
    const record = purchaseOrders.get(poId);
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
    const previousReceivedQty = line.receivedQty;
    line.receivedQty = Math.min(line.orderedQty, line.receivedQty + qty);
    line.status = deriveLineStatus(line.orderedQty, line.receivedQty);
    line.updatedAt = receivedAt ?? new Date().toISOString();
    record.status = deriveOrderStatus(record.lines);
    purchaseOrders.set(poId, record);
    return {
        order: { ...record, lines: [...record.lines] },
        previousReceivedQty,
        line: { ...line },
    };
};
