import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  Partner,
  PurchaseOrder,
  PurchaseOrderSummary,
  SalesOrder,
} from '../../../../services/orders';
import type { Product } from '../../../../domains/products';
import type { OrdersWarehouse } from '../../components/types';
import OrdersPage from '../OrdersPage';
import { ToastProvider } from '../../../../components/Toaster';

const navigateMock = vi.hoisted(() => vi.fn());
const listPartnersMock = vi.hoisted(() => vi.fn());
const createPartnerMock = vi.hoisted(() => vi.fn());
const listPurchaseOrdersMock = vi.hoisted(() => vi.fn());
const getPurchaseOrderMock = vi.hoisted(() => vi.fn());
const recordPurchaseReceiptMock = vi.hoisted(() => vi.fn());
const createPurchaseOrderMock = vi.hoisted(() => vi.fn());
const listSalesOrdersMock = vi.hoisted(() => vi.fn());
const getSalesOrderMock = vi.hoisted(() => vi.fn());
const recordSalesShipmentMock = vi.hoisted(() => vi.fn());
const createSalesOrderMock = vi.hoisted(() => vi.fn());
const fetchWarehousesMock = vi.hoisted(() => vi.fn());
const fetchProductsMock = vi.hoisted(() => vi.fn());
const submitMovementMock = vi.hoisted(() => vi.fn());

const FIXED_NOW = new Date('2025-06-10T00:00:00.000Z');
let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeAll(() => {
  dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => FIXED_NOW.getTime());
});

afterAll(() => {
  dateNowSpy?.mockRestore();
});

const TEXT = {
  formTitle: '\uC0C8 \uC8FC\uBB38 \uC791\uC131',
  purchaseSubmit: '\uC785\uACE0',
  salesSubmit: '\uCD9C\uACE0',
  salesToggle: '\uCD9C\uACE0 \uC8FC\uBB38\uC11C',
  warehouseLabel: '\uCC3D\uACE0',
  partnerLabel: '\uAC70\uB798\uCC98',
  inboundDateLabel: '\uC785\uACE0\uC77C',
  outboundDateLabel: '\uCD9C\uACE0\uC77C',
  productLabel: '\uC0C1\uD488',
  quantityLabel: '\uC218\uB7C9 / \uB2E8\uC704',
};

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock('../../../../services/products', async () => {
  const actual = await vi.importActual<typeof import('../../../../services/products')>(
    '../../../../services/products',
  );
  return {
    ...actual,
    fetchProducts: fetchProductsMock,
  };
});

vi.mock('../../../../services/orders', async () => {
  const actual = await vi.importActual<typeof import('../../../../services/orders')>(
    '../../../../services/orders',
  );
  return {
    ...actual,
    listPartners: listPartnersMock,
    createPartner: createPartnerMock,
    createPurchaseOrder: createPurchaseOrderMock,
    listPurchaseOrders: listPurchaseOrdersMock,
    getPurchaseOrder: getPurchaseOrderMock,
    recordPurchaseReceipt: recordPurchaseReceiptMock,
    listSalesOrders: listSalesOrdersMock,
    getSalesOrder: getSalesOrderMock,
    recordSalesShipment: recordSalesShipmentMock,
    createSalesOrder: createSalesOrderMock,
  };
});

vi.mock('../../../../services/api', async () => {
  const actual = await vi.importActual<typeof import('../../../../services/api')>(
    '../../../../services/api',
  );
  return {
    ...actual,
    fetchWarehouses: fetchWarehousesMock,
  };
});

vi.mock('../../../../services/movements', async () => {
  const actual = await vi.importActual<typeof import('../../../../services/movements')>(
    '../../../../services/movements',
  );
  return {
    ...actual,
    submitMovement: submitMovementMock,
  };
});

const renderOrdersPage = () =>
  render(
    <ToastProvider>
      <OrdersPage />
    </ToastProvider>,
  );

