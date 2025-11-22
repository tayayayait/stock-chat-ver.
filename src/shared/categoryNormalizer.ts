import type { Category } from '../services/categories';

const CATEGORY_SUFFIXES = ['자재'] as const;

const normalizeKey = (value: string): string => value.replace(/\s+/g, '').toLowerCase();

const addLookupEntry = (
  map: Map<string, string>,
  rawValue: string,
  canonicalName: string,
): void => {
  const key = normalizeKey(rawValue);
  if (!key) {
    return;
  }
  if (!map.has(key)) {
    map.set(key, canonicalName);
  }
};

const addSuffixVariants = (map: Map<string, string>, baseValue: string, canonicalName: string) => {
  CATEGORY_SUFFIXES.forEach((suffix) => addLookupEntry(map, `${baseValue}${suffix}`, canonicalName));
};

export const buildCategoryLookup = (categories: Category[]): Map<string, string> => {
  const lookup = new Map<string, string>();
  const queue = [...categories];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const trimmedName = current.name?.trim();
    if (trimmedName) {
      addLookupEntry(lookup, trimmedName, trimmedName);
      addSuffixVariants(lookup, trimmedName, trimmedName);
    }
    if (current.children && current.children.length > 0) {
      queue.push(...current.children);
    }
  }

  addLookupEntry(lookup, '기타', '기타');
  return lookup;
};

interface NormalizeCategoryOptions {
  strict?: boolean;
}

export const normalizeCategoryName = (
  value: string | null | undefined,
  lookup: Map<string, string>,
  options?: NormalizeCategoryOptions,
): string | null => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = lookup.get(normalizeKey(trimmed));
  if (candidate) {
    return candidate;
  }

  return options?.strict ? null : trimmed;
};
