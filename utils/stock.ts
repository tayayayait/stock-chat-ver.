import type { Product } from '../types';

const normalizeReservedQuantity = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
};

export const getAvailableStock = (product: Pick<Product, 'currentStock' | 'reservedQuantity'>): number => {
  const reserved = normalizeReservedQuantity(product.reservedQuantity);
  const available = product.currentStock - reserved;
  return Math.max(0, available);
};