const warehouses: OrdersWarehouse[] = [
  {
    id: 'wh-icn',
    code: 'WHS-ICN',
    name: 'Incheon Distribution Center',
    address: 'Incheon Jung-gu Airport Rd',
    notes: 'Primary inbound warehouse',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
  {
    id: 'wh-gsn',
    code: 'WHS-GSN',
    name: 'Gangseo Delivery Hub',
    address: 'Seoul Gangseo-gu',
    notes: 'Outbound focused',
    isActive: true,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  },
];

const productCatalog: Product[] = [
  {
    productId: 'prod-apple',
    legacyProductId: 1,
    sku: 'ING-APPLE-10KG',
    name: 'Apples 10kg',
    category: 'Fruit',
    subCategory: 'Apple',
    brand: '',
    unit: 'EA',
    packCase: '1/10',
    pack: 1,
    casePack: 10,
    abcGrade: 'A',
    xyzGrade: 'X',
    bufferRatio: 0.2,
    dailyAvg: 10,
    dailyStd: 1,
    totalInbound: 0,
    totalOutbound: 0,
    avgOutbound7d: 0,
    isActive: true,
    onHand: 100,
    reserved: 10,
    risk: 'Normal',
    supplyPrice: null,
    salePrice: null,
    referencePrice: null,
    currency: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    inventory: [],
  },
];

const purchaseSummary: PurchaseOrderSummary = {
  id: 'po-test-1',
  partnerId: 'partner-s-test',
  partnerName: 'Smart Supplier',
  status: 'OPEN',
  createdAt: '2025-01-10T09:00:00.000Z',
  scheduledAt: '2025-01-12T00:00:00.000Z',
  totalQty: 60,
  receivedQty: 20,
  warehouseId: warehouses[0].id,
  warehouseCode: warehouses[0].code,
};

const purchaseDetail: PurchaseOrder = {
  ...purchaseSummary,
  type: 'PURCHASE',
  memo: 'Initial order',
  items: [
    {
      orderId: purchaseSummary.id,
      sku: 'ING-APPLE-10KG',
      qty: 60,
      unit: 'BOX',
      receivedQty: 12,
      warehouseCode: warehouses[0].code,
    },
  ],
  events: [],
};

const salesDetail: SalesOrder = {
  id: 'so-test-1',
  type: 'SALES',
  partnerId: 'partner-c-test',
  status: 'OPEN',
  createdAt: '2025-02-10T09:00:00.000Z',
  scheduledAt: '2025-02-12T00:00:00.000Z',
  memo: 'Sales order',
  warehouseId: warehouses[1].id,
  warehouseCode: warehouses[1].code,
  items: [
    {
      orderId: 'so-test-1',
      sku: 'ING-APPLE-10KG',
      qty: 10,
      unit: 'BOX',
      shippedQty: 0,
      warehouseCode: warehouses[1].code,
    },
  ],
  events: [],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const resolveWarehouseResponse = () => ({
  total: warehouses.length,
  count: warehouses.length,
  items: warehouses.map((warehouse, index) => ({
    id: index + 1,
    code: warehouse.code,
    name: warehouse.name,
    address: warehouse.address,
    notes: warehouse.notes,
    isActive: warehouse.isActive,
    createdAt: warehouse.createdAt,
    updatedAt: warehouse.updatedAt,
  })),
});

const renderAndPrime = async () => {
  renderOrdersPage();
  await screen.findByText(TEXT.formTitle);
};

const fillCommonFields = async () => {
  const form = await screen.findByRole('form', { name: TEXT.formTitle });
  const withinForm = within(form);

  const partnerSelect = withinForm.getByLabelText(TEXT.partnerLabel) as HTMLSelectElement;
  fireEvent.change(partnerSelect, { target: { value: 'partner-s-test' } });

  const dateInput = withinForm.getByLabelText(TEXT.inboundDateLabel) as HTMLInputElement;
  fireEvent.change(dateInput, { target: { value: '2025-05-05T10:00' } });

  const searchInput = await withinForm.findByPlaceholderText(/SKU/);
  fireEvent.change(searchInput, { target: { value: 'apple' } });

  const productSelect = (await withinForm.findAllByLabelText(TEXT.productLabel))[0] as HTMLSelectElement;
  fireEvent.change(productSelect, { target: { value: 'ING-APPLE-10KG' } });

  const quantityInput = withinForm.getByLabelText(TEXT.quantityLabel) as HTMLInputElement;
  fireEvent.change(quantityInput, { target: { value: '12' } });

  const unitSelect = withinForm.getByRole('combobox', { name: /단위|Units/ }) as HTMLSelectElement;
  fireEvent.change(unitSelect, { target: { value: 'BOX' } });

  return { withinForm };
};

beforeEach(() => {
  listPartnersMock.mockReset();
  listPartnersMock.mockResolvedValue([
    {
      id: 'partner-s-test',
      type: 'SUPPLIER',
      name: 'Smart Supplier',
      isActive: true,
      isSample: false,
    } satisfies Partner,
    {
      id: 'partner-c-test',
      type: 'CUSTOMER',
      name: 'Smart Customer',
      isActive: true,
      isSample: false,
    } satisfies Partner,
  ]);
  createPartnerMock.mockReset();

  createPurchaseOrderMock.mockReset();
  createPurchaseOrderMock.mockResolvedValue(purchaseDetail);
  listPurchaseOrdersMock.mockReset();
  listPurchaseOrdersMock.mockResolvedValue([purchaseSummary]);
  getPurchaseOrderMock.mockReset();
  getPurchaseOrderMock.mockResolvedValue(purchaseDetail);
  recordPurchaseReceiptMock.mockReset();

  createSalesOrderMock.mockReset();
  createSalesOrderMock.mockResolvedValue(salesDetail);
  listSalesOrdersMock.mockReset();
  listSalesOrdersMock.mockResolvedValue([]);
  getSalesOrderMock.mockReset();
  getSalesOrderMock.mockResolvedValue(undefined);
  recordSalesShipmentMock.mockReset();
  recordSalesShipmentMock.mockResolvedValue(salesDetail);

  fetchWarehousesMock.mockReset();
  fetchWarehousesMock.mockResolvedValue(resolveWarehouseResponse());
  fetchProductsMock.mockReset();
  fetchProductsMock.mockResolvedValue(productCatalog);

  submitMovementMock.mockReset();

  navigateMock.mockReset();
});

describe('OrdersPage purchase flow', () => {
  it('requires warehouse selection before submitting a purchase order', async () => {
    await renderAndPrime();
    const { withinForm } = await fillCommonFields();

    const submitButton = withinForm.getByRole('button', { name: TEXT.purchaseSubmit });
    fireEvent.click(submitButton);

    expect(createPurchaseOrderMock).not.toHaveBeenCalled();
    expect(submitMovementMock).not.toHaveBeenCalled();
  });

  it('creates purchase order and posts receipt movement', async () => {
    await renderAndPrime();
    const { withinForm } = await fillCommonFields();

    const warehouseSelect = withinForm.getByLabelText(TEXT.warehouseLabel) as HTMLSelectElement;
    fireEvent.change(warehouseSelect, { target: { value: warehouses[0].code } });

    const submitButton = withinForm.getByRole('button', { name: TEXT.purchaseSubmit });
    fireEvent.click(submitButton);

    try {
      await waitFor(() => expect(createPurchaseOrderMock).toHaveBeenCalledTimes(1));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('createPurchaseOrderMock calls', createPurchaseOrderMock.mock.calls.length);
      throw error;
    }
    const orderPayload = createPurchaseOrderMock.mock.calls[0][0];
    expect(orderPayload.status).toBe('RECEIVED');
    expect(orderPayload.scheduledAt).toBe('2025-05-05T01:00:00.000Z');

    try {
      await waitFor(() => expect(submitMovementMock).toHaveBeenCalledTimes(1));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('submitMovementMock calls', submitMovementMock.mock.calls.length);
      throw error;
    }
    const movementPayload = submitMovementMock.mock.calls[0][0];
    expect(movementPayload).toMatchObject({
      type: 'RECEIPT',
      sku: 'ING-APPLE-10KG',
      qty: 12,
      toWarehouse: warehouses[0].code,
      occurredAt: expect.any(String),
      refNo: purchaseDetail.id,
    });
  });
});

describe('OrdersPage sales flow', () => {
  it('creates sales order and posts shipment movement', async () => {
    await renderAndPrime();

    const form = await screen.findByRole('form', { name: TEXT.formTitle });
    const withinForm = within(form);

    const salesToggle = withinForm.getByRole('button', { name: TEXT.salesToggle });
    fireEvent.click(salesToggle);

    const partnerSelect = withinForm.getByLabelText(TEXT.partnerLabel) as HTMLSelectElement;
    fireEvent.change(partnerSelect, { target: { value: 'partner-c-test' } });

    const dateInput = withinForm.getByLabelText(TEXT.outboundDateLabel) as HTMLInputElement;
    fireEvent.change(dateInput, { target: { value: '2025-06-10T08:00' } });

    const searchInput = await withinForm.findByPlaceholderText(/SKU/);
    fireEvent.change(searchInput, { target: { value: 'apple' } });

    const productSelect = (await withinForm.findAllByLabelText(TEXT.productLabel))[0] as HTMLSelectElement;
    fireEvent.change(productSelect, { target: { value: 'ING-APPLE-10KG' } });

    const quantityInput = withinForm.getByLabelText(TEXT.quantityLabel) as HTMLInputElement;
    fireEvent.change(quantityInput, { target: { value: '7' } });

    const warehouseSelect = withinForm.getByLabelText(TEXT.warehouseLabel) as HTMLSelectElement;
    fireEvent.change(warehouseSelect, { target: { value: warehouses[1].code } });

    const submitButton = withinForm.getByRole('button', { name: TEXT.salesSubmit });
    fireEvent.click(submitButton);

    await waitFor(() => expect(createSalesOrderMock).toHaveBeenCalledTimes(1));
    const salesOrderPayload = createSalesOrderMock.mock.calls[0][0];
    expect(salesOrderPayload.scheduledAt).toBe('2025-06-09T23:00:00.000Z');
    await waitFor(() => expect(recordSalesShipmentMock).toHaveBeenCalledTimes(1));
    expect(recordSalesShipmentMock).toHaveBeenCalledWith(
      'so-test-1',
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            sku: 'ING-APPLE-10KG',
            quantity: 7,
            warehouseCode: warehouses[1].code,
          }),
        ],
      }),
    );
    await waitFor(() => expect(submitMovementMock).toHaveBeenCalledTimes(1));
    expect(submitMovementMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ISSUE',
        sku: 'ING-APPLE-10KG',
        qty: 7,
        fromWarehouse: warehouses[1].code,
        occurredAt: expect.any(String),
      }),
    );
  });
});
