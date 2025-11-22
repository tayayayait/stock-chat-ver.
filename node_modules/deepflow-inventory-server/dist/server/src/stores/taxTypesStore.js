import { randomUUID } from 'node:crypto';
const taxTypeStore = new Map();
let autoSeed = true;
const TAX_TYPE_SEEDS = [
    { name: '부가세', rate: 0.1, mode: 'inclusive', isDefault: true },
    { name: '영세율', rate: 0, mode: 'exclusive' },
];
function toRecord(payload, overrides) {
    const now = new Date().toISOString();
    const createdAt = overrides?.createdAt ?? now;
    const updatedAt = overrides?.updatedAt ?? now;
    return {
        id: overrides?.id ?? randomUUID(),
        name: payload.name.trim(),
        rate: payload.rate,
        mode: payload.mode,
        isDefault: payload.isDefault ?? false,
        createdAt,
        updatedAt,
    };
}
export function ensureTaxTypeSeedData() {
    if (!autoSeed || taxTypeStore.size > 0) {
        return;
    }
    TAX_TYPE_SEEDS.forEach((seed) => {
        const record = toRecord(seed);
        taxTypeStore.set(record.id, record);
    });
    autoSeed = false;
}
export function listTaxTypes() {
    ensureTaxTypeSeedData();
    return Array.from(taxTypeStore.values()).sort((a, b) => a.name.localeCompare(b.name));
}
export function createTaxType(payload) {
    ensureTaxTypeSeedData();
    const record = toRecord(payload);
    taxTypeStore.set(record.id, record);
    return record;
}
export function findTaxTypeById(id) {
    ensureTaxTypeSeedData();
    return taxTypeStore.get(id);
}
