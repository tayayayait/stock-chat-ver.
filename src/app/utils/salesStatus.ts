import { ko } from '@/src/i18n/ko';
import type { SalesOrder } from '@/services/salesOrders';

const SALES_STATUS_LABELS: Record<SalesOrder['status'], string> = {
  draft: ko.salesOrders.tabs.labels.draft,
  open: ko.salesOrders.tabs.labels.awaiting,
  partial: ko.salesOrders.tabs.labels.partial,
  packed: ko.salesOrders.tabs.labels.partial,
  closed: ko.salesOrders.tabs.labels.shipped,
  canceled: ko.salesOrders.tabs.labels.canceled,
};

export const getSalesStatusLabel = (status: SalesOrder['status']): string =>
  SALES_STATUS_LABELS[status] ?? status;
