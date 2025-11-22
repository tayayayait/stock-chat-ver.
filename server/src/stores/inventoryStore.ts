export interface InventoryInput {
  sku: string;
  warehouseCode: string;
  onHand: number;
  reserved: number;
}

export interface InventoryRecord extends InventoryInput {}

export interface InventoryTotals {
  onHand: number;
  reserved: number;
}

const inventoryStore = new Map<string, InventoryRecord>();
const skuIndex = new Map<string, Set<string>>();
const warehouseIndex = new Map<string, Set<string>>();

const totalsBySku = new Map<string, InventoryTotals>();
const totalsByWarehouse = new Map<string, InventoryTotals>();
let overallTotals: InventoryTotals = { onHand: 0, reserved: 0 };

const keyFor = (sku: string, warehouseCode: string): string => `${sku}::${warehouseCode}`;

const cloneRecord = (record: InventoryRecord): InventoryRecord => ({ ...record });

const ensureIndexSet = (index: Map<string, Set<string>>, targetKey: string): Set<string> => {
  const existing = index.get(targetKey);
  if (existing) {
    return existing;
  }

  const created = new Set<string>();
  index.set(targetKey, created);
  return created;
};

const addIndexEntry = (index: Map<string, Set<string>>, targetKey: string, recordKey: string) => {
  ensureIndexSet(index, targetKey).add(recordKey);
};

const removeIndexEntry = (index: Map<string, Set<string>>, targetKey: string, recordKey: string) => {
  const bucket = index.get(targetKey);
  if (!bucket) {
    return;
  }

  bucket.delete(recordKey);
  if (bucket.size === 0) {
    index.delete(targetKey);
  }
};

const applyTotalsDelta = (
  target: Map<string, InventoryTotals>,
  targetKey: string,
  deltaOnHand: number,
  deltaReserved: number,
) => {
  const current = target.get(targetKey) ?? { onHand: 0, reserved: 0 };
  const nextOnHand = current.onHand + deltaOnHand;
  const nextReserved = current.reserved + deltaReserved;

  if (nextOnHand === 0 && nextReserved === 0) {
    target.delete(targetKey);
    return;
  }

  target.set(targetKey, { onHand: nextOnHand, reserved: nextReserved });
};

const applyOverallDelta = (deltaOnHand: number, deltaReserved: number) => {
  overallTotals = {
    onHand: overallTotals.onHand + deltaOnHand,
    reserved: overallTotals.reserved + deltaReserved,
  };
};

const setRecord = (record: InventoryRecord): string => {
  const recordKey = keyFor(record.sku, record.warehouseCode);
  const previous = inventoryStore.get(recordKey);

  inventoryStore.set(recordKey, cloneRecord(record));
  addIndexEntry(skuIndex, record.sku, recordKey);
  addIndexEntry(warehouseIndex, record.warehouseCode, recordKey);

  const deltaOnHand = record.onHand - (previous?.onHand ?? 0);
  const deltaReserved = record.reserved - (previous?.reserved ?? 0);
  if (deltaOnHand !== 0 || deltaReserved !== 0) {
    applyTotalsDelta(totalsBySku, record.sku, deltaOnHand, deltaReserved);
    applyTotalsDelta(totalsByWarehouse, record.warehouseCode, deltaOnHand, deltaReserved);
    applyOverallDelta(deltaOnHand, deltaReserved);
  }

  return recordKey;
};

const removeRecordByKey = (recordKey: string): void => {
  const existing = inventoryStore.get(recordKey);
  if (!existing) {
    return;
  }

  inventoryStore.delete(recordKey);
  removeIndexEntry(skuIndex, existing.sku, recordKey);
  removeIndexEntry(warehouseIndex, existing.warehouseCode, recordKey);
  applyTotalsDelta(totalsBySku, existing.sku, -existing.onHand, -existing.reserved);
  applyTotalsDelta(totalsByWarehouse, existing.warehouseCode, -existing.onHand, -existing.reserved);
  applyOverallDelta(-existing.onHand, -existing.reserved);
};

export function listInventoryForSku(sku: string): InventoryRecord[] {
  const keys = skuIndex.get(sku);
  if (!keys || keys.size === 0) {
    return [];
  }

  return Array.from(keys)
    .map((recordKey) => inventoryStore.get(recordKey))
    .filter((record): record is InventoryRecord => Boolean(record))
    .map(cloneRecord);
}

export function replaceInventoryForSku(sku: string, records: InventoryInput[]): void {
  const existingKeys = new Set(skuIndex.get(sku) ?? []);
  const nextKeys = new Set<string>();

  records.forEach((input) => {
    const normalized: InventoryRecord = { ...input };
    const recordKey = setRecord(normalized);
    nextKeys.add(recordKey);
    existingKeys.delete(recordKey);
  });

  existingKeys.forEach((recordKey) => {
    if (!nextKeys.has(recordKey)) {
      removeRecordByKey(recordKey);
    }
  });
}

export function deleteInventoryForSku(sku: string): void {
  const keys = skuIndex.get(sku);
  if (!keys) {
    return;
  }

  Array.from(keys).forEach((recordKey) => {
    removeRecordByKey(recordKey);
  });
}

