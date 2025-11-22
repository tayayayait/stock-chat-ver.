import { MOVEMENT_TYPES, type MovementDraft, type MovementType } from '../../shared/movements/types';
import { validateMovementDraft } from '../../shared/movements/validation';
import { buildQueryString, get, post } from './api';

export type { MovementType };

export interface MovementLocationSummary {
  warehouseCode?: string;
}

export interface MovementSummary {
  id: string;
  sku: string;
  occurredAt: string;
  type: MovementType;
  qty: number;
  partnerId?: string;
  from?: MovementLocationSummary | null;
  to?: MovementLocationSummary | null;
}

export interface ListMovementsParams {
  sku?: string;
  refNo?: string;
  partnerId?: string;
  warehouse?: string;
  type?: MovementType;
  limit?: number;
  offset?: number;
  from?: string;
  to?: string;
  signal?: AbortSignal;
}

interface ApiMovement {
  id?: string | number;
  occurredAt?: string;
  createdAt?: string;
  type?: string;
  qty?: number;
  partnerId?: string | null;
  fromWarehouse?: string | null;
  toWarehouse?: string | null;
}

interface ApiMovementListResponse {
  total?: number;
  count?: number;
  offset?: number;
  limit?: number;
  items?: ApiMovement[];
}

export interface MovementListResult {
  total: number;
  count: number;
  offset: number;
  limit: number;
  items: MovementSummary[];
}

const normalizeMovementType = (value?: string): MovementType => {
  if (value && MOVEMENT_TYPES.includes(value as MovementType)) {
    return value as MovementType;
  }
  return 'ADJUST';
};

const normalizeLocation = (warehouse?: string | null): MovementLocationSummary | null => {
  const normalizedWarehouse = typeof warehouse === 'string' && warehouse.trim() ? warehouse.trim() : undefined;
  if (!normalizedWarehouse) {
    return null;
  }
  return {
    warehouseCode: normalizedWarehouse,
  };
};

const normalizeId = (value: ApiMovement['id'], fallback: string): string => {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return fallback;
};

const normalizePartner = (partnerId: ApiMovement['partnerId']): string | undefined => {
  if (typeof partnerId !== 'string') {
    return undefined;
  }

  const trimmed = partnerId.trim();
  return trimmed ? trimmed : undefined;
};

const normalizeOccurredAt = (value?: string): string => {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }
  return new Date(0).toISOString();
};

const normalizeQty = (qty?: number): number => {
  if (typeof qty === 'number' && Number.isFinite(qty)) {
    return qty;
  }
  return 0;
};

const normalizeMovements = (items: ApiMovement[] = []): MovementSummary[] =>
  items.map((item, index) => {
    const occurredAt = normalizeOccurredAt(item.occurredAt ?? item.createdAt);
    return {
      id: normalizeId(item.id, `movement-${index}-${occurredAt}`),
      sku: (item as unknown as { sku?: string }).sku ?? '',
      occurredAt,
      type: normalizeMovementType(item.type),
      qty: normalizeQty(item.qty),
      partnerId: normalizePartner(item.partnerId),
      from: normalizeLocation(item.fromWarehouse),
      to: normalizeLocation(item.toWarehouse),
    } satisfies MovementSummary;
  });

export async function listMovements(params: ListMovementsParams): Promise<MovementListResult> {
  const {
    sku,
    refNo,
    partnerId,
    warehouse,
    type,
    limit,
    offset,
    from,
    to,
    signal,
  } = params;

  const normalizedSku = typeof sku === 'string' ? sku.trim() : undefined;
  const normalizedRefNo = typeof refNo === 'string' ? refNo.trim() : undefined;
  const normalizedPartnerId = typeof partnerId === 'string' ? partnerId.trim() : undefined;
  const normalizedWarehouse = typeof warehouse === 'string' ? warehouse.trim() : undefined;
  const normalizedFrom = typeof from === 'string' ? from.trim() : undefined;
  const normalizedTo = typeof to === 'string' ? to.trim() : undefined;

  if (
    !normalizedSku &&
    !normalizedRefNo &&
    !normalizedPartnerId &&
    !normalizedWarehouse &&
    !type
  ) {
    throw new Error('최소 하나의 필터(sku, refNo, partnerId, warehouse, type)가 필요합니다.');
  }

  const query = buildQueryString({
    sku: normalizedSku,
    refNo: normalizedRefNo,
    partnerId: normalizedPartnerId,
    warehouse: normalizedWarehouse,
    type,
    limit,
    offset,
    from: normalizedFrom,
    to: normalizedTo,
  });
  const path = `/api/movements${query}`;

  const response = await get<ApiMovementListResponse>(path, { signal });
  const items = normalizeMovements(response.items);

  return {
    total: typeof response.total === 'number' ? response.total : items.length,
    count: typeof response.count === 'number' ? response.count : items.length,
    offset: typeof response.offset === 'number' ? response.offset : offset ?? 0,
    limit: typeof response.limit === 'number' ? response.limit : limit ?? items.length,
    items,
  } satisfies MovementListResult;
}

export type CreateMovementPayload = MovementDraft;

export interface MovementBalanceSummary {
  warehouse: string;
  qty: number;
  updatedAt: string;
}

export interface InventorySnapshot {
  totalOnHand: number;
  totalReserved: number;
  totalAvailable: number;
}

export interface MovementExecutionResult {
  movement: {
    id: string;
    type: MovementType;
    sku: string;
    qty: number;
    occurredAt: string;
    fromWarehouse?: string;
    toWarehouse?: string;
    userId: string;
    partnerId?: string;
    refNo?: string;
    memo?: string;
  };
  balances: MovementBalanceSummary[];
  inventory: InventorySnapshot;
}

export interface MovementPendingResult {
  success: true;
  pendingId: string;
  scheduledFor: string;
}

export type CreateMovementResult = MovementExecutionResult | MovementPendingResult;

export async function submitMovement(payload: CreateMovementPayload): Promise<CreateMovementResult> {
  const validation = validateMovementDraft(payload, { requireOccurredAt: true });
  if (!validation.success) {
    throw new Error(validation.errors.join(' '));
  }
  return post<CreateMovementResult>('/api/movements', validation.data);
}
