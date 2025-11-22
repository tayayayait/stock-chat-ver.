import { randomUUID } from 'node:crypto';
import {
  getAvailableInventoryForSku,
  InventoryReservationError,
  releaseInventoryReservation,
  reserveInventoryForSku,
} from './inventoryStore.js';

const ORDER_NUMBER_PREFIX = 'SO';
const ORDER_NUMBER_SEQUENCE_WIDTH = 3;
const KST_OFFSET_HOURS = 9;
const KST_OFFSET_MS = KST_OFFSET_HOURS * 60 * 60 * 1000;
const ORDER_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
export const DEFAULT_TENANT_ID = 'default';
const SEQUENCE_KEY_DELIMITER = '::';

export interface OrderDateContext {
  dateKey: string;
  orderDate: string;
}

export interface SalesOrderNumberContext extends OrderDateContext {
  tenantId: string;
}

const padOrderNumberSequence = (sequence: number) =>
  String(sequence).padStart(ORDER_NUMBER_SEQUENCE_WIDTH, '0');

const formatOrderDateParts = (year: number | string, month: number | string, day: number | string): OrderDateContext => {
  const yearStr = String(year).padStart(4, '0');
  const monthStr = String(month).padStart(2, '0');
  const dayStr = String(day).padStart(2, '0');
  return {
    dateKey: `${yearStr}${monthStr}${dayStr}`,
    orderDate: `${yearStr}-${monthStr}-${dayStr}`,
  };
};

