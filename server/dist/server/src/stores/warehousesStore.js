import { randomUUID } from 'node:crypto';
const warehouseStore = new Map();
const readSeedPreference = () => process.env.SEED_SAMPLE_DATA === 'true';
let autoSeed = readSeedPreference();
const normalizeName = (value) => value.trim().toLowerCase();
const slugifyForCode = (value) => value
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 12);
const generateWarehouseCode = (name) => {
    const base = slugifyForCode(name) || 'AUTO';
    let attempt = 0;
    while (attempt < 1000) {
        const suffix = attempt === 0 ? '' : `-${attempt + 1}`;
        const candidate = `WH-${base}${suffix}`;
        if (!warehouseStore.has(candidate)) {
            return candidate;
        }
        attempt += 1;
    }
    return `WH-${randomUUID().slice(0, 8).toUpperCase()}`;
};
const defaultWarehouses = [
    {
        code: 'WH-SEOUL',
        name: '서울 풀필먼트 센터',
        address: '서울특별시 송파구 물류로 123',
    },
    {
        code: 'WH-BUSAN',
        name: '부산 항만 물류센터',
        address: '부산광역시 해운대구 국제물류로 89',
    },
    {
        code: 'WH-DAEJEON',
        name: '대전 허브센터',
        address: '대전광역시 유성구 과학물류길 56',
    },
];
function toRecord(payload) {
    const now = new Date().toISOString();
    return {
        ...payload,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
    };
}
export function ensureWarehouseSeedData() {
    if (!autoSeed) {
        return;
    }
    autoSeed = false;
    if (warehouseStore.size > 0) {
        return;
    }
    defaultWarehouses.forEach((payload) => {
        if (!warehouseStore.has(payload.code)) {
            warehouseStore.set(payload.code, toRecord(payload));
        }
    });
}
export function listWarehouses() {
    ensureWarehouseSeedData();
    return Array.from(warehouseStore.values()).sort((a, b) => a.code.localeCompare(b.code));
}
export function findWarehouseByCode(code) {
    ensureWarehouseSeedData();
    return warehouseStore.get(code);
}
export function findWarehouseByName(name) {
    ensureWarehouseSeedData();
    const normalized = normalizeName(name);
    if (!normalized) {
        return undefined;
    }
    return Array.from(warehouseStore.values()).find((record) => normalizeName(record.name) === normalized);
}
export function createWarehouse(payload) {
    ensureWarehouseSeedData();
    if (warehouseStore.has(payload.code)) {
        throw new Error('이미 존재하는 물류센터 코드입니다.');
    }
    const record = toRecord(payload);
    warehouseStore.set(record.code, record);
    return record;
}
export function findOrCreateWarehouseByName(name) {
    ensureWarehouseSeedData();
    const trimmed = name.trim();
    if (!trimmed) {
        throw new Error('창고 이름이 비어 있습니다.');
    }
    const existing = findWarehouseByName(trimmed);
    if (existing) {
        return existing;
    }
    const code = generateWarehouseCode(trimmed);
    return createWarehouse({ code, name: trimmed });
}
export function updateWarehouse(code, changes) {
    ensureWarehouseSeedData();
    const existing = warehouseStore.get(code);
    if (!existing) {
        throw new Error('요청한 물류센터를 찾을 수 없습니다.');
    }
    const updated = {
        ...existing,
        ...changes,
        updatedAt: new Date().toISOString(),
    };
    warehouseStore.set(code, updated);
    return updated;
}
export function deleteWarehouse(code) {
    ensureWarehouseSeedData();
    const existing = warehouseStore.get(code);
    if (!existing) {
        return undefined;
    }
    warehouseStore.delete(code);
    return existing;
}
export function __resetWarehouseStore(seed = readSeedPreference()) {
    warehouseStore.clear();
    autoSeed = seed;
}
export function __getWarehouseRecords() {
    return listWarehouses();
}
