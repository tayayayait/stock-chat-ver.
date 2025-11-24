import { DEFAULT_TENANT_ID, buildSalesOrderNumberContext, cancelSalesOrder, createSalesOrder, deleteSalesOrder, deleteSalesOrderDraft, getSalesOrder, getSalesOrderDraft, listSalesOrderDrafts, listSalesOrders, saveSalesOrderDraft, parseOrderDateContext, peekNextSalesOrderNumberForContext, resolveOrderDateContext, } from '../stores/salesOrdersStore.js';
import { MAX_PURCHASE_ORDER_RANGE_MS } from '../../../shared/datetime/ranges.js';
import { InventoryReservationError } from '../stores/inventoryStore.js';
const parseUtcTimestamp = (value) => {
    if (!value) {
        return null;
    }
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }
    const parsed = Date.parse(normalized);
    return Number.isNaN(parsed) ? null : parsed;
};
const resolveTenantId = (request) => {
    const headerValue = request.headers['x-tenant-id'];
    if (typeof headerValue === 'string' && headerValue.trim()) {
        return headerValue.trim();
    }
    return DEFAULT_TENANT_ID;
};
const rangeError = (reply, message) => reply.code(400).send({ success: false, error: message });
const normalizeSalesOrderLines = (lines) => {
    if (!Array.isArray(lines)) {
        return [];
    }
    return lines.map((line) => ({
        sku: typeof line.sku === 'string' ? line.sku : '',
        orderedQty: typeof line.orderedQty === 'number' ? line.orderedQty : 0,
        productName: typeof line.productName === 'string' ? line.productName : undefined,
        unit: typeof line.unit === 'string' ? line.unit : undefined,
        unitPrice: typeof line.unitPrice === 'number' ? line.unitPrice : undefined,
        amount: typeof line.amount === 'number' ? line.amount : undefined,
        taxAmount: typeof line.taxAmount === 'number' ? line.taxAmount : undefined,
        taxLabel: typeof line.taxLabel === 'string' ? line.taxLabel : undefined,
        currency: typeof line.currency === 'string' ? line.currency : undefined,
        taxTypeId: typeof line.taxTypeId === 'string' ? line.taxTypeId : undefined,
    }));
};
const buildSalesOrderPayload = (body, tenantId) => ({
    customerId: body.customerId.trim(),
    customerName: typeof body.customerName === 'string' ? body.customerName : undefined,
    orderNumber: typeof body.orderNumber === 'string' ? body.orderNumber : undefined,
    orderDate: typeof body.orderDate === 'string' ? body.orderDate : undefined,
    memo: typeof body.memo === 'string' ? body.memo : body.shippingNote,
    promisedDate: body.promisedDate,
    tenantId,
    lines: normalizeSalesOrderLines(body.lines),
});
const buildSalesOrderDraftPayload = (body, tenantId) => ({
    ...buildSalesOrderPayload(body, tenantId),
    shippingMode: typeof body.shippingMode === 'string' ? body.shippingMode : undefined,
    shippingNote: typeof body.shippingNote === 'string' ? body.shippingNote : undefined,
    warehouse: typeof body.warehouse === 'string' ? body.warehouse : undefined,
});
export default async function salesOrdersRoutes(server) {
    server.get('/', (request, reply) => {
        const tenantId = resolveTenantId(request);
        const { from, to } = request.query;
        const parsedFrom = parseUtcTimestamp(from);
        const parsedTo = parseUtcTimestamp(to);
        if (from && parsedFrom === null) {
            return rangeError(reply, '올바른 시작일을 입력해 주세요.');
        }
        if (to && parsedTo === null) {
            return rangeError(reply, '올바른 종료일을 입력해 주세요.');
        }
        if (parsedFrom !== null && parsedTo !== null && parsedFrom > parsedTo) {
            return rangeError(reply, '시작일은 종료일보다 앞서야 합니다.');
        }
        if (parsedFrom !== null) {
            const effectiveTo = parsedTo ?? Date.now();
            if (effectiveTo - parsedFrom > MAX_PURCHASE_ORDER_RANGE_MS) {
                return rangeError(reply, '최대 조회 가능 기간은 365일입니다.');
            }
        }
        return reply.send({
            success: true,
            items: listSalesOrders({
                from: parsedFrom ?? undefined,
                to: parsedTo ?? undefined,
                tenantId,
            }),
        });
    });
    server.get('/next-number', (request, reply) => {
        const tenantId = resolveTenantId(request);
        const { orderDate } = request.query;
        const parsedOrderDate = orderDate ? parseOrderDateContext(orderDate) : null;
        if (orderDate && !parsedOrderDate) {
            return rangeError(reply, '올바른 주문일을 입력해 주세요.');
        }
        const resolvedOrderDate = parsedOrderDate ?? resolveOrderDateContext(orderDate);
        const context = buildSalesOrderNumberContext(resolvedOrderDate, tenantId);
        const nextNumber = peekNextSalesOrderNumberForContext(context);
        return reply.send({
            success: true,
            item: {
                orderNumber: nextNumber.orderNumber,
                orderDate: nextNumber.orderDate,
                sequence: nextNumber.sequence,
            },
        });
    });
    server.get('/drafts', (request, reply) => {
        const tenantId = resolveTenantId(request);
        const { from, to } = request.query;
        const parsedFrom = parseUtcTimestamp(from);
        const parsedTo = parseUtcTimestamp(to);
        if (from && parsedFrom === null) {
            return rangeError(reply, '올바른 시작일을 입력해 주세요.');
        }
        if (to && parsedTo === null) {
            return rangeError(reply, '올바른 종료일을 입력해 주세요.');
        }
        if (parsedFrom !== null && parsedTo !== null && parsedFrom > parsedTo) {
            return rangeError(reply, '시작일은 종료일보다 앞서야 합니다.');
        }
        if (parsedFrom !== null) {
            const effectiveTo = parsedTo ?? Date.now();
            if (effectiveTo - parsedFrom > MAX_PURCHASE_ORDER_RANGE_MS) {
                return rangeError(reply, '최대 조회 가능 기간은 365일입니다.');
            }
        }
        const drafts = listSalesOrderDrafts({
            from: parsedFrom ?? undefined,
            to: parsedTo ?? undefined,
            tenantId,
        });
        return reply.send({
            success: true,
            items: drafts,
        });
    });
    server.get('/drafts/:id', (request, reply) => {
        const { id } = request.params;
        const tenantId = resolveTenantId(request);
        const draft = getSalesOrderDraft(id);
        if (!draft || draft.tenantId !== tenantId) {
            return reply.code(404).send({ success: false, error: 'Draft not found' });
        }
        return reply.send({ success: true, item: draft });
    });
    server.get('/:id', (request, reply) => {
        const { id } = request.params;
        const tenantId = resolveTenantId(request);
        const order = getSalesOrder(id);
        if (!order || order.tenantId !== tenantId) {
            return reply.code(404).send({ success: false, error: 'Sales order not found' });
        }
        return reply.send({ success: true, item: order });
    });
    server.post('/', (request, reply) => {
        const tenantId = resolveTenantId(request);
        const body = request.body ?? {};
        if (!body.customerId || !body.lines || body.lines.length === 0) {
            return reply.code(400).send({ success: false, error: 'customerId and lines are required' });
        }
        const payload = buildSalesOrderPayload(body, tenantId);
        try {
            const order = createSalesOrder(payload);
            return reply.code(201).send({ success: true, item: order });
        }
        catch (error) {
            console.error('[salesOrders] failed to create order', error);
            if (error instanceof InventoryReservationError) {
                return reply.code(409).send({ success: false, error: '가용 재고가 부족하여 주문을 생성할 수 없습니다.' });
            }
            if (error instanceof Error && error.message.includes('주문번호')) {
                return reply.code(409).send({ success: false, error: error.message });
            }
            return reply.code(500).send({ success: false, error: '주문 생성에 실패했습니다.' });
        }
    });
    server.post('/drafts', (request, reply) => {
        const tenantId = resolveTenantId(request);
        const body = request.body ?? {};
        if (!body.customerId || !body.lines || body.lines.length === 0) {
            return reply.code(400).send({ success: false, error: 'customerId and lines are required' });
        }
        try {
            const payload = buildSalesOrderDraftPayload(body, tenantId);
            const draft = saveSalesOrderDraft({ ...payload, status: 'draft' });
            return reply.code(201).send({ success: true, item: draft });
        }
        catch (error) {
            console.error('[salesOrders] failed to save draft', error);
            return reply.code(500).send({ success: false, error: '임시 저장에 실패했습니다.' });
        }
    });
    server.put('/drafts/:id', (request, reply) => {
        const { id } = request.params;
        const tenantId = resolveTenantId(request);
        const body = request.body ?? {};
        if (!body.customerId || !body.lines || body.lines.length === 0) {
            return reply.code(400).send({ success: false, error: 'customerId and lines are required' });
        }
        try {
            const payload = buildSalesOrderDraftPayload(body, tenantId);
            const draft = saveSalesOrderDraft({ ...payload, id, status: 'draft' });
            return reply.send({ success: true, item: draft });
        }
        catch (error) {
            console.error('[salesOrders] failed to update draft', error);
            if (error instanceof Error) {
                if (error.message.includes('not found')) {
                    return reply.code(404).send({ success: false, error: '주문서를 찾을 수 없습니다.' });
                }
                if (error.message.includes('Drafts can only be updated')) {
                    return reply.code(400).send({ success: false, error: '임시 저장 중인 주문서만 수정할 수 있습니다.' });
                }
            }
            return reply.code(500).send({ success: false, error: '임시 저장 업데이트에 실패했습니다.' });
        }
    });
    server.delete('/drafts/:id', (request, reply) => {
        const { id } = request.params;
        const tenantId = resolveTenantId(request);
        const existing = getSalesOrderDraft(id);
        if (!existing || existing.tenantId !== tenantId) {
            return reply.code(404).send({ success: false, error: 'Draft not found' });
        }
        const deleted = deleteSalesOrderDraft(id);
        if (!deleted) {
            return reply.code(404).send({ success: false, error: 'Draft not found' });
        }
        return reply.send({ success: true, item: deleted });
    });
    server.put('/:id/cancel', (request, reply) => {
        const { id } = request.params;
        const tenantId = resolveTenantId(request);
        const order = cancelSalesOrder(id);
        if (!order || order.tenantId !== tenantId) {
            return reply.code(404).send({ success: false, error: 'Sales order not found' });
        }
        return reply.send({ success: true, item: order });
    });
    server.delete('/:id', (request, reply) => {
        const { id } = request.params;
        const tenantId = resolveTenantId(request);
        const existing = getSalesOrder(id);
        if (!existing || existing.tenantId !== tenantId) {
            return reply.code(404).send({ success: false, error: 'Sales order not found' });
        }
        const deleted = deleteSalesOrder(id);
        if (!deleted) {
            return reply.code(404).send({ success: false, error: 'Sales order not found' });
        }
        return reply.send({ success: true, item: deleted });
    });
}