const parseCandidateOrderDate = (value?: string): OrderDateContext | null => {
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
  return formatOrderDateParts(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
};

const buildCurrentKstOrderDate = (): OrderDateContext => {
  const shifted = new Date(Date.now() + KST_OFFSET_MS);
  return formatOrderDateParts(
    shifted.getUTCFullYear(),
  shifted.getUTCMonth() + 1,
  shifted.getUTCDate(),
  );
};

const normalizeTenantId = (value?: string): string => {
  if (typeof value !== 'string') {
    return DEFAULT_TENANT_ID;
  }
  const trimmed = value.trim();
  return trimmed === '' ? DEFAULT_TENANT_ID : trimmed;
};

const buildOrderNumber = (dateKey: string, sequence: number) =>
  `${ORDER_NUMBER_PREFIX}-${dateKey}-${padOrderNumberSequence(sequence)}`;

export const parseOrderDateContext = (value?: string): OrderDateContext | null => parseCandidateOrderDate(value);

export const resolveOrderDateContext = (value?: string): OrderDateContext =>
  parseCandidateOrderDate(value) ?? buildCurrentKstOrderDate();

export type SalesOrderStatus = 'open' | 'alloc' | 'picking' | 'packed' | 'closed' | 'canceled';
export type SalesOrderLineStatus = 'open' | 'partial' | 'closed';

export interface SalesOrderLineRecord {
  id: string;
  soId: string;
  sku: string;
  orderedQty: number;
  shippedQty: number;
  status: SalesOrderLineStatus;
  productName?: string;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  taxAmount?: number;
  taxLabel?: string;
  currency?: string;
  taxTypeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalesOrderRecord {
  id: string;
  tenantId: string;
  customerId: string;
  customerName: string;
  status: SalesOrderStatus;
  orderNumber: string;
  orderDate: string;
  orderSequence?: number;
  memo: string | null;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
  promisedDate: string | null;
  lines: SalesOrderLineRecord[];
}

const salesOrders = new Map<string, SalesOrderRecord>();

const orderSequenceByTenantDate = new Map<string, number>();
const orderNumbersInUse = new Set<string>();

const buildSequenceCacheKey = (tenantId: string, dateKey: string) =>
  `${tenantId}${SEQUENCE_KEY_DELIMITER}${dateKey}`;
const buildOrderNumberCacheKey = (tenantId: string, orderNumber: string) =>
  `${tenantId}${SEQUENCE_KEY_DELIMITER}${orderNumber}`;

const extractSequenceFromOrderNumber = (orderNumber: string, dateKey: string): number | undefined => {
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

const getRecordTenantId = (record: SalesOrderRecord): string => normalizeTenantId(record.tenantId);

const computeMaxSequenceForContext = (context: SalesOrderNumberContext) => {
  let highest = 0;
  for (const record of salesOrders.values()) {
    if (getRecordTenantId(record) !== context.tenantId) {
      continue;
    }
    if (record.orderDate !== context.orderDate) {
      continue;
    }
    const candidate =
      record.orderSequence ?? extractSequenceFromOrderNumber(record.orderNumber, context.dateKey);
    if (typeof candidate === 'number' && candidate > highest) {
      highest = candidate;
    }
  }
  return highest;
};

const syncSequenceCacheForContext = (context: SalesOrderNumberContext) => {
  const cacheKey = buildSequenceCacheKey(context.tenantId, context.dateKey);
  const cached = orderSequenceByTenantDate.get(cacheKey) ?? 0;
  const highestFromOrders = computeMaxSequenceForContext(context);
  const max = Math.max(cached, highestFromOrders);
  if (max !== cached) {
    orderSequenceByTenantDate.set(cacheKey, max);
  }
  return max;
};

const allocateSequenceForContext = (context: SalesOrderNumberContext) => {
  const cacheKey = buildSequenceCacheKey(context.tenantId, context.dateKey);
  const base = syncSequenceCacheForContext(context);
  const next = base + 1;
  orderSequenceByTenantDate.set(cacheKey, next);
  return next;
};

const peekSequenceForContext = (context: SalesOrderNumberContext) => syncSequenceCacheForContext(context) + 1;

const isOrderNumberReserved = (tenantId: string, orderNumber: string) =>
  orderNumbersInUse.has(buildOrderNumberCacheKey(tenantId, orderNumber));
const markOrderNumberAsUsed = (tenantId: string, orderNumber: string) => {
  orderNumbersInUse.add(buildOrderNumberCacheKey(tenantId, orderNumber));
};

const unmarkOrderNumberAsUsed = (tenantId: string, orderNumber: string) => {
  orderNumbersInUse.delete(buildOrderNumberCacheKey(tenantId, orderNumber));
};

export const buildSalesOrderNumberContext = (
  dateContext: OrderDateContext,
  tenantId?: string,
): SalesOrderNumberContext => ({
  ...dateContext,
  tenantId: normalizeTenantId(tenantId),
});

export const allocateSalesOrderNumberForContext = (context: SalesOrderNumberContext) => {
  const sequence = allocateSequenceForContext(context);
  return {
    ...context,
    sequence,
    orderNumber: buildOrderNumber(context.dateKey, sequence),
  };
};

export const peekNextSalesOrderNumberForContext = (context: SalesOrderNumberContext) => {
  const sequence = peekSequenceForContext(context);
  return {
    ...context,
    sequence,
    orderNumber: buildOrderNumber(context.dateKey, sequence),
  };
};

const sanitizeStringValue = (value?: string | null): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
};

const normalizeSku = (value: string): string => value.trim().toUpperCase();
const ensurePositiveNumber = (value: number): number => Math.max(0, Math.round(value));

const deriveLineStatus = (orderedQty: number, shippedQty: number): SalesOrderLineStatus => {
  if (shippedQty >= orderedQty && orderedQty > 0) {
    return 'closed';
  }
  if (shippedQty > 0) {
    return 'partial';
  }
  return 'open';
};

const deriveOrderStatus = (lines: SalesOrderLineRecord[]): SalesOrderStatus => {
  if (lines.every((line) => line.status === 'closed')) {
    return 'closed';
  }
  if (lines.some((line) => line.status === 'partial')) {
    return 'packed';
  }
  return 'open';
};

export interface SalesOrderLineInput {
  sku: string;
  orderedQty: number;
  productName?: string;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  taxAmount?: number;
  taxLabel?: string;
  currency?: string;
  taxTypeId?: string;
}

export interface CreateSalesOrderInput {
  tenantId?: string;
  customerId: string;
  customerName?: string;
  orderNumber?: string;
  orderDate?: string;
  memo?: string;
  promisedDate?: string;
  lines: SalesOrderLineInput[];
}

export const createSalesOrder = (input: CreateSalesOrderInput): SalesOrderRecord => {
  const now = new Date().toISOString();
  const id = `SO-${randomUUID().slice(0, 8)}`;
  const normalizeLineValue = (value?: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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
      status: 'open' as SalesOrderLineStatus,
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

  const requestedQuantities = new Map<string, number>();
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

  const generatedNumber =
    sanitizedOrderNumber === undefined
      ? allocateSalesOrderNumberForContext(numberingContext)
      : undefined;
  const finalOrderNumber =
    sanitizedOrderNumber ?? generatedNumber?.orderNumber ?? `SO-${randomUUID().slice(0, 8)}`;
  const finalSequence =
    generatedNumber?.sequence ??
    extractSequenceFromOrderNumber(finalOrderNumber, numberingContext.dateKey);

  if (sanitizedOrderNumber && isOrderNumberReserved(numberingContext.tenantId, finalOrderNumber)) {
    throw new Error('이미 사용 중인 주문번호입니다.');
  }

  const reservations: Array<{ sku: string; qty: number }> = [];
  try {
    for (const line of lines) {
      if (line.orderedQty <= 0) {
        continue;
      }
      reserveInventoryForSku(line.sku, line.orderedQty);
      reservations.push({ sku: line.sku, qty: line.orderedQty });
    }

    markOrderNumberAsUsed(numberingContext.tenantId, finalOrderNumber);

    const record: SalesOrderRecord = {
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
  } catch (error) {
    reservations.forEach((entry) => releaseInventoryReservation(entry.sku, entry.qty));
    throw error;
  }
};

export interface SalesOrderListFilters {
  from?: number;
  to?: number;
  tenantId?: string;
}

export const listSalesOrders = (
  filters: SalesOrderListFilters = {},
): SalesOrderRecord[] => {
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

export const getSalesOrder = (id: string): SalesOrderRecord | null => {
  const record = salesOrders.get(id);
  return record ? { ...record, lines: [...record.lines] } : null;
};

export const cancelSalesOrder = (id: string): SalesOrderRecord | null => {
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

export const deleteSalesOrder = (id: string): SalesOrderRecord | null => {
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

export interface SalesShipmentResult {
  order: SalesOrderRecord;
  previousShippedQty: number;
  line: SalesOrderLineRecord;
}

export const recordSalesShipment = (
  soId: string,
  lineId: string,
  quantity: number,
  shippedAt?: string,
): SalesShipmentResult | null => {
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

export interface SalesOrderDraftLine {
  sku: string;
  orderedQty: number;
  productName?: string;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  taxAmount?: number;
  taxLabel?: string;
  currency?: string;
  taxTypeId?: string;
}

export interface SalesOrderDraftPayload {
  id?: string;
  status?: 'draft';
  tenantId?: string;
  customerId: string;
  customerName?: string;
  orderNumber?: string;
  orderDate?: string;
  memo?: string | null;
  promisedDate?: string | null;
  shippingMode?: string;
  shippingNote?: string | null;
  warehouse?: string | null;
  lines: SalesOrderDraftLine[];
}

export interface SalesOrderDraftRecord extends SalesOrderDraftPayload {
  id: string;
  status: 'draft';
  tenantId: string;
  createdAt: string;
  updatedAt: string;
  shippingMode: string;
  shippingNote: string | null;
  warehouse: string;
}

const salesOrderDrafts = new Map<string, SalesOrderDraftRecord>();

const cloneLines = (lines: SalesOrderDraftLine[]): SalesOrderDraftLine[] =>
  lines.map((line) => ({ ...line }));

export const saveSalesOrderDraft = (payload: SalesOrderDraftPayload): SalesOrderDraftRecord => {
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
  const shippingNoteValue =
    payload.shippingNote?.trim() ?? existing?.shippingNote ?? null;
  const warehouseValue = payload.warehouse?.trim() ?? existing?.warehouse ?? '';

  const record: SalesOrderDraftRecord = {
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

export interface SalesOrderDraftListFilters {
  from?: number;
  to?: number;
  tenantId?: string;
}

const getDraftTimestamp = (draft: SalesOrderDraftRecord): number | null => {
  const value = draft.orderDate || draft.createdAt;
  if (!value) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

const cloneDraft = (draft: SalesOrderDraftRecord): SalesOrderDraftRecord => ({
  ...draft,
  lines: cloneLines(draft.lines),
});

export const listSalesOrderDrafts = (
  filters: SalesOrderDraftListFilters = {},
): SalesOrderDraftRecord[] => {
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

export const getSalesOrderDraft = (id: string): SalesOrderDraftRecord | null => {
  const draft = salesOrderDrafts.get(id);
  return draft ? cloneDraft(draft) : null;
};

export const deleteSalesOrderDraft = (id: string): SalesOrderDraftRecord | null => {
  const draft = salesOrderDrafts.get(id);
  if (!draft) {
    return null;
  }
  salesOrderDrafts.delete(id);
  return cloneDraft(draft);
};
