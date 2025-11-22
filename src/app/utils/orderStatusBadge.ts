import type { PurchaseOrder } from '@/services/purchaseOrders';
import type { SalesOrder } from '@/services/salesOrders';

type OrderStatusTone = 'draft' | 'awaiting' | 'partial' | 'completed' | 'canceled' | 'unknown';

const ORDER_STATUS_TONE_STYLES: Record<OrderStatusTone, { badge: string; ring: string }> = {
  draft: {
    badge: 'bg-sky-50 text-sky-700',
    ring: 'ring-sky-100',
  },
  awaiting: {
    badge: 'bg-[#F97316] text-white',
    ring: 'ring-[#F97316]/50',
  },
  partial: {
    badge: 'bg-orange-50 text-orange-700',
    ring: 'ring-orange-100',
  },
  completed: {
    badge: 'bg-emerald-50 text-emerald-700',
    ring: 'ring-emerald-100',
  },
  canceled: {
    badge: 'bg-rose-50 text-rose-700',
    ring: 'ring-rose-100',
  },
  unknown: {
    badge: 'bg-slate-50 text-slate-600',
    ring: 'ring-slate-100',
  },
};

const PURCHASE_STATUS_TONES: Record<PurchaseOrder['status'], OrderStatusTone> = {
  draft: 'draft',
  open: 'awaiting',
  partial: 'partial',
  closed: 'completed',
  canceled: 'canceled',
};

const SALES_STATUS_TONES: Record<SalesOrder['status'], OrderStatusTone> = {
  draft: 'draft',
  open: 'awaiting',
  partial: 'partial',
  packed: 'partial',
  closed: 'completed',
  canceled: 'canceled',
};

const resolveTone = <Status extends string>(
  mapping: Record<Status, OrderStatusTone>,
  status: Status,
): OrderStatusTone => mapping[status] ?? 'unknown';

export const getPurchaseStatusBadgeClass = (status: PurchaseOrder['status']): string =>
  ORDER_STATUS_TONE_STYLES[resolveTone(PURCHASE_STATUS_TONES, status)].badge;

export const getPurchaseStatusRingClass = (status: PurchaseOrder['status']): string =>
  ORDER_STATUS_TONE_STYLES[resolveTone(PURCHASE_STATUS_TONES, status)].ring;

export const getSalesStatusBadgeClass = (status: SalesOrder['status']): string =>
  ORDER_STATUS_TONE_STYLES[resolveTone(SALES_STATUS_TONES, status)].badge;

export const getSalesStatusRingClass = (status: SalesOrder['status']): string =>
  ORDER_STATUS_TONE_STYLES[resolveTone(SALES_STATUS_TONES, status)].ring;
