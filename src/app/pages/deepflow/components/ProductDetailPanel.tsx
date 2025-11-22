import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type Product, DEFAULT_UNIT } from '../../../../domains/products';
import { listMovements, type MovementSummary, type MovementType } from '../../../../services/movements';
import { fetchInventoryAnalysis, type InventoryAnalysisResponse } from '../../../../services/inventoryDashboard';
import {
  fetchWarehouses,
  fetchStockLevels,
  type ApiWarehouse,
  type StockLevelListResponse,
} from '../../../../services/api';
import { listPartners } from '../../../../services/orders';

interface ProductDetailPanelProps {
  product: Product | null;
  warehouseRefreshToken: number;
}

type MovementStatus = 'idle' | 'loading' | 'success' | 'error';

interface MovementState {
  status: MovementStatus;
  items: MovementSummary[];
  error?: string;
}

const formatCurrency = (value: number | null | undefined, currency?: string | null): string => {
  if (!Number.isFinite(value ?? NaN)) {
    return '데이터 없음';
  }

  const normalized = Number(value);
  const formatter = new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: currency?.trim() || 'KRW',
    currencyDisplay: 'symbol',
    maximumFractionDigits: 0,
  });

  return formatter.format(normalized);
};

const normalizeWarehouseCodeKey = (value: string) => value.trim().toUpperCase();

const WAREHOUSE_LABEL_OVERRIDES: Record<string, string> = {
  'WH-AUTO': '자동창고',
};

const RANGE_OPTIONS = [
  { label: '최근 7일', days: 7 },
  { label: '최근 30일', days: 30 },
  { label: '최근 90일', days: 90 },
  { label: '최근 1년', days: 365 },
] as const;

const AGGREGATION_OPTIONS = [
  { mode: 'raw', label: '전체' },
  { mode: 'day', label: '일' },
  { mode: 'week', label: '주' },
  { mode: 'month', label: '월' },
] as const;

type DateRange = { from: string; to: string };

type AggregationMode = (typeof AGGREGATION_OPTIONS)[number]['mode'];

type OverviewTrend = 'up' | 'down' | 'flat';

const TREND_STYLES: Record<OverviewTrend, { text: string; bg: string }> = {
  up: { text: 'text-emerald-700', bg: 'bg-emerald-50' },
  down: { text: 'text-rose-700', bg: 'bg-rose-50' },
  flat: { text: 'text-slate-600', bg: 'bg-slate-100' },
};

interface AnalysisState {
  status: MovementStatus;
  data?: InventoryAnalysisResponse;
  error?: string;
  mode?: AggregationMode;
}

interface OverviewDelta {
  deltaNet: number;
  deltaPct: number | null;
  trend: OverviewTrend;
}

interface AggregatedRow {
  key: string;
  label: string;
  inbound: number;
  outbound: number;
  adjustments: number;
  transfers: number;
  net: number;
}

interface BadgeContent {
  text: string;
  hint?: string;
  classes: string;
}

const toUtcDateOnly = (value: Date): Date =>
  new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));

const formatDateKey = (value: Date): string => value.toISOString().slice(0, 10);

const buildDateRange = (endDate: Date, days: number): DateRange => {
  const normalizedEnd = toUtcDateOnly(endDate);
  const start = new Date(normalizedEnd.getTime());
  start.setUTCDate(start.getUTCDate() - Math.max(0, days - 1));
  return {
    from: formatDateKey(start),
    to: formatDateKey(normalizedEnd),
  };
};

const buildPreviousRange = (range: DateRange, days: number): DateRange => {
  const boundary = new Date(`${range.from}T00:00:00.000Z`);
  boundary.setUTCDate(boundary.getUTCDate() - 1);
  return buildDateRange(boundary, days);
};

