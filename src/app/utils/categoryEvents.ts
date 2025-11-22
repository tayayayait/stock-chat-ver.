export const CATEGORIES_CHANGED_EVENT = 'stockwise:categories-changed';

export interface CategoriesChangedDetail {
  reason?: 'load' | 'create' | 'update' | 'delete' | 'reorder' | string;
  categoryId?: string;
  at?: number;
}

export type CategoriesChangedEvent = CustomEvent<CategoriesChangedDetail>;

export const emitCategoriesChanged = (detail?: CategoriesChangedDetail) => {
  if (typeof window === 'undefined') {
    return;
  }
  const event = new CustomEvent<CategoriesChangedDetail>(CATEGORIES_CHANGED_EVENT, {
    detail: { at: Date.now(), ...(detail ?? {}) },
  });
  window.dispatchEvent(event);
};

export const subscribeCategoriesChanged = (
  listener: (event: CategoriesChangedEvent) => void,
): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }
  const handler = (event: Event) => listener(event as CategoriesChangedEvent);
  window.addEventListener(CATEGORIES_CHANGED_EVENT, handler);
  return () => window.removeEventListener(CATEGORIES_CHANGED_EVENT, handler);
};

