import { randomUUID } from 'node:crypto';
import { ensureWarehouseSeedData, findWarehouseByCode, } from '../stores/warehousesStore.js';
import { ensureLocationSeedData, findLocationByCode, } from '../stores/locationsStore.js';
import { deleteInventoryForSku, listInventoryForSku, replaceInventoryForSku, summarizeInventory, __resetInventoryStore, } from '../stores/inventoryStore.js';
import { deletePolicyDrafts, getPolicyDraft, hasPolicyDraft, renamePolicyDraft, upsertPolicyDraft, } from '../stores/policiesStore.js';
import { ensureProductCategory } from '../stores/categoriesStore.js';
const productStore = new Map();
let productSequence = 100;
let autoSeed = true;
const DEFAULT_UNIT = 'EA';
const DEFAULT_BUFFER_RATIO = 0.2;
const DEFAULT_POLICY_SERVICE_LEVEL_PERCENT = 95;
const DEFAULT_POLICY_SMOOTHING_ALPHA = 0.4;
const DEFAULT_POLICY_CORRELATION_RHO = 0.25;
const DEFAULT_POLICY_LEAD_TIME_DAYS = 14;
const AUTO_SYNC_POLICIES_ENABLED = (() => {
    const raw = String(process.env.AUTO_SYNC_POLICIES ?? 'true').trim().toLowerCase();
    return raw !== 'false' && raw !== '0' && raw !== 'off';
})();
const allowedRisk = ['정상', '결품위험', '과잉'];
const allowedAbc = ['A', 'B', 'C'];
const allowedXyz = ['X', 'Y', 'Z'];
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isBoolean = (value) => typeof value === 'boolean';
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const sanitizePriceValue = (value) => {
    if (!isFiniteNumber(value)) {
        return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
        return null;
    }
    return Math.round(numeric * 100) / 100;
};
const parsePackCase = (packCase) => {
    const [packRaw, caseRaw] = packCase.split('/').map((part) => part.trim());
    const pack = Number.parseInt(packRaw ?? '', 10);
    const casePack = Number.parseInt(caseRaw ?? '', 10);
    const safePack = Number.isFinite(pack) && pack > 0 ? pack : 1;
    const safeCase = Number.isFinite(casePack) && casePack > 0 ? casePack : safePack;
    return { pack: safePack, casePack: safeCase };
};
function normalizeString(value) {
    if (!value || typeof value !== 'string') {
        return '';
    }
    return value.trim();
}
function formatPackCase(pack, casePack) {
    const safePack = Number.isFinite(pack) && pack > 0 ? Math.floor(pack) : 1;
    const safeCase = Number.isFinite(casePack) && casePack > 0 ? Math.floor(casePack) : safePack;
    return `${safePack}/${safeCase}`;
}
const sanitizePolicyMetric = (value) => {
    if (value === null || value === undefined) {
        return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    const rounded = Math.max(0, Math.round(numeric));
    return Number.isFinite(rounded) ? rounded : null;
};
const pickPolicyMetric = (...values) => {
    for (const value of values) {
        const sanitized = sanitizePolicyMetric(value);
        if (sanitized !== null) {
            return sanitized;
        }
    }
    return null;
};
export const derivePolicyDraftFromProduct = (product) => ({
    sku: product.sku,
    name: product.name.trim() || null,
    forecastDemand: pickPolicyMetric(product.dailyAvg, product.avgOutbound7d),
    demandStdDev: pickPolicyMetric(product.dailyStd),
    leadTimeDays: sanitizePolicyMetric(DEFAULT_POLICY_LEAD_TIME_DAYS),
    serviceLevelPercent: DEFAULT_POLICY_SERVICE_LEVEL_PERCENT,
    smoothingAlpha: DEFAULT_POLICY_SMOOTHING_ALPHA,
    corrRho: DEFAULT_POLICY_CORRELATION_RHO,
});
export const ensurePolicyDraftForProduct = (product) => {
    if (!AUTO_SYNC_POLICIES_ENABLED) {
        return;
    }
    const normalizedSku = product.sku?.trim();
    if (!normalizedSku) {
        return;
    }
    const existing = getPolicyDraft(normalizedSku);
    if (!existing) {
        upsertPolicyDraft(derivePolicyDraftFromProduct(product));
        return;
    }
    const nextName = product.name.trim() || null;
    const currentName = existing.name?.trim() || null;
    if (nextName && nextName !== currentName) {
        upsertPolicyDraft({ ...existing, name: nextName });
    }
};
const syncPolicyDraftForSkuChange = (originalSku, product) => {
    if (!AUTO_SYNC_POLICIES_ENABLED) {
        return;
    }
    const normalizedOriginal = originalSku?.trim();
    const normalizedNext = product.sku?.trim();
    if (!normalizedNext) {
        return;
    }
    if (!normalizedOriginal || normalizedOriginal === normalizedNext) {
        ensurePolicyDraftForProduct(product);
        return;
    }
    const existing = getPolicyDraft(normalizedOriginal);
    if (!existing) {
        ensurePolicyDraftForProduct(product);
        return;
    }
    const targetExists = hasPolicyDraft(normalizedNext);
    if (targetExists) {
        deletePolicyDrafts([normalizedOriginal]);
        ensurePolicyDraftForProduct(product);
        return;
    }
    renamePolicyDraft(normalizedOriginal, normalizedNext);
    ensurePolicyDraftForProduct(product);
};
export function validateProductPayload(input) {
    if (typeof input !== 'object' || input === null) {
        return { success: false, errors: ['요청 본문이 객체가 아닙니다.'] };
    }
    const candidate = input;
    const errors = [];
    ensureWarehouseSeedData();
    ensureLocationSeedData();
    const requiredStrings = ['sku', 'name', 'category'];
    requiredStrings.forEach((field) => {
        if (!isNonEmptyString(candidate[field])) {
            errors.push(`${String(field)} 필드는 비어있을 수 없습니다.`);
        }
    });
    if (candidate.brand !== undefined && typeof candidate.brand !== 'string') {
        errors.push('brand 필드는 문자열이어야 합니다.');
    }
    if (candidate.imageUrl !== undefined && typeof candidate.imageUrl !== 'string') {
        errors.push('imageUrl 필드는 문자열이어야 합니다.');
    }
    if (candidate.unit !== undefined && typeof candidate.unit !== 'string') {
        errors.push('unit 필드는 문자열이어야 합니다.');
    }
    if (candidate.packCase !== undefined && typeof candidate.packCase !== 'string') {
        errors.push('packCase 필드는 문자열이어야 합니다.');
    }
    if (candidate.isActive !== undefined && !isBoolean(candidate.isActive)) {
        errors.push('isActive 필드는 불리언이어야 합니다.');
    }
    if (candidate.bufferRatio !== undefined) {
        if (!isFiniteNumber(candidate.bufferRatio)) {
            errors.push('bufferRatio 필드는 숫자여야 합니다.');
        }
        else if (candidate.bufferRatio < 0 || candidate.bufferRatio > 1) {
            errors.push('bufferRatio 필드는 0 이상 1 이하이어야 합니다.');
        }
    }
    const numericFields = ['dailyAvg', 'dailyStd'];
    numericFields.forEach((field) => {
        if (!isFiniteNumber(candidate[field])) {
            errors.push(`${String(field)} 필드는 숫자여야 합니다.`);
            return;
        }
        if (candidate[field] < 0) {
            errors.push(`${String(field)} 필드는 0 이상이어야 합니다.`);
        }
    });
    const optionalNumeric = [
        'onHand',
        'reserved',
        'totalInbound',
        'totalOutbound',
        'avgOutbound7d',
        'expiryDays',
        'supplyPrice',
        'salePrice',
    ];
    optionalNumeric.forEach((field) => {
        if (candidate[field] === undefined) {
            return;
        }
        if (!isFiniteNumber(candidate[field])) {
            errors.push(`${String(field)} 필드는 숫자여야 합니다.`);
        }
        else if (candidate[field] < 0) {
            errors.push(`${String(field)} 필드는 0 이상이어야 합니다.`);
        }
    });
    const grades = [
        ['abcGrade', allowedAbc],
        ['xyzGrade', allowedXyz],
    ];
    grades.forEach(([field, allowed]) => {
        if (!isNonEmptyString(candidate[field])) {
            errors.push(`${String(field)} 필드는 비어있을 수 없습니다.`);
            return;
        }
        if (!allowed.includes(candidate[field].toUpperCase())) {
            errors.push(`${String(field)} 필드는 ${allowed.join(', ')} 중 하나여야 합니다.`);
        }
    });
    if (candidate.risk !== undefined) {
        if (!isNonEmptyString(candidate.risk)) {
            errors.push('risk 필드는 비어있을 수 없습니다.');
        }
        else if (!allowedRisk.includes(candidate.risk)) {
            errors.push(`risk 필드는 ${allowedRisk.join(', ')} 중 하나여야 합니다.`);
        }
    }
    const packCaseValue = normalizeString(candidate.packCase);
    const { pack, casePack } = parsePackCase(packCaseValue);
    let inventoryProvided = false;
    const inventoryEntries = [];
    if ('inventory' in candidate) {
        inventoryProvided = true;
        if (!Array.isArray(candidate.inventory)) {
            errors.push('inventory 필드는 배열이어야 합니다.');
        }
        else {
            const seen = new Set();
            candidate.inventory.forEach((item, index) => {
                if (typeof item !== 'object' || item === null) {
                    errors.push(`inventory[${index}] 항목이 유효하지 않습니다.`);
                    return;
                }
                const raw = item;
                const warehouseCode = normalizeString(raw.warehouseCode);
                const locationCode = normalizeString(raw.locationCode);
                const onHandValue = raw.onHand;
                const reservedValue = raw.reserved;
                if (!warehouseCode) {
                    errors.push(`inventory[${index}].warehouseCode 필드는 비어있을 수 없습니다.`);
                }
                if (!locationCode) {
                    errors.push(`inventory[${index}].locationCode 필드는 비어있을 수 없습니다.`);
                }
                if (warehouseCode && !findWarehouseByCode(warehouseCode)) {
                    errors.push(`inventory[${index}].warehouseCode 에 해당하는 물류센터가 없습니다.`);
                }
                if (locationCode) {
                    const location = findLocationByCode(locationCode);
                    if (!location) {
                        errors.push(`inventory[${index}].locationCode 에 해당하는 로케이션이 없습니다.`);
                    }
                    else if (warehouseCode && location.warehouseCode !== warehouseCode) {
                        errors.push(`inventory[${index}] 로케이션의 물류센터 코드가 일치하지 않습니다. (${location.warehouseCode})`);
                    }
                }
                const key = `${warehouseCode}::${locationCode}`;
                if (warehouseCode && locationCode) {
                    if (seen.has(key)) {
                        errors.push(`inventory 항목에 중복된 로케이션(${warehouseCode}/${locationCode})이 있습니다.`);
                    }
                    else {
                        seen.add(key);
                    }
                }
                if (onHandValue !== undefined && !isFiniteNumber(onHandValue)) {
                    errors.push(`inventory[${index}].onHand 필드는 숫자여야 합니다.`);
                }
                if (reservedValue !== undefined && !isFiniteNumber(reservedValue)) {
                    errors.push(`inventory[${index}].reserved 필드는 숫자여야 합니다.`);
                }
                if (warehouseCode && locationCode) {
                    const onHand = Math.max(0, Math.round(onHandValue ?? 0));
                    const reserved = Math.max(0, Math.round(reservedValue ?? 0));
                    inventoryEntries.push({ warehouseCode, locationCode, onHand, reserved });
                }
            });
        }
    }
    if (errors.length > 0) {
        return { success: false, errors };
    }
    const value = {
        productId: typeof candidate.productId === 'string' && candidate.productId
            ? candidate.productId
            : undefined,
        legacyProductId: Number.isInteger(candidate.legacyProductId)
            ? candidate.legacyProductId
            : undefined,
        sku: normalizeString(candidate.sku),
        name: normalizeString(candidate.name),
        category: normalizeString(candidate.category),
        subCategory: normalizeString(candidate.subCategory),
        unit: normalizeString(candidate.unit) || DEFAULT_UNIT,
        packCase: packCaseValue ? formatPackCase(pack, casePack) : '',
        pack,
        casePack,
        abcGrade: candidate.abcGrade.toUpperCase(),
        xyzGrade: candidate.xyzGrade.toUpperCase(),
        bufferRatio: Math.min(1, Math.max(0, candidate.bufferRatio ?? DEFAULT_BUFFER_RATIO)),
        dailyAvg: Math.max(0, Math.round(candidate.dailyAvg)),
        dailyStd: Math.max(0, Math.round(candidate.dailyStd)),
        totalInbound: Math.max(0, Math.round(candidate.totalInbound ?? 0)),
        totalOutbound: Math.max(0, Math.round(candidate.totalOutbound ?? 0)),
        avgOutbound7d: Math.max(0, Math.round(candidate.avgOutbound7d ?? 0)),
        isActive: typeof candidate.isActive === 'boolean' ? candidate.isActive : true,
        onHand: Math.max(0, Math.round(candidate.onHand ?? 0)),
        reserved: Math.max(0, Math.round(candidate.reserved ?? 0)),
        risk: candidate.risk ?? '정상',
        imageUrl: normalizeString(candidate.imageUrl) || undefined,
        supplyPrice: sanitizePriceValue(candidate.supplyPrice),
        salePrice: sanitizePriceValue(candidate.salePrice),
        inventory: inventoryProvided ? inventoryEntries : undefined,
    };
    if (Object.prototype.hasOwnProperty.call(candidate, 'brand')) {
        const brandValue = normalizeString(candidate.brand);
        value.brand = brandValue ? brandValue : undefined;
    }
    if (Object.prototype.hasOwnProperty.call(candidate, 'expiryDays') && isFiniteNumber(candidate.expiryDays)) {
        value.expiryDays = Math.max(0, Math.round(candidate.expiryDays));
    }
    return { success: true, value };
}
function toResponse(record) {
    const summary = summarizeInventory(record.sku);
    const inventory = summary.items
        .slice()
        .sort((a, b) => {
        if (a.warehouseCode === b.warehouseCode) {
            return a.locationCode.localeCompare(b.locationCode);
        }
        return a.warehouseCode.localeCompare(b.warehouseCode);
    })
        .map(({ warehouseCode, locationCode, onHand, reserved }) => ({
        warehouseCode,
        locationCode,
        onHand,
        reserved,
    }));
    return {
        ...record,
        onHand: summary.totalOnHand,
        reserved: summary.totalReserved,
        inventory,
    };
}
function ensureSeedData() {
    if (!autoSeed) {
        return;
    }
    if (productStore.size > 0) {
        return;
    }
    ensureWarehouseSeedData();
    ensureLocationSeedData();
    const seedProducts = [];
    seedProducts.forEach((sample) => {
        const now = new Date().toISOString();
        const { inventory, ...product } = sample;
        const record = {
            ...product,
            productId: sample.productId ?? randomUUID(),
            legacyProductId: sample.legacyProductId ?? ++productSequence,
            packCase: sample.packCase ? formatPackCase(sample.pack, sample.casePack) : '',
            createdAt: now,
            updatedAt: now,
        };
        productStore.set(record.sku, record);
        replaceInventoryForSku(record.sku, inventory.map((entry) => ({
            sku: record.sku,
            warehouseCode: entry.warehouseCode,
            locationCode: entry.locationCode,
            onHand: entry.onHand,
            reserved: entry.reserved,
        })));
    });
}
export default async function productsRoutes(server) {
    ensureSeedData();
    server.get('/', async (request, reply) => {
        const { q } = (request.query ?? {});
        const keyword = q?.trim().toLowerCase();
        const items = Array.from(productStore.values()).filter((item) => {
            if (!keyword)
                return true;
            return (item.sku.toLowerCase().includes(keyword) ||
                item.name.toLowerCase().includes(keyword) ||
                item.category.toLowerCase().includes(keyword) ||
                item.subCategory.toLowerCase().includes(keyword));
        });
        return reply.send({ items: items.map((item) => toResponse(item)), count: items.length });
    });
    server.get('/:sku', async (request, reply) => {
        const { sku } = request.params;
        const record = productStore.get(sku);
        if (!record) {
            return reply.code(404).send({ error: '요청한 상품을 찾을 수 없습니다.' });
        }
        return reply.send({ item: toResponse(record) });
    });
    server.post('/', async (request, reply) => {
        const validation = validateProductPayload(request.body);
        if (!validation.success) {
            return reply.code(400).send({ error: '유효하지 않은 입력입니다.', details: validation.errors });
        }
        const { value } = validation;
        if (productStore.has(value.sku)) {
            return reply.code(409).send({ error: '이미 존재하는 SKU입니다.' });
        }
        ensureProductCategory(value.category, value.subCategory);
        const now = new Date().toISOString();
        const { inventory: inventoryPayload, onHand: _onHand, reserved: _reserved, ...productValue } = value;
        const record = {
            ...productValue,
            productId: value.productId ?? randomUUID(),
            legacyProductId: value.legacyProductId && value.legacyProductId > 0 ? value.legacyProductId : ++productSequence,
            createdAt: now,
            updatedAt: now,
        };
        productStore.set(record.sku, record);
        const inventoryItems = (inventoryPayload ?? []).map((entry) => ({
            sku: record.sku,
            warehouseCode: entry.warehouseCode,
            locationCode: entry.locationCode,
            onHand: entry.onHand,
            reserved: entry.reserved,
        }));
        replaceInventoryForSku(record.sku, inventoryItems);
        ensurePolicyDraftForProduct(record);
        return reply.code(201).send({ item: toResponse(record) });
    });
    server.put('/:sku', async (request, reply) => {
        const { sku } = request.params;
        if (!productStore.has(sku)) {
            return reply.code(404).send({ error: '요청한 상품을 찾을 수 없습니다.' });
        }
        const validation = validateProductPayload(request.body);
        if (!validation.success) {
            return reply.code(400).send({ error: '유효하지 않은 입력입니다.', details: validation.errors });
        }
        const { value } = validation;
        if (value.sku !== sku && productStore.has(value.sku)) {
            return reply.code(409).send({ error: '이미 존재하는 SKU입니다.' });
        }
        ensureProductCategory(value.category, value.subCategory);
        const existing = productStore.get(sku);
        const { inventory: inventoryPayload, onHand: _onHand, reserved: _reserved, ...productValue } = value;
        const updated = {
            ...existing,
            ...productValue,
            productId: value.productId ?? existing.productId,
            legacyProductId: existing.legacyProductId,
            packCase: value.packCase ? formatPackCase(value.pack, value.casePack) : '',
            createdAt: existing.createdAt,
            updatedAt: new Date().toISOString(),
        };
        const previousInventory = listInventoryForSku(sku);
        const targetSku = updated.sku;
        const skuChanged = targetSku !== sku;
        if (skuChanged) {
            productStore.delete(sku);
        }
        productStore.set(targetSku, updated);
        if (skuChanged) {
            deleteInventoryForSku(sku);
        }
        if (inventoryPayload !== undefined) {
            const inventoryItems = inventoryPayload.map((entry) => ({
                sku: targetSku,
                warehouseCode: entry.warehouseCode,
                locationCode: entry.locationCode,
                onHand: entry.onHand,
                reserved: entry.reserved,
            }));
            replaceInventoryForSku(targetSku, inventoryItems);
        }
        else if (skuChanged) {
            const moved = previousInventory.map((entry) => ({
                sku: targetSku,
                warehouseCode: entry.warehouseCode,
                locationCode: entry.locationCode,
                onHand: entry.onHand,
                reserved: entry.reserved,
            }));
            replaceInventoryForSku(targetSku, moved);
        }
        syncPolicyDraftForSkuChange(sku, updated);
        return reply.send({ item: toResponse(updated) });
    });
    server.delete('/:sku', async (request, reply) => {
        const { sku } = request.params;
        if (!productStore.has(sku)) {
            return reply.code(404).send({ error: '요청한 상품을 찾을 수 없습니다.' });
        }
        productStore.delete(sku);
        deleteInventoryForSku(sku);
        if (AUTO_SYNC_POLICIES_ENABLED) {
            deletePolicyDrafts([sku]);
        }
        return reply.code(204).send();
    });
}
export function __resetProductStore(seed = true) {
    productStore.clear();
    productSequence = 100;
    autoSeed = seed;
    __resetInventoryStore();
}
export function __getProductRecords() {
    ensureSeedData();
    return Array.from(productStore.values()).map((record) => toResponse(record));
}
export function __findProductBySku(sku) {
    ensureSeedData();
    const record = productStore.get(sku);
    return record ? toResponse(record) : undefined;
}
export function __findProductByLegacyId(legacyProductId) {
    ensureSeedData();
    for (const record of productStore.values()) {
        if (record.legacyProductId === legacyProductId) {
            return toResponse(record);
        }
    }
    return undefined;
}
export function __adjustProductMovementTotals(sku, deltas) {
    const record = productStore.get(sku);
    if (!record) {
        return;
    }
    const inboundDelta = Number.isFinite(deltas.inbound) ? Math.max(0, Math.round(deltas.inbound)) : 0;
    const outboundDelta = Number.isFinite(deltas.outbound) ? Math.max(0, Math.round(deltas.outbound)) : 0;
    if (inboundDelta === 0 && outboundDelta === 0) {
        return;
    }
    const updated = {
        ...record,
        totalInbound: Math.max(0, record.totalInbound + inboundDelta),
        totalOutbound: Math.max(0, record.totalOutbound + outboundDelta),
        updatedAt: new Date().toISOString(),
    };
    productStore.set(sku, updated);
}
export function __upsertProduct(value, options) {
    ensureProductCategory(value.category, value.subCategory);
    ensureSeedData();
    const originalSku = options?.originalSku ?? value.sku;
    const now = new Date().toISOString();
    const existing = productStore.get(originalSku);
    const { inventory: inventoryPayload, onHand: _onHand, reserved: _reserved, brand, expiryDays, ...productValue } = value;
    if (!existing) {
        if (productStore.has(value.sku)) {
            throw new Error('이미 존재하는 SKU입니다.');
        }
        const record = {
            ...productValue,
            brand: brand ?? null,
            expiryDays: expiryDays ?? null,
            productId: value.productId ?? randomUUID(),
            legacyProductId: value.legacyProductId && value.legacyProductId > 0 ? value.legacyProductId : ++productSequence,
            packCase: value.packCase ? formatPackCase(value.pack, value.casePack) : '',
            imageUrl: value.imageUrl ?? null,
            supplyPrice: value.supplyPrice,
            salePrice: value.salePrice,
            createdAt: now,
            updatedAt: now,
        };
        productStore.set(record.sku, record);
        const inventoryItems = (inventoryPayload ?? []).map((entry) => ({
            sku: record.sku,
            warehouseCode: entry.warehouseCode,
            locationCode: entry.locationCode,
            onHand: entry.onHand,
            reserved: entry.reserved,
        }));
        replaceInventoryForSku(record.sku, inventoryItems);
        ensurePolicyDraftForProduct(record);
        return { status: 'created', record };
    }
    const targetSku = value.sku;
    if (targetSku !== originalSku && productStore.has(targetSku)) {
        throw new Error('이미 존재하는 SKU입니다.');
    }
    const updated = {
        ...existing,
        ...productValue,
        productId: value.productId ?? existing.productId,
        legacyProductId: existing.legacyProductId,
        packCase: value.packCase ? formatPackCase(value.pack, value.casePack) : '',
        imageUrl: value.imageUrl ?? null,
        supplyPrice: value.supplyPrice,
        salePrice: value.salePrice,
        createdAt: existing.createdAt,
        updatedAt: now,
    };
    updated.brand = brand !== undefined ? brand ?? null : existing.brand;
    updated.expiryDays = expiryDays !== undefined ? expiryDays ?? null : existing.expiryDays;
    const previousInventory = listInventoryForSku(originalSku);
    const skuChanged = targetSku !== originalSku;
    if (skuChanged) {
        productStore.delete(originalSku);
    }
    productStore.set(targetSku, updated);
    if (skuChanged) {
        deleteInventoryForSku(originalSku);
    }
    if (inventoryPayload !== undefined) {
        const inventoryItems = inventoryPayload.map((entry) => ({
            sku: targetSku,
            warehouseCode: entry.warehouseCode,
            locationCode: entry.locationCode,
            onHand: entry.onHand,
            reserved: entry.reserved,
        }));
        replaceInventoryForSku(targetSku, inventoryItems);
    }
    else if (skuChanged) {
        const moved = previousInventory.map((entry) => ({
            sku: targetSku,
            warehouseCode: entry.warehouseCode,
            locationCode: entry.locationCode,
            onHand: entry.onHand,
            reserved: entry.reserved,
        }));
        replaceInventoryForSku(targetSku, moved);
    }
    syncPolicyDraftForSkuChange(originalSku, updated);
    return { status: 'updated', record: updated };
}
