import { convertKstDateTimeLocalToIso, formatDateTimeLocalFromUtc } from '@/shared/datetime/kst';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const ISO_DATETIME_WITH_OFFSET_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

const buildIsoFromDateOnly = (value: string): string | null => {
  const timestamp = Date.parse(`${value}T00:00:00+09:00`);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp).toISOString();
};

export const convertToDatetimeLocal = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (DATETIME_LOCAL_PATTERN.test(trimmed)) {
    return trimmed;
  }
  if (ISO_DATETIME_WITH_OFFSET_PATTERN.test(trimmed)) {
    return formatDateTimeLocalFromUtc(trimmed) || null;
  }
  if (DATE_ONLY_PATTERN.test(trimmed)) {
    return `${trimmed}T00:00`;
  }
  return null;
};

export const ensureDatetimeLocalValue = (
  value?: string | null,
  fallback = formatDateTimeLocalFromUtc(Date.now()),
): string => convertToDatetimeLocal(value) ?? fallback;

export const convertToIsoTimestamp = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  if (DATETIME_LOCAL_PATTERN.test(trimmed)) {
    return convertKstDateTimeLocalToIso(trimmed);
  }
  if (ISO_DATETIME_WITH_OFFSET_PATTERN.test(trimmed)) {
    const timestamp = Date.parse(trimmed);
    if (Number.isNaN(timestamp)) {
      return null;
    }
    return new Date(timestamp).toISOString();
  }
  if (DATE_ONLY_PATTERN.test(trimmed)) {
    return buildIsoFromDateOnly(trimmed);
  }
  return null;
};