export function deleteInventoryByWarehouse(warehouseCode: string): void {
  const keys = warehouseIndex.get(warehouseCode);
  if (!keys) {
    return;
  }

  Array.from(keys).forEach((recordKey) => {
    removeRecordByKey(recordKey);
  });
}

export function summarizeInventory(
  sku: string,
): { totalOnHand: number; totalReserved: number; items: InventoryRecord[] } {
  const items = listInventoryForSku(sku);
  const totals = totalsBySku.get(sku) ?? { onHand: 0, reserved: 0 };
  return { totalOnHand: totals.onHand, totalReserved: totals.reserved, items };
}

export function seedInventory(records: InventoryInput[]): void {
  records.forEach((record) => {
    setRecord({ ...record });
  });
}

export function getInventoryTotals(): InventoryTotals {
  return { ...overallTotals };
}

export function getWarehouseTotals(): Array<InventoryTotals & { warehouseCode: string }> {
  return Array.from(totalsByWarehouse.entries()).map(([warehouseCode, totals]) => ({
    warehouseCode,
    onHand: totals.onHand,
    reserved: totals.reserved,
  }));
}

const recordEntriesForSku = (sku: string) => {
  const keys = skuIndex.get(sku);
  if (!keys || keys.size === 0) {
    return [];
  }

  return Array.from(keys)
    .map((recordKey) => {
      const record = inventoryStore.get(recordKey);
      if (!record) {
        return null;
      }
      return { key: recordKey, record };
    })
    .filter((entry): entry is { key: string; record: InventoryRecord } => Boolean(entry));
};

const clampReserved = (record: InventoryRecord, nextReserved: number): number => {
  const normalized = Math.max(0, Math.min(record.onHand, Math.round(nextReserved)));
  return normalized;
};

const changeReservedOnRecord = (recordKey: string, delta: number): number => {
  const record = inventoryStore.get(recordKey);
  if (!record || !Number.isFinite(delta)) {
    return 0;
  }
  const updatedReserved = clampReserved(record, record.reserved + delta);
  if (updatedReserved === record.reserved) {
    return 0;
  }
  setRecord({ ...record, reserved: updatedReserved });
  return updatedReserved - record.reserved;
};

export class InventoryReservationError extends Error {}

export const getAvailableInventoryForSku = (sku: string): number => {
  const totals = totalsBySku.get(sku);
  if (!totals) {
    return 0;
  }
  return Math.max(0, totals.onHand - totals.reserved);
};

const sortByAvailable = (entries: Array<{ key: string; record: InventoryRecord }>) =>
  entries.sort((a, b) => {
    const availableA = Math.max(0, a.record.onHand - a.record.reserved);
    const availableB = Math.max(0, b.record.onHand - b.record.reserved);
    return availableB - availableA;
  });

const sortByReserved = (entries: Array<{ key: string; record: InventoryRecord }>) =>
  entries.sort((a, b) => b.record.reserved - a.record.reserved);

export const reserveInventoryForSku = (sku: string, quantity: number): void => {
  const roundedQty = Math.max(0, Math.round(quantity));
  if (roundedQty === 0) {
    return;
  }
  const available = getAvailableInventoryForSku(sku);
  if (roundedQty > available) {
    throw new InventoryReservationError(`SKU ${sku} has only ${available} available units.`);
  }

  let remaining = roundedQty;
  const entries = sortByAvailable(recordEntriesForSku(sku));
  for (const entry of entries) {
    if (remaining <= 0) {
      break;
    }
    const free = Math.max(0, entry.record.onHand - entry.record.reserved);
    if (free <= 0) {
      continue;
    }
    const allocate = Math.min(free, remaining);
    const delta = changeReservedOnRecord(entry.key, allocate);
    remaining -= delta;
  }

  if (remaining > 0) {
    throw new InventoryReservationError(`Failed to reserve ${roundedQty} units for SKU ${sku}.`);
  }
};

const releaseReservationFromRecord = (recordKey: string, quantity: number): number => {
  const rounded = Math.max(0, Math.round(quantity));
  if (rounded === 0) {
    return 0;
  }
  const record = inventoryStore.get(recordKey);
  if (!record) {
    return 0;
  }
  const releasable = Math.min(record.reserved, rounded);
  if (releasable <= 0) {
    return 0;
  }
  const delta = changeReservedOnRecord(recordKey, -releasable);
  return Math.abs(delta);
};

export const releaseInventoryReservation = (
  sku: string,
  quantity: number,
  preferredWarehouse?: string,
): void => {
  const roundedQty = Math.max(0, Math.round(quantity));
  if (roundedQty === 0) {
    return;
  }
  let remaining = roundedQty;

  if (preferredWarehouse) {
    const key = keyFor(sku, preferredWarehouse);
    remaining -= releaseReservationFromRecord(key, remaining);
  }

  if (remaining <= 0) {
    return;
  }

  const entries = sortByReserved(recordEntriesForSku(sku));
  for (const entry of entries) {
    if (remaining <= 0) {
      break;
    }
    remaining -= releaseReservationFromRecord(entry.key, remaining);
  }
};

export function __resetInventoryStore(): void {
  inventoryStore.clear();
  skuIndex.clear();
  warehouseIndex.clear();
  locationIndex.clear();
  totalsBySku.clear();
  totalsByWarehouse.clear();
  totalsByLocation.clear();
  overallTotals = { onHand: 0, reserved: 0 };
}
