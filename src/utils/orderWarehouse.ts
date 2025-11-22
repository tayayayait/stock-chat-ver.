const ORDER_WAREHOUSE_STORAGE_KEY_PREFIX = 'so:warehouse:';

const buildStorageKey = (orderId: string) => `${ORDER_WAREHOUSE_STORAGE_KEY_PREFIX}${orderId}`;

const sanitizeCode = (value?: string | null) => value?.trim() ?? '';
const sanitizeName = (value?: string | null) => (value && value.trim() ? value.trim() : null);

export interface OrderWarehouseRecord {
  code: string;
  name?: string | null;
}

export const persistOrderWarehouse = (orderId: string, warehouse: OrderWarehouseRecord) => {
  if (!orderId) {
    return;
  }
  const code = sanitizeCode(warehouse.code);
  if (!code) {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }

  const payload: OrderWarehouseRecord = {
    code,
    name: sanitizeName(warehouse.name),
  };
  try {
    window.localStorage.setItem(buildStorageKey(orderId), JSON.stringify(payload));
  } catch (error) {
    console.error('[orderWarehouse] Failed to persist warehouse', error);
  }
};

export const readOrderWarehouse = (orderId: string): OrderWarehouseRecord | null => {
  if (!orderId || typeof window === 'undefined') {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(buildStorageKey(orderId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.code !== 'string') {
      return null;
    }
    const code = sanitizeCode(parsed.code);
    if (!code) {
      return null;
    }
    return {
      code,
      name: sanitizeName(parsed.name),
    };
  } catch (error) {
    console.error('[orderWarehouse] Failed to read warehouse', error);
    return null;
  }
};
