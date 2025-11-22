export interface OrdersWarehouse {
  id: string;
  code: string;
  name?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}
