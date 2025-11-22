import { get, post, put, del } from './api';

export interface SalesOrderLine {
  id: string;
  soId: string;
  sku: string;
  orderedQty: number;
  shippedQty: number;
  status: 'open' | 'partial' | 'closed';
  unit?: string;
  productName?: string;
  unitPrice?: number;
  taxAmount?: number;
  taxLabel?: string;
  amount?: number;
  currency?: string;
  taxTypeId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SalesOrder {
  id: string;
  tenantId?: string;
  customerId: string;
  customerName: string;
  status: 'open' | 'partial' | 'packed' | 'closed' | 'canceled' | 'draft';
  orderNumber: string;
  orderDate: string;
  orderSequence?: number;
  memo: string | null;
  createdAt: string;
  confirmedAt: string | null;
  updatedAt: string;
  promisedDate: string | null;
  lines: SalesOrderLine[];
}

interface SalesOrderListResponse {
  success: true;
  items: SalesOrder[];
}

interface SalesOrderResponse {
  success: true;
  item: SalesOrder;
}

export interface CreateSalesOrderLine {
  sku: string;
  orderedQty: number;
  productName?: string;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  taxAmount?: number;
  taxLabel?: string;
  currency?: string;
  taxTypeId?: string;
}

export interface CreateSalesOrderPayload {
  customerId: string;
  customerName?: string;
  orderNumber?: string;
  orderDate?: string;
  memo?: string;
  promisedDate?: string;
  shippingMode?: string;
  shippingNote?: string;
  warehouse?: string;
  lines: CreateSalesOrderLine[];
}

export interface NextSalesOrderNumber {
  orderNumber: string;
  orderDate: string;
  sequence: number;
}

interface NextSalesOrderNumberResponse {
  success: true;
  item: NextSalesOrderNumber;
}

export interface SalesOrderListFilters {
  from?: string;
  to?: string;
}

export const listSalesOrders = async (filters?: SalesOrderListFilters): Promise<SalesOrder[]> => {
  const params = new URLSearchParams();
  if (filters?.from) {
    params.set('from', filters.from);
  }
  if (filters?.to) {
    params.set('to', filters.to);
  }
  const query = params.toString();
  const path = query ? `/sales-orders?${query}` : '/sales-orders';
  const response = await get<SalesOrderListResponse>(path);
  return response.items;
};

export const getNextSalesOrderNumber = async (orderDate: string): Promise<NextSalesOrderNumber> => {
  const params = new URLSearchParams({ orderDate });
  const query = params.toString();
  const path = query ? `/sales-orders/next-number?${query}` : '/sales-orders/next-number';
  const response = await get<NextSalesOrderNumberResponse>(path);
  return response.item;
};

export const createSalesOrder = async (payload: CreateSalesOrderPayload): Promise<SalesOrder> => {
  const response = await post<SalesOrderResponse>('/sales-orders', payload);
  return response.item;
};

export const createSalesOrderDraft = async (
  payload: CreateSalesOrderPayload,
): Promise<SalesOrder> => {
  const response = await post<SalesOrderResponse>('/sales-orders/drafts', payload);
  return response.item;
};

export const updateSalesOrderDraft = async (
  id: string,
  payload: CreateSalesOrderPayload,
): Promise<SalesOrder> => {
  const response = await put<SalesOrderResponse>(`/sales-orders/drafts/${encodeURIComponent(id)}`, payload);
  return response.item;
};

export const getSalesOrder = async (id: string): Promise<SalesOrder> => {
  const response = await get<SalesOrderResponse>(`/sales-orders/${encodeURIComponent(id)}`);
  return response.item;
};

export const cancelSalesOrder = async (id: string): Promise<SalesOrder> => {
  const response = await put<SalesOrderResponse>(`/sales-orders/${encodeURIComponent(id)}/cancel`);
  return response.item;
};

export const deleteSalesOrder = async (id: string): Promise<SalesOrder> => {
  const response = await del<SalesOrderResponse>(`/sales-orders/${encodeURIComponent(id)}`);
  return response.item;
};

export interface SalesOrderDraftLine {
  sku: string;
  orderedQty: number;
  productName?: string;
  unit?: string;
  unitPrice?: number;
  amount?: number;
  taxAmount?: number;
  taxLabel?: string;
  currency?: string;
  taxTypeId?: string;
}

export interface SalesOrderDraftRecord {
  id: string;
  status: 'draft';
  tenantId: string;
  customerId: string;
  customerName?: string;
  orderNumber?: string;
  orderDate?: string;
  memo?: string | null;
  promisedDate?: string | null;
  shippingMode?: string;
  shippingNote?: string | null;
  warehouse?: string | null;
  lines: SalesOrderDraftLine[];
  createdAt: string;
  updatedAt: string;
}

interface SalesOrderDraftListResponse {
  success: true;
  items: SalesOrderDraftRecord[];
}

interface SalesOrderDraftResponse {
  success: true;
  item: SalesOrderDraftRecord;
}

export interface SalesOrderDraftListFilters {
  from?: string;
  to?: string;
}

export const listSalesOrderDrafts = async (
  filters?: SalesOrderDraftListFilters,
): Promise<SalesOrderDraftRecord[]> => {
  const params = new URLSearchParams();
  if (filters?.from) {
    params.set('from', filters.from);
  }
  if (filters?.to) {
    params.set('to', filters.to);
  }
  const query = params.toString();
  const path = query ? `/sales-orders/drafts?${query}` : '/sales-orders/drafts';
  const response = await get<SalesOrderDraftListResponse>(path);
  return response.items;
};

export const getSalesOrderDraft = async (id: string): Promise<SalesOrderDraftRecord> => {
  const response = await get<SalesOrderDraftResponse>(`/sales-orders/drafts/${encodeURIComponent(id)}`);
  return response.item;
};

export const deleteSalesOrderDraft = async (id: string): Promise<SalesOrderDraftRecord> => {
  const response = await del<SalesOrderDraftResponse>(`/sales-orders/drafts/${encodeURIComponent(id)}`);
  return response.item;
};