const ProductDetailPanel: React.FC<ProductDetailPanelProps> = ({ product, warehouseRefreshToken }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions'>('overview');
  const [movementState, setMovementState] = useState<MovementState>({ status: 'idle', items: [] });
  const [movementRequestId, setMovementRequestId] = useState(0);
  const lastSkuRef = useRef<string>();
  const [warehouseCatalog, setWarehouseCatalog] = useState<Record<string, ApiWarehouse>>({});
  const partnerLoadedRef = useRef(false);
  const warehouseCatalogRequestIdRef = useRef(0);
  const [partnerCatalog, setPartnerCatalog] = useState<Record<string, string>>({});
  const partnerRefreshInFlightRef = useRef(false);
  const [stockLevels, setStockLevels] = useState<StockLevelListResponse['items'] | null>(null);
  const stockLevelsRequestIdRef = useRef(0);
  const [selectedRangeDays, setSelectedRangeDays] = useState(30);
  const [aggregationMode, setAggregationMode] = useState<AggregationMode>('raw');
  const [analysisState, setAnalysisState] = useState<AnalysisState>({ status: 'idle' });
  const [overviewDelta, setOverviewDelta] = useState<OverviewDelta | null>(null);
  const [overviewDeltaStatus, setOverviewDeltaStatus] = useState<MovementStatus>('idle');
  const overviewDeltaRequestIdRef = useRef(0);
  const transactionRange = useMemo(() => buildDateRange(new Date(), selectedRangeDays), [selectedRangeDays]);
  const showAggregationControls = selectedRangeDays > 30;
  useEffect(() => {
    if (!showAggregationControls && aggregationMode !== 'raw') {
      setAggregationMode('raw');
    }
  }, [showAggregationControls, aggregationMode]);

  useEffect(() => {
    const sku = product?.sku?.trim();
    if (!sku) {
      lastSkuRef.current = undefined;
      setMovementState({ status: 'idle', items: [] });
      return;
    }

    const controller = new AbortController();
    const isSameSku = lastSkuRef.current === sku;
    let isCancelled = false;

    setMovementState((prev) => ({
      status: 'loading',
      items: isSameSku ? prev.items : [],
      error: undefined,
    }));

    listMovements({
      sku,
      limit: 50,
      signal: controller.signal,
      from: transactionRange.from,
      to: transactionRange.to,
    })
      .then((response) => {
        if (isCancelled) {
          return;
        }
        lastSkuRef.current = sku;
        setMovementState({ status: 'success', items: response.items });
      })
      .catch((error) => {
        if (isCancelled || controller.signal.aborted) {
          return;
        }

        lastSkuRef.current = sku;
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : '입출고 내역을 불러오지 못했습니다.';

        setMovementState((prev) => ({
          status: 'error',
          items: isSameSku ? prev.items : [],
          error: message,
        }));
      });

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [product?.sku, movementRequestId, transactionRange.from, transactionRange.to]);

  useEffect(() => {
    if (!product?.sku || aggregationMode === 'raw') {
      setAnalysisState({
        status: 'idle',
        mode: undefined,
        data: undefined,
        error: undefined,
      });
      return;
    }

    const controller = new AbortController();
    let isCancelled = false;
    const groupBy =
      aggregationMode === 'week' ? 'week' : aggregationMode === 'month' ? 'month' : undefined;

    setAnalysisState({
      status: 'loading',
      mode: aggregationMode,
      data: undefined,
      error: undefined,
    });

    fetchInventoryAnalysis(
      {
        from: transactionRange.from,
        to: transactionRange.to,
        sku: product.sku,
        groupBy,
      },
      { signal: controller.signal },
    )
      .then((response) => {
        if (isCancelled) {
          return;
        }
        setAnalysisState({
          status: 'success',
          mode: aggregationMode,
          data: response,
          error: undefined,
        });
      })
      .catch((error) => {
        if (isCancelled) {
          return;
        }
        const message =
          error instanceof Error && error.message.trim()
            ? error.message
            : '집계 데이터를 불러오지 못했습니다.';

        setAnalysisState({
          status: 'error',
          mode: aggregationMode,
          error: message,
          data: undefined,
        });
      });

    return () => {
      isCancelled = true;
      controller.abort();
    };
  }, [aggregationMode, product?.sku, transactionRange.from, transactionRange.to]);

  useEffect(() => {
    if (!product?.sku) {
      setOverviewDelta(null);
      setOverviewDeltaStatus('idle');
      return;
    }

    const currentRange = buildDateRange(new Date(), 30);
    const previousRange = buildPreviousRange(currentRange, 30);
    const requestId = ++overviewDeltaRequestIdRef.current;
    setOverviewDeltaStatus('loading');
    const controller = new AbortController();
    const signal = controller.signal;

    const buildNet = (totals: InventoryAnalysisResponse['totals']) =>
      totals.inbound - totals.outbound + totals.adjustments;

    Promise.all([
      fetchInventoryAnalysis({ from: currentRange.from, to: currentRange.to, sku: product.sku }, { signal }),
      fetchInventoryAnalysis(
        {
          from: previousRange.from,
          to: previousRange.to,
          sku: product.sku,
        },
        { signal },
      ),
    ])
      .then(([current, previous]) => {
        if (overviewDeltaRequestIdRef.current !== requestId) {
          return;
        }
        const currentNet = buildNet(current.totals);
        const previousNet = buildNet(previous.totals);
        const deltaNet = currentNet - previousNet;
        const deltaPct =
          previousNet === 0 ? null : (deltaNet / Math.abs(previousNet)) * 100;
        const trend: OverviewTrend =
          deltaNet > 0 ? 'up' : deltaNet < 0 ? 'down' : 'flat';

        setOverviewDelta({
          deltaNet,
          deltaPct,
          trend,
        });
        setOverviewDeltaStatus('success');
      })
      .catch((error) => {
        if (overviewDeltaRequestIdRef.current !== requestId) {
          return;
        }
        if (error instanceof Error && error.name === 'AbortError') {
          return;
        }
        console.error('[deepflow] Failed to resolve overview delta', error);
        setOverviewDelta(null);
        setOverviewDeltaStatus('error');
      });
    return () => {
      controller.abort();
    };
  }, [product?.sku]);

  useEffect(() => {
    if (partnerLoadedRef.current) {
      return;
    }

    partnerLoadedRef.current = true;
    let cancelled = false;

    listPartners({ includeSample: true })
      .then((partners) => {
        if (cancelled || !Array.isArray(partners)) {
          return;
        }

        setPartnerCatalog((prev) => {
          const next: Record<string, string> = { ...prev };
          partners.forEach((partner) => {
            if (partner?.id) {
              next[partner.id] = partner.name?.trim() || partner.id;
            }
          });
          return next;
        });
      })
      .catch((error) => {
        console.error('[deepflow] Failed to load partner names', error);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (partnerRefreshInFlightRef.current) {
      return;
    }
    const unknownPartners = movementState.items.reduce<Set<string>>((set, movement) => {
      const partnerId = movement.partnerId?.trim();
      if (partnerId && !partnerCatalog[partnerId]) {
        set.add(partnerId);
      }
      return set;
    }, new Set<string>());
    if (unknownPartners.size === 0) {
      return;
    }
    partnerRefreshInFlightRef.current = true;
    listPartners({ includeSample: true })
      .then((partners) => {
        setPartnerCatalog((prev) => {
          const next = { ...prev };
          partners.forEach((partner) => {
            if (partner?.id) {
              next[partner.id] = partner.name?.trim() || partner.id;
            }
          });
          return next;
        });
      })
      .catch((error) => {
        console.error('[deepflow] Failed to refresh partner names', error);
      })
      .finally(() => {
        partnerRefreshInFlightRef.current = false;
      });
  }, [movementState.items, partnerCatalog]);

  useEffect(() => {
    const requestId = ++warehouseCatalogRequestIdRef.current;
    let cancelled = false;

    fetchWarehouses()
      .then((response) => {
        if (cancelled || warehouseCatalogRequestIdRef.current !== requestId || !response?.items) {
          return;
        }
        setWarehouseCatalog(() => {
          const next: Record<string, ApiWarehouse> = {};
          response.items.forEach((warehouse) => {
            if (warehouse?.code) {
              next[warehouse.code] = warehouse;
            }
          });
          return next;
        });
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        console.error('[deepflow] Failed to load warehouse catalog', error);
      });

    return () => {
      cancelled = true;
    };
  }, [warehouseRefreshToken]);

  useEffect(() => {
    const legacyId = Number.isFinite(product?.legacyProductId)
      ? Number(product?.legacyProductId)
      : null;
    if (!legacyId) {
      setStockLevels(null);
      return;
    }
    const requestId = ++stockLevelsRequestIdRef.current;
    let cancelled = false;
    fetchStockLevels({ productId: legacyId })
      .then((response) => {
        if (cancelled || stockLevelsRequestIdRef.current !== requestId) {
          return;
        }
        const items = Array.isArray(response?.items) ? response.items : [];
        setStockLevels(items);
        if (items.length > 0) {
          setWarehouseCatalog((prev) => {
            const next = { ...prev };
            items.forEach((item) => {
              const warehouse = item.location?.warehouse;
              if (warehouse?.code) {
                next[warehouse.code] = warehouse;
              }
            });
            return next;
          });
        }
      })
      .catch((error) => {
        console.error('[deepflow] Failed to load stock levels', error);
        if (!cancelled) {
          setStockLevels(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [product?.legacyProductId]);

  const resolveWarehouseLabel = useCallback(
    (warehouseCode?: string | null) => {
      const normalized = warehouseCode?.trim();
      if (!normalized) {
        return undefined;
      }

      const normalizedKey = normalizeWarehouseCodeKey(normalized);
      const overrideLabel = WAREHOUSE_LABEL_OVERRIDES[normalizedKey];
      if (overrideLabel) {
        return overrideLabel;
      }

      const warehouseRecord = warehouseCatalog[normalized] ?? warehouseCatalog[normalizedKey];
      return warehouseRecord?.name?.trim() || normalized;
    },
    [warehouseCatalog],
  );

  const resolveLocationLabel = useCallback(
    (location?: MovementSummary['from'] | MovementSummary['to'] | null) => {
      if (!location?.warehouseCode) {
        return undefined;
      }
      return resolveWarehouseLabel(location.warehouseCode);
    },
    [resolveWarehouseLabel],
  );

  const resolvePartnerLabel = useCallback(
    (partnerId?: string | null) => {
      if (!partnerId) {
        return '거래처 정보 없음';
      }

      const name = partnerCatalog[partnerId];
      if (name) {
        return name;
      }

      return '미등록 거래처';
    },
    [partnerCatalog],
  );

  const inventoryEntries = useMemo(() => {
    const warehouseMap = new Map<
      string,
      { warehouseCode: string; onHand: number; reserved: number }
    >();

    const addEntry = (warehouseCode: string, onHand: number, reserved: number) => {
      if (!warehouseCode) {
        return;
      }
      const existing = warehouseMap.get(warehouseCode);
      if (existing) {
        existing.onHand += onHand;
        existing.reserved += reserved;
      } else {
        warehouseMap.set(warehouseCode, { warehouseCode, onHand, reserved });
      }
    };

    if (stockLevels && stockLevels.length > 0) {
      stockLevels.forEach((item) => {
        const warehouseCode =
          item.location?.warehouseCode ?? item.location?.warehouse?.code ?? '';
        addEntry(warehouseCode, item.quantity ?? 0, 0);
      });
    } else if (product?.inventory && product.inventory.length > 0) {
      product.inventory.forEach((entry) => {
        const warehouseCode = entry.warehouseCode?.trim() ?? '';
        addEntry(warehouseCode, entry.onHand ?? 0, entry.reserved ?? 0);
      });
    }

    return Array.from(warehouseMap.values()).map((entry) => ({
      key: entry.warehouseCode,
      label: resolveWarehouseLabel(entry.warehouseCode),
      onHand: entry.onHand,
      reserved: entry.reserved,
    }));
  }, [product?.inventory, resolveWarehouseLabel, stockLevels]);

  const totalInventory = useMemo(() => {
    const onHand = Number.isFinite(product?.onHand ?? NaN) ? Number(product?.onHand) : 0;
    const reserved = Number.isFinite(product?.reserved ?? NaN) ? Number(product?.reserved) : 0;
    const available = Math.max(0, onHand - reserved);

    return {
      onHand,
      reserved,
      available,
    };
  }, [product?.onHand, product?.reserved]);

  const unitLabel = useMemo(() => {
    const normalized = product?.unit?.trim();
    return (normalized ? normalized.toUpperCase() : DEFAULT_UNIT).replace(/\s+/g, ' ');
  }, [product?.unit]);

  const movementRows = useMemo(() => {
    if (movementState.items.length === 0) {
      return [];
    }

    return [...movementState.items].sort((a, b) => {
      const aTime = Date.parse(a.occurredAt);
      const bTime = Date.parse(b.occurredAt);
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
        return bTime - aTime;
      }
      return 0;
    });
  }, [movementState.items]);

  const aggregatedRows = useMemo<AggregatedRow[]>(() => {
    if (
      aggregationMode === 'raw' ||
      analysisState.status !== 'success' ||
      analysisState.mode !== aggregationMode ||
      !analysisState.data
    ) {
      return [];
    }

    if (aggregationMode === 'day') {
      const baseRows = analysisState.data.movementSeries.map((point) => {
        const net = point.inbound - point.outbound + point.adjustments;
        return {
          key: `day-${point.date}`,
          label: point.date,
          inbound: point.inbound,
          outbound: point.outbound,
          adjustments: point.adjustments,
          transfers: point.transfers,
          net,
        };
      });
      return baseRows.slice().reverse();
    }

    const rows = (analysisState.data.periodSeries ?? []).map((period) => ({
      key: `${aggregationMode}-${period.periodStart}`,
      label: period.label,
      inbound: period.inbound,
      outbound: period.outbound,
      adjustments: period.adjustments,
      transfers: period.transfers,
      net: period.net,
    }));

    return rows.slice().reverse();
  }, [aggregationMode, analysisState]);

  const deltaBadgeContent = useMemo<BadgeContent>(() => {
    if (overviewDeltaStatus === 'loading') {
      return {
        text: '계산 중...',
        classes: 'text-slate-500 bg-slate-50 border border-slate-200',
      };
    }

    if (overviewDeltaStatus === 'error' || !overviewDelta) {
      return {
        text: '이전 30일 대비 정보 없음',
        classes: 'text-slate-500 bg-slate-50 border border-slate-200',
      };
    }

    const arrow = overviewDelta.trend === 'up' ? '↑' : overviewDelta.trend === 'down' ? '↓' : '→';
    const percentLabel =
      overviewDelta.deltaPct === null
        ? overviewDelta.deltaNet === 0
          ? '0%'
          : '신규'
        : `${Math.abs(overviewDelta.deltaPct).toFixed(1)}%`;
    const valueLabel = `${overviewDelta.deltaNet >= 0 ? '+' : ''}${overviewDelta.deltaNet.toLocaleString()} ${unitLabel}`;
    const { text, bg } = TREND_STYLES[overviewDelta.trend];

    return {
      text: `${arrow} ${percentLabel}`,
      hint: valueLabel,
      classes: `${text} ${bg} border border-slate-200`,
    };
  }, [overviewDelta, overviewDeltaStatus, unitLabel]);

  const latestReceipt = useMemo(
    () => movementRows.find((movement) => movement.type === 'RECEIPT'),
    [movementRows],
  );

  const latestIssue = useMemo(
    () => movementRows.find((movement) => movement.type === 'ISSUE'),
    [movementRows],
  );

  const movementDateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
    [],
  );

  const movementTypeLabel: Record<MovementType, string> = useMemo(
    () => ({
      RECEIPT: '입고',
      ISSUE: '출고',
      ADJUST: '조정',
      TRANSFER: '이동',
      RETURN: '반품',
    }),
    [],
  );

  const movementQuantityClass: Record<MovementType, string> = useMemo(
    () => ({
      RECEIPT: 'text-emerald-600',
      ISSUE: 'text-rose-600',
      ADJUST: 'text-slate-600',
      TRANSFER: 'text-indigo-600',
      RETURN: 'text-emerald-600',
    }),
    [],
  );

  const describeMovementLocation = (movement: MovementSummary) => {
    const partnerLabel = resolvePartnerLabel(movement.partnerId);
    const fromLabel = resolveLocationLabel(movement.from);
    const toLabel = resolveLocationLabel(movement.to);

    const defaultLabel = movement.type === 'ISSUE' ? '출고 창고 미지정' : '입고 창고 미지정';

    if (movement.type === 'TRANSFER') {
      return {
        partnerLabel,
        locationLabel: `${fromLabel ?? '미지정 창고'} → ${toLabel ?? '미지정 창고'}`,
      };
    }

    if (movement.type === 'ISSUE') {
      return {
        partnerLabel,
        locationLabel: fromLabel ?? defaultLabel,
      };
    }

    return {
      partnerLabel,
      locationLabel: toLabel ?? defaultLabel,
    };
  };

  const handleRetryMovements = () => {
    if (!product?.sku) {
      return;
    }
    setMovementRequestId((id) => id + 1);
  };

  const movementStatus = movementState.status;
  const isLoadingMovements = movementStatus === 'loading';
  const hasMovementData = movementRows.length > 0;
  const hasRecentSummary = Boolean(latestReceipt || latestIssue);

  if (!product) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">
        품목을 선택하면 상세가 표시됩니다.
      </div>
    );
  }

  const currency = product.currency ?? undefined;

  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-200">
      <div className="border-b border-slate-200 p-4">
        <div className="text-xs font-semibold text-indigo-600">SKU {product.sku}</div>
        <h4 className="mt-1 text-lg font-semibold text-slate-900">{product.name}</h4>
        {product.brand && <p className="mt-1 text-xs text-slate-500">{product.brand}</p>}
      </div>

      <div className="flex items-center gap-2 border-b border-slate-200 px-4 pt-3">
        <button
          type="button"
          className={`rounded-t-lg px-3 py-2 text-sm font-medium ${
            activeTab === 'overview' ? 'border-b-2 border-indigo-500 text-indigo-600' : 'text-slate-500'
          }`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          className={`rounded-t-lg px-3 py-2 text-sm font-medium ${
            activeTab === 'transactions' ? 'border-b-2 border-indigo-500 text-indigo-600' : 'text-slate-500'
          }`}
          onClick={() => setActiveTab('transactions')}
        >
          Transactions
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'overview' ? (
          <div className="space-y-4 text-sm text-slate-600">
            <section>
              <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">재고 요약</h5>
              <div className="mt-1 grid gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">가용 재고</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {totalInventory.available.toLocaleString()} {unitLabel}
                  </div>
                  <div className="text-[11px] text-slate-400">총 재고에서 예약 수량을 제외한 값</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">총 재고</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {totalInventory.onHand.toLocaleString()} {unitLabel}
                  </div>
                  <div className="text-[11px] text-slate-400">시스템 상 재고 수량</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">예약 수량</div>
                  <div className="mt-1 text-lg font-semibold text-slate-900">
                    {totalInventory.reserved.toLocaleString()} {unitLabel}
                  </div>
                  <div className="text-[11px] text-slate-400">출고 예약 또는 홀딩 수량</div>
                </div>
              </div>
            </section>

            <section>
              <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">카테고리</h5>
              <div className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="font-medium text-slate-900">{product.category || '미분류'}</div>
                <div className="text-xs text-slate-500">{product.subCategory || '세부 카테고리 없음'}</div>
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between gap-2">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">최근 입출고 요약</h5>
                <div className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${deltaBadgeContent.classes}`}>
                  <span>{deltaBadgeContent.text}</span>
                  {deltaBadgeContent.hint && (
                    <span className="text-[10px] font-normal text-slate-500">{deltaBadgeContent.hint}</span>
                  )}
                </div>
              </div>
              <div className="mt-1 rounded-xl border border-slate-200 bg-white px-3 py-3">
                {hasRecentSummary ? (
                  <div className="grid gap-3">
                    {latestReceipt && (
                      <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">최근 입고</div>
                          <div className="mt-1 text-sm font-medium text-slate-900">
                            {movementDateFormatter.format(new Date(latestReceipt.occurredAt))}
                          </div>
                          <div className="text-xs text-slate-500">{resolvePartnerLabel(latestReceipt.partnerId)}</div>
                        </div>
                          <div className="text-right text-sm font-semibold text-emerald-600">
                            +{latestReceipt.qty.toLocaleString()} {unitLabel}
                        </div>
                      </div>
                    )}
                    {latestIssue && (
                      <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
                        <div>
                          <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-600">최근 출고</div>
                          <div className="mt-1 text-sm font-medium text-slate-900">
                            {movementDateFormatter.format(new Date(latestIssue.occurredAt))}
                          </div>
                          <div className="text-xs text-slate-500">{resolvePartnerLabel(latestIssue.partnerId)}</div>
                        </div>
                          <div className="text-right text-sm font-semibold text-rose-600">
                            -{latestIssue.qty.toLocaleString()} {unitLabel}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-slate-400">최근 입출고 데이터가 없습니다.</div>
                )}
              </div>
            </section>

            <section>
              <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">구매가 / 판매가</h5>
              <div className="mt-1 grid gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">구매가</span>
                  <span className="font-medium text-slate-900">{formatCurrency(product.supplyPrice, currency)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">판매가</span>
                  <span className="font-medium text-slate-900">{formatCurrency(product.salePrice, currency)}</span>
                </div>
              </div>
            </section>

            <section>
              <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">위치별 재고</h5>
              <div className="mt-1 space-y-2">
                {inventoryEntries.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-xs text-slate-400">
                    등록된 창고 재고 정보가 없습니다.
                  </div>
                ) : (
                  inventoryEntries.map((entry) => (
                    <div key={entry.key} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                      <div className="text-xs font-semibold text-slate-500">{entry.label}</div>
                      <div className="mt-1 flex items-center justify-between text-sm">
                        <span className="text-slate-600">가용 재고</span>
                        <span className="font-semibold text-slate-900">{(entry.onHand - entry.reserved).toLocaleString()}</span>
                      </div>
                      <div className="mt-0.5 grid grid-cols-2 gap-1 text-[11px] text-slate-500">
                        <span>재고 {entry.onHand.toLocaleString()}</span>
                        <span className="text-right">예약 {entry.reserved.toLocaleString()}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        ) : (
          <div className="space-y-3">
            <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-500">최근 입출고 내역</h5>
            <div className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-200 px-4 py-3 text-xs text-slate-500">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-2">
                    {RANGE_OPTIONS.map((option) => (
                      <button
                        key={option.days}
                        type="button"
                        onClick={() => option.days !== selectedRangeDays && setSelectedRangeDays(option.days)}
                        className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                          selectedRangeDays === option.days
                            ? 'border border-indigo-300 bg-indigo-50 text-indigo-600'
                            : 'border border-slate-200 bg-white text-slate-500'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {showAggregationControls && (
                    <div className="flex items-center gap-2 text-[11px] font-semibold text-slate-500">
                      <span>집계 보기</span>
                      <div className="flex gap-1">
                        {AGGREGATION_OPTIONS.map((option) => (
                          <button
                            key={option.mode}
                            type="button"
                            aria-pressed={aggregationMode === option.mode}
                            onClick={() => setAggregationMode(option.mode)}
                            className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                              aggregationMode === option.mode
                                ? 'border border-indigo-200 bg-indigo-50 text-indigo-600'
                                : 'border border-slate-200 bg-white text-slate-500'
                            }`}
                          >
                            {option.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-xs text-slate-500">
                <span>
                  {isLoadingMovements
                    ? '입출고 내역을 불러오는 중...'
                    : hasMovementData
                      ? `총 ${movementRows.length.toLocaleString()}건`
                      : '데이터가 없습니다.'}
                </span>
                {movementStatus === 'error' && (
                  <button
                    type="button"
                    onClick={handleRetryMovements}
                    className="rounded-md border border-slate-300 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-400 hover:text-slate-800"
                  >
                    다시 시도
                  </button>
                )}
              </div>

              {aggregationMode === 'raw' ? (
                <>
                  {movementStatus === 'error' && !hasMovementData ? (
                    <div className="px-4 py-10 text-center text-sm text-rose-600">
                      {movementState.error ?? '입출고 내역을 불러오는 중 오류가 발생했습니다.'}
                    </div>
                  ) : hasMovementData ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">날짜</th>
                            <th className="px-4 py-3 text-left font-medium">구분</th>
                            <th className="px-4 py-3 text-right font-medium">수량</th>
                            <th className="px-4 py-3 text-left font-medium">거래처 · 창고</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-slate-600">
                          {movementRows.map((movement) => {
                            const { partnerLabel, locationLabel } = describeMovementLocation(movement);
                            return (
                              <tr key={movement.id} className="align-top">
                                <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                                  {movementDateFormatter.format(new Date(movement.occurredAt))}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-slate-700">
                                  {movementTypeLabel[movement.type]}
                                </td>
                                <td
                                  className={`whitespace-nowrap px-4 py-3 text-right text-sm font-semibold ${
                                    movementQuantityClass[movement.type]
                                  }`}
                                >
                                  {movement.type === 'ISSUE' ? '-' : movement.type === 'RECEIPT' ? '+' : ''}
                                  {movement.qty.toLocaleString()} {unitLabel}
                                </td>
                                <td className="px-4 py-3">
                                  <div className="text-sm font-medium text-slate-700">{partnerLabel}</div>
                                  <div className="text-xs text-slate-500">{locationLabel}</div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="px-4 py-10 text-center text-sm text-slate-400">
                      입출고 내역 데이터가 없습니다.
                    </div>
                  )}

                  {isLoadingMovements && hasMovementData && (
                    <div className="border-t border-slate-200 px-4 py-3 text-center text-xs text-slate-500">
                      최신 데이터를 불러오는 중입니다...
                    </div>
                  )}
                </>
              ) : (
                <div className="px-4 py-4">
                  {analysisState.status === 'error' ? (
                    <p className="text-xs text-rose-600">
                      {analysisState.error ?? '집계 데이터를 불러오는 중 오류가 발생했습니다.'}
                    </p>
                  ) : analysisState.status === 'loading' || analysisState.status === 'idle' ? (
                    <p className="text-xs text-slate-500">집계 데이터를 불러오는 중입니다...</p>
                  ) : aggregatedRows.length === 0 ? (
                    <p className="text-xs text-slate-400">해당 기간의 집계 데이터가 없습니다.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">기간</th>
                            <th className="px-4 py-3 text-right font-medium">입고</th>
                            <th className="px-4 py-3 text-right font-medium">출고</th>
                            <th className="px-4 py-3 text-right font-medium">이동</th>
                            <th className="px-4 py-3 text-right font-medium">순이동</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 text-slate-600">
                          {aggregatedRows.map((row) => (
                            <tr key={row.key}>
                              <td className="px-4 py-3 font-medium text-slate-700">{row.label}</td>
                              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-emerald-600">
                                {row.inbound.toLocaleString()}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-rose-600">
                                {row.outbound.toLocaleString()}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">
                                {row.transfers.toLocaleString()}
                              </td>
                              <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-indigo-600">
                                {row.net >= 0 ? '+' : ''}
                                {row.net.toLocaleString()} {unitLabel}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ProductDetailPanel;
