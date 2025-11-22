import { createWarehouse, deleteWarehouse, ensureWarehouseSeedData, findWarehouseByCode, listWarehouses, updateWarehouse, } from '../stores/warehousesStore.js';
import { deleteLocationsByWarehouse } from '../stores/locationsStore.js';
import { deleteInventoryByWarehouse } from '../stores/inventoryStore.js';
const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const hasOwn = (candidate, key) => Object.prototype.hasOwnProperty.call(candidate, key);
function normalize(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function validateWarehousePayload(input) {
    if (typeof input !== 'object' || input === null) {
        return { success: false, errors: ['요청 본문이 객체가 아닙니다.'] };
    }
    const candidate = input;
    const errors = [];
    ['code', 'name'].forEach((field) => {
        if (!isNonEmptyString(candidate[field])) {
            errors.push(`${String(field)} 필드는 비어있을 수 없습니다.`);
        }
    });
    const value = {
        code: normalize(candidate.code),
        name: normalize(candidate.name),
    };
    if (hasOwn(candidate, 'address')) {
        const rawAddress = candidate.address;
        if (rawAddress === null || rawAddress === undefined) {
            value.address = undefined;
        }
        else if (typeof rawAddress === 'string') {
            const normalizedAddress = normalize(rawAddress);
            value.address = normalizedAddress.length > 0 ? normalizedAddress : undefined;
        }
        else {
            errors.push('address 필드는 문자열이어야 합니다.');
        }
    }
    if (hasOwn(candidate, 'notes')) {
        const rawNotes = candidate.notes;
        if (rawNotes === null || rawNotes === undefined) {
            value.notes = undefined;
        }
        else if (typeof rawNotes === 'string') {
            const normalizedNotes = normalize(rawNotes);
            value.notes = normalizedNotes.length > 0 ? normalizedNotes : undefined;
        }
        else {
            errors.push('notes 필드는 문자열이어야 합니다.');
        }
    }
    if (errors.length > 0) {
        return { success: false, errors };
    }
    return {
        success: true,
        value,
    };
}
function toResponse(record) {
    return { ...record };
}
export default async function warehousesRoutes(server) {
    ensureWarehouseSeedData();
    server.get('/', async (_request, reply) => {
        const items = listWarehouses().map((item) => toResponse(item));
        return reply.send({ items, count: items.length });
    });
    server.get('/:code', async (request, reply) => {
        const { code } = request.params;
        const record = findWarehouseByCode(code);
        if (!record) {
            return reply.code(404).send({ error: '요청한 물류센터를 찾을 수 없습니다.' });
        }
        return reply.send({ item: toResponse(record) });
    });
    server.post('/', async (request, reply) => {
        const validation = validateWarehousePayload(request.body);
        if (!validation.success) {
            return reply.code(400).send({ error: '유효하지 않은 입력입니다.', details: validation.errors });
        }
        const { value } = validation;
        if (findWarehouseByCode(value.code)) {
            return reply.code(409).send({ error: '이미 존재하는 물류센터 코드입니다.' });
        }
        const record = createWarehouse(value);
        return reply.code(201).send({ item: toResponse(record) });
    });
    server.put('/:code', async (request, reply) => {
        const { code } = request.params;
        const existing = findWarehouseByCode(code);
        if (!existing) {
            return reply.code(404).send({ error: '요청한 물류센터를 찾을 수 없습니다.' });
        }
        const validation = validateWarehousePayload(request.body);
        if (!validation.success) {
            return reply.code(400).send({ error: '유효하지 않은 입력입니다.', details: validation.errors });
        }
        const { value } = validation;
        if (value.code !== code) {
            return reply
                .code(400)
                .send({ error: '코드는 경로 파라미터와 동일해야 합니다. 다른 코드로 변경할 수 없습니다.' });
        }
        const changes = { name: value.name };
        if (hasOwn(value, 'address')) {
            changes.address = value.address;
        }
        if (hasOwn(value, 'notes')) {
            changes.notes = value.notes;
        }
        const updated = updateWarehouse(code, changes);
        return reply.send({ item: toResponse(updated) });
    });
    server.delete('/:code', async (request, reply) => {
        const { code } = request.params;
        const existing = findWarehouseByCode(code);
        if (!existing) {
            return reply.code(404).send({ error: '요청한 물류센터를 찾을 수 없습니다.' });
        }
        deleteWarehouse(code);
        deleteLocationsByWarehouse(code);
        deleteInventoryByWarehouse(code);
        return reply.code(204).send();
    });
}
export { validateWarehousePayload };
