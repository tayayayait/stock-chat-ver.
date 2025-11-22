const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const KST_OFFSET_HOURS = 9;
const KST_OFFSET_MS = KST_OFFSET_HOURS * MS_PER_HOUR;
const DATETIME_LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const pad2 = (value) => String(value).padStart(2, '0');
const coerceUtcMs = (input) => {
    if (typeof input === 'number') {
        return Number.isFinite(input) ? input : null;
    }
    if (input instanceof Date) {
        const timestamp = input.getTime();
        return Number.isNaN(timestamp) ? null : timestamp;
    }
    if (typeof input === 'string') {
        const parsed = new Date(input);
        const timestamp = parsed.getTime();
        return Number.isNaN(timestamp) ? null : timestamp;
    }
    return null;
};
const buildShiftedParts = (utcMs, offsetMs) => {
    const shifted = new Date(utcMs + offsetMs);
    return {
        year: shifted.getUTCFullYear(),
        month: pad2(shifted.getUTCMonth() + 1),
        day: pad2(shifted.getUTCDate()),
        hours: pad2(shifted.getUTCHours()),
        minutes: pad2(shifted.getUTCMinutes()),
        seconds: pad2(shifted.getUTCSeconds()),
    };
};
const formatKstDisplayCore = (utcMs, withSeconds = false) => {
    const parts = buildShiftedParts(utcMs, KST_OFFSET_MS);
    const time = withSeconds ? `${parts.hours}:${parts.minutes}:${parts.seconds}` : `${parts.hours}:${parts.minutes}`;
    return `${parts.year}-${parts.month}-${parts.day} ${time} KST (UTC+9)`;
};
const formatUtcDisplayCore = (utcMs, withSeconds = false) => {
    const parts = buildShiftedParts(utcMs, 0);
    const time = withSeconds ? `${parts.hours}:${parts.minutes}:${parts.seconds}` : `${parts.hours}:${parts.minutes}`;
    return `${parts.year}-${parts.month}-${parts.day} ${time} UTC`;
};
const formatDateTimeLocalCore = (utcMs) => {
    const parts = buildShiftedParts(utcMs, KST_OFFSET_MS);
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hours}:${parts.minutes}`;
};
export const ensureDateTimeLocalPrecision = (value) => {
    const match = DATETIME_LOCAL_PATTERN.exec(value.trim());
    if (!match) {
        return value.trim();
    }
    const [, year, month, day, hour, minute] = match;
    return `${year}-${month}-${day}T${hour}:${minute}`;
};
export const parseKstDateTimeLocal = (value) => {
    const match = DATETIME_LOCAL_PATTERN.exec(value.trim());
    if (!match) {
        return null;
    }
    const [, year, month, day, hour, minute, second] = match;
    const utcMs = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), second ? Number(second) : 0);
    if (!Number.isFinite(utcMs)) {
        return null;
    }
    return utcMs - KST_OFFSET_MS;
};
export const convertKstDateTimeLocalToIso = (value) => {
    const utcMs = parseKstDateTimeLocal(value);
    if (utcMs === null) {
        return null;
    }
    return new Date(utcMs).toISOString();
};
export const formatDateTimeLocalFromUtc = (input) => {
    const utcMs = coerceUtcMs(input);
    if (utcMs === null) {
        return '';
    }
    return formatDateTimeLocalCore(utcMs);
};
export const formatKstDateTimeLabelFromUtc = (input, options) => {
    const utcMs = coerceUtcMs(input);
    if (utcMs === null) {
        return null;
    }
    return formatKstDisplayCore(utcMs, options?.withSeconds);
};
export const formatUtcDateTimeLabelFromUtc = (input, options) => {
    const utcMs = coerceUtcMs(input);
    if (utcMs === null) {
        return null;
    }
    return formatUtcDisplayCore(utcMs, options?.withSeconds);
};
export const formatKstDateTimeLabelFromLocal = (value, options) => {
    const utcMs = parseKstDateTimeLocal(value);
    if (utcMs === null) {
        return null;
    }
    return formatKstDisplayCore(utcMs, options?.withSeconds);
};
export const formatUtcDateTimeLabelFromLocal = (value, options) => {
    const utcMs = parseKstDateTimeLocal(value);
    if (utcMs === null) {
        return null;
    }
    return formatUtcDisplayCore(utcMs, options?.withSeconds);
};
export const getKstDayBoundsUtc = (referenceUtcMs = Date.now()) => {
    const startUtcMs = Math.floor((referenceUtcMs + KST_OFFSET_MS) / MS_PER_DAY) * MS_PER_DAY - KST_OFFSET_MS;
    const endUtcMs = startUtcMs + MS_PER_DAY - 1;
    return { startUtcMs, endUtcMs };
};
export const formatKstBoundsLabel = (bounds) => {
    const start = formatKstDateTimeLabelFromUtc(bounds.startUtcMs);
    const end = formatKstDateTimeLabelFromUtc(bounds.endUtcMs);
    if (!start || !end) {
        return '';
    }
    const startLabel = start.replace(' KST (UTC+9)', '');
    const endLabel = end.replace(' KST (UTC+9)', '');
    return `${startLabel} ~ ${endLabel} KST (UTC+9)`;
};
export const isUtcWithinBounds = (utcMs, bounds) => utcMs >= bounds.startUtcMs && utcMs <= bounds.endUtcMs;
export const isKstDateTimeLocalWithinBounds = (value, bounds) => {
    const utcMs = parseKstDateTimeLocal(value);
    if (utcMs === null) {
        return false;
    }
    return isUtcWithinBounds(utcMs, bounds);
};
export const isUtcWithinKstToday = (utcMs, referenceUtcMs = Date.now()) => {
    const bounds = getKstDayBoundsUtc(referenceUtcMs);
    return isUtcWithinBounds(utcMs, bounds);
};
export const isKstDateTimeLocalWithinToday = (value, referenceUtcMs = Date.now()) => {
    const bounds = getKstDayBoundsUtc(referenceUtcMs);
    return isKstDateTimeLocalWithinBounds(value, bounds);
};
export const describeKstTodayWindow = () => {
    const bounds = getKstDayBoundsUtc();
    const label = formatKstBoundsLabel(bounds);
    return { bounds, label };
};
export const detectTimePickerUiMode = () => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        return 'spinner';
    }
    return window.matchMedia('(pointer: coarse)').matches ? 'dial' : 'spinner';
};
