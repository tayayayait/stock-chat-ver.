import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProductDetailPanel from '../components/ProductDetailPanel';
import { createEmptyProduct } from '../../../../domains/products';
import type { InventoryAnalysisResponse } from '../../../../services/inventoryDashboard';

const listMovementsMock = vi.hoisted(() => vi.fn());
const fetchWarehousesMock = vi.hoisted(() => vi.fn());
const fetchLocationsMock = vi.hoisted(() => vi.fn());
const listPartnersMock = vi.hoisted(() => vi.fn());
const fetchInventoryAnalysisMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/movements', () => ({
  listMovements: listMovementsMock,
}));

vi.mock('../../../../services/api', () => ({
  fetchWarehouses: fetchWarehousesMock,
  fetchLocations: fetchLocationsMock,
}));

vi.mock('../../../../services/orders', () => ({
  listPartners: listPartnersMock,
}));

vi.mock('../../../../services/inventoryDashboard', () => ({
  fetchInventoryAnalysis: fetchInventoryAnalysisMock,
}));

const buildProduct = () => {
  const base = createEmptyProduct();
  return {
    ...base,
    productId: 'product-1',
    legacyProductId: 1,
    sku: 'SKU-001',
    name: '테스트 상품',
    category: '식품',
    subCategory: '간식',
    onHand: 120,
    reserved: 20,
    inventory: [
      {
        warehouseCode: 'WH-01',
        locationCode: 'LOC-01',
        onHand: 80,
        reserved: 10,
      },
    ],
  };
};

describe('ProductDetailPanel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-03-15T00:00:00.000Z'));
    listMovementsMock.mockReset();
    fetchWarehousesMock.mockReset();
    fetchLocationsMock.mockReset();
    listPartnersMock.mockReset();
    fetchInventoryAnalysisMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const createAnalysisResponse = (
    range: { from: string; to: string },
    totals: { inbound: number; outbound: number; adjustments: number; transfers?: number },
  ): InventoryAnalysisResponse => ({
    generatedAt: '2024-03-15T00:00:00.000Z',
    range: {
      from: range.from,
      to: range.to,
      dayCount: 30,
      groupBy: 'week',
    },
    scope: {
      warehouseCode: null,
      sku: 'SKU-001',
    },
    totals: {
      inbound: totals.inbound,
      outbound: totals.outbound,
      adjustments: totals.adjustments,
      transfers: totals.transfers ?? 0,
      net: totals.inbound - totals.outbound + totals.adjustments,
      currentOnHand: 0,
      currentReserved: 0,
      currentAvailable: 0,
      safetyStock: 0,
      avgDailyOutbound: 0,
      stockoutEtaDays: null,
      projectedStockoutDate: null,
    },
    movementSeries: [],
    stockSeries: [],
    periodSeries: [],
  });

  it('renders total inventory summary and latest receipt/issue details', async () => {
    const product = buildProduct();
    const latestReceiptDate = '2024-02-10T03:00:00Z';
    const latestIssueDate = '2024-02-12T09:30:00Z';
    const currentRange = { from: '2024-02-15', to: '2024-03-15' };
    const previousRange = { from: '2024-01-16', to: '2024-02-14' };

    const receiptLabel = new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(latestReceiptDate));

    const issueLabel = new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(latestIssueDate));

    fetchInventoryAnalysisMock
      .mockResolvedValueOnce(
        createAnalysisResponse(currentRange, { inbound: 50, outbound: 20, adjustments: 0 }),
      )
      .mockResolvedValueOnce(
        createAnalysisResponse(previousRange, { inbound: 30, outbound: 20, adjustments: 0 }),
      );

    listMovementsMock.mockResolvedValue({
      total: 3,
      count: 3,
      offset: 0,
      limit: 50,
      items: [
        {
          id: 'mv-1',
          occurredAt: latestReceiptDate,
          type: 'RECEIPT',
          qty: 30,
          partnerId: 'ACME',
          from: null,
          to: { warehouseCode: 'WH-01', locationCode: 'LOC-01' },
        },
        {
          id: 'mv-2',
          occurredAt: latestIssueDate,
          type: 'ISSUE',
          qty: 10,
          from: { warehouseCode: 'WH-01', locationCode: 'LOC-02' },
          to: null,
        },
        {
          id: 'mv-3',
          occurredAt: '2023-12-01T00:00:00Z',
          type: 'ADJUST',
          qty: 5,
          partnerId: 'OLD',
        },
      ],
    });

    fetchWarehousesMock.mockResolvedValue({
      items: [
        {
          code: 'WH-01',
          name: '서울 1센터',
        },
      ],
    });

    fetchLocationsMock.mockImplementation(async (warehouseCode) => {
      if (warehouseCode === 'WH-01') {
        return {
          items: [
            { code: 'LOC-01', warehouseCode: 'WH-01', description: '상온 랙 1열' },
            { code: 'LOC-02', warehouseCode: 'WH-01', description: '상온 랙 2열' },
          ],
        };
      }
      return { items: [] };
    });

    listPartnersMock.mockResolvedValue([
      { id: 'ACME', name: '에이씨미 상사' },
    ]);

    render(<ProductDetailPanel product={product} warehouseRefreshToken={0} />);

    await waitFor(() => {
      expect(listMovementsMock).toHaveBeenCalledWith(
        expect.objectContaining({ from: currentRange.from, to: currentRange.to }),
      );
    });

    expect(screen.getByText('재고 요약')).toBeInTheDocument();
    expect(screen.getByText('총 재고')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText(receiptLabel)).toBeInTheDocument();
      expect(screen.getByText(issueLabel)).toBeInTheDocument();
    });

    await waitFor(() => {
      expect(screen.getByText('↑ 200.0%')).toBeInTheDocument();
    });

    expect(screen.getByText('100 EA')).toBeInTheDocument();
    expect(screen.getByText('120 EA')).toBeInTheDocument();
    expect(screen.getByText('20 EA')).toBeInTheDocument();
    expect(screen.getByText('+30 EA')).toBeInTheDocument();
    expect(screen.getByText('-10 EA')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('에이씨미 상사')).toBeInTheDocument();
    });
    expect(screen.getByText('거래처 정보 없음')).toBeInTheDocument();
    expect(screen.getByText('서울 1센터 > 상온 랙 1열')).toBeInTheDocument();
  });
});
