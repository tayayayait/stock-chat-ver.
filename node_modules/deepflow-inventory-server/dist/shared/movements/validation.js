import { MOVEMENT_TYPES } from './types.js';
const ISO_8601_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_SKU_LENGTH = 64;
const MAX_REFERENCE_LENGTH = 128;
const MAX_MEMO_LENGTH = 500;
const isMovementType = (value) => MOVEMENT_TYPES.includes(value);
const sanitizeString = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
};
const sanitizeOptionalString = (value, limit) => {
    const sanitized = sanitizeString(value);
    if (!sanitized) {
        return undefined;
    }
    return sanitized.length <= limit ? sanitized : sanitized.slice(0, limit);
};
const sanitizeSku = (value) => {
    const sanitized = sanitizeString(value);
    if (!sanitized) {
        return undefined;
    }
    if (sanitized.length > MAX_SKU_LENGTH) {
        return sanitized.slice(0, MAX_SKU_LENGTH);
    }
    return sanitized.toUpperCase();
};
const parseIsoDate = (value) => {
    if (typeof value !== 'string') {
        return undefined;
    }
    const trimmed = value.trim();
    if (!ISO_8601_REGEX.test(trimmed)) {
        return undefined;
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) {
        return undefined;
    }
    return trimmed;
};
const sanitizePositiveInteger = (value) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    const rounded = Math.round(value);
    if (rounded <= 0) {
        return undefined;
    }
    return rounded;
};
const sanitizeOptionalLocation = (value) => {
    const sanitized = sanitizeString(value);
    return sanitized ? sanitized.toUpperCase() : undefined;
};
export const validateMovementDraft = (input, options = {}) => {
    const errors = [];
    const typeValue = typeof input.type === 'string' ? input.type.trim().toUpperCase() : '';
    if (!isMovementType(typeValue)) {
        errors.push('type must be one of RECEIPT, ISSUE, ADJUST, TRANSFER, RETURN.');
    }
    const skuValue = sanitizeSku(input.sku);
    if (!skuValue) {
        errors.push('sku is required.');
    }
    const qtyValue = sanitizePositiveInteger(input.qty);
    if (qtyValue === undefined) {
        errors.push('qty must be a positive integer.');
    }
    const userIdValue = sanitizeString(input.userId);
    if (!userIdValue) {
        errors.push('userId is required.');
    }
    let occurredAtValue = parseIsoDate(input.occurredAt);
    if (!occurredAtValue) {
        if (options.requireOccurredAt ?? false) {
            errors.push('occurredAt must be a valid ISO 8601 string.');
        }
        else {
            occurredAtValue = new Date().toISOString();
        }
    }
    const fromWarehouseValue = sanitizeOptionalLocation(input.fromWarehouse);
    const toWarehouseValue = sanitizeOptionalLocation(input.toWarehouse);
    const fromLocationValue = sanitizeOptionalString(input.fromLocation, MAX_REFERENCE_LENGTH);
    const toLocationValue = sanitizeOptionalString(input.toLocation, MAX_REFERENCE_LENGTH);
    const poIdValue = sanitizeOptionalString(input.poId, MAX_REFERENCE_LENGTH);
    const poLineIdValue = sanitizeOptionalString(input.poLineId, MAX_REFERENCE_LENGTH);
    const soIdValue = sanitizeOptionalString(input.soId, MAX_REFERENCE_LENGTH);
    const soLineIdValue = sanitizeOptionalString(input.soLineId, MAX_REFERENCE_LENGTH);
    const partnerIdValue = sanitizeOptionalString(input.partnerId, MAX_REFERENCE_LENGTH);
    const refNoValue = sanitizeOptionalString(input.refNo, MAX_REFERENCE_LENGTH);
    const memoValue = sanitizeOptionalString(input.memo, MAX_MEMO_LENGTH);
    if (errors.length > 0) {
        return { success: false, errors };
    }
    return {
        success: true,
        data: {
            type: typeValue,
            sku: skuValue,
            qty: qtyValue,
            userId: userIdValue,
            occurredAt: occurredAtValue,
            fromWarehouse: fromWarehouseValue,
            fromLocation: fromLocationValue,
            toWarehouse: toWarehouseValue,
            toLocation: toLocationValue,
            poId: poIdValue,
            poLineId: poLineIdValue,
            soId: soIdValue,
            soLineId: soLineIdValue,
            partnerId: partnerIdValue,
            refNo: refNoValue,
            memo: memoValue,
        },
    };
};
export const isIso8601 = (value) => ISO_8601_REGEX.test(value);
