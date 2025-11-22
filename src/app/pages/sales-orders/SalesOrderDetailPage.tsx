import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listPartners, type Partner } from '../../../services/orders';
import {
  listMovements,
  submitMovement,
  type CreateMovementPayload,
  type MovementSummary,
} from '../../../services/movements';
import SelectDropdown from '../../../components/common/SelectDropdown';
import type { ComboboxOption } from '../../../components/common/Combobox';
import { fetchWarehouses, type ApiWarehouse } from '../../../services/api';
import { formatKstDateLabelFromUtc, formatKstDateTimeLabelFromUtc } from '@/shared/datetime/kst';
import { formatCurrency } from '@/src/utils/format';
import Modal from '@/components/ui/Modal';
import AmountSummaryCard from '@/src/app/components/AmountSummaryCard';
import DocumentShareCard from '@/src/app/components/DocumentShareCard';
import { primaryActionButtonClass, secondaryActionButtonClass } from '@/src/app/components/buttonVariants';
import type { MonetaryBreakdownEntry, MonetarySummary } from '@/app/types/monetary';
import { getSalesOrder, type SalesOrder } from '../../../services/salesOrders';
import { useToast } from '@/src/components/Toaster';
import { getSalesStatusBadgeClass, getSalesStatusRingClass } from '@/app/utils/orderStatusBadge';
import { getSalesStatusLabel } from '@/app/utils/salesStatus';
import { readOrderWarehouse } from '@/src/utils/orderWarehouse';
import type { OrderWarehouseRecord } from '@/src/utils/orderWarehouse';

const SHIPMENT_MOVEMENT_USER_ID = 'sales-order-ui';
type TabKey = 'items' | 'shipments';

const formatDateLabel = (value?: string | null) => {
  if (!value) return '—';
  return formatKstDateTimeLabelFromUtc(value) ?? value;
};

const formatExpectedDateLabel = (value?: string | null) => {
  if (!value) return '—';
  return formatKstDateLabelFromUtc(value) ?? value;
};

const formatNumber = (value: number | undefined | null) => {
  if (value === undefined || value === null) return '0';
  return value.toLocaleString('ko-KR');
};

const parseNumericValue = (value: number | string | undefined | null): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const round = (value: number) => Math.round(Number.isFinite(value) ? value : 0);

const formatCurrencyValue = (value: number | undefined | null): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return formatCurrency(value);
};

const getLineUnitLabel = (line: SalesOrder['lines'][number]) => line.unit?.trim() || 'EA';

const formatProductDisplayTitle = (line: SalesOrder['lines'][number]) => {
  const productName = line.productName?.trim();
  if (productName) {
    return `${productName} (${line.sku})`;
  }
  return line.sku;
};

const formatLineNameWithSku = (line: SalesOrder['lines'][number]) => {
  const productName = line.productName?.trim();
  if (productName) {
    return `${productName} (${line.sku})`;
  }
  return line.sku;
};

const parseTaxMeta = (label: string | undefined | null): {
  name: string;
  rate: number | null;
  mode: 'inclusive' | 'exclusive' | 'unknown';
} => {
  if (!label) {
    return { name: '부가세', rate: null, mode: 'unknown' };
  }
  const name = label.replace(/\(.+\)\s*$/, '').trim() || '부가세';
  const percentMatch = label.match(/(\d+(?:\.\d+)?)%/);
  const rate = percentMatch ? Number(percentMatch[1]) / 100 : null;
  const inclusive = /(포함|inclusive)/i.test(label);
  const exclusive = /(별도|exclusive)/i.test(label);
  const mode: 'inclusive' | 'exclusive' | 'unknown' = inclusive ? 'inclusive' : exclusive ? 'exclusive' : 'unknown';
  return { name, rate, mode };
};

const formatLocalDateTimeInput = (value: Date): string => {
  const pad = (input: number) => String(input).padStart(2, '0');
  const year = value.getFullYear();
  const month = pad(value.getMonth() + 1);
  const day = pad(value.getDate());
  const hours = pad(value.getHours());
  const minutes = pad(value.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const formInputClass =
  'w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none';
const inlineLabelClass = 'mb-1 flex items-center text-xs font-semibold text-slate-600';
const blockLabelClass = 'mb-1 block text-xs font-semibold text-slate-600';
const infoBoxClass = 'rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500';
const cancelButtonClass =
  'rounded-full border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50';
const confirmButtonClass =
  'flex items-center justify-center rounded-full bg-indigo-600 px-4 py-2 text-xs font-medium text-white transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-indigo-300';

const parseLocalDateTimeIso = (value?: string): string | null => {
  if (!value) {
    return null;
  }
  const candidate = new Date(value);
  if (Number.isNaN(candidate.getTime())) {
    return null;
  }
  return candidate.toISOString();
};

const SalesOrderDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [order, setOrder] = useState<SalesOrder | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('items');
  const [shipmentMode, setShipmentMode] = useState<'bulk' | 'partial'>('bulk');
  const [shipmentWarehouse, setShipmentWarehouse] = useState('');
  const [persistedWarehouse, setPersistedWarehouse] = useState<OrderWarehouseRecord | null>(null);
  const [shipmentDate, setShipmentDate] = useState('');
  const [shipmentNote, setShipmentNote] = useState('');
  const [partialQuantities, setPartialQuantities] = useState<Record<string, string>>({});
  const [shipmentError, setShipmentError] = useState<string | null>(null);
  const [shipmentProcessing, setShipmentProcessing] = useState(false);
  const [movements, setMovements] = useState<MovementSummary[]>([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementError, setMovementError] = useState<string | null>(null);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
  const shipmentWarehouseOptions = useMemo<ComboboxOption[]>(() => {
    return warehouses.map((warehouse) => ({
      value: warehouse.code,
      label: warehouse.name ? `${warehouse.name} (${warehouse.code})` : warehouse.code,
    }));
  }, [warehouses]);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [receiverContactName, setReceiverContactName] = useState('');
  const [receiverPhone, setReceiverPhone] = useState('');
  const [receiverMemo, setReceiverMemo] = useState('');
  const showToast = useToast();

  const loadOrder = useCallback(async () => {
    if (!id) {
      setError('유효한 주문번호가 필요합니다.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await getSalesOrder(id);
      setOrder(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '주문을 불러올 수 없습니다.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  const loadPartners = useCallback(async () => {
    try {
      const items = await listPartners({ type: 'CUSTOMER' });
      setPartners(items);
    } catch (err) {
      console.error('[SalesOrderDetailPage] partners', err);
    }
  }, []);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  const fetchMovements = useCallback(async () => {
    if (!order) {
      return;
    }
    setMovementLoading(true);
    setMovementError(null);
    try {
      const { items } = await listMovements({
        refNo: order.id,
        type: 'ISSUE',
        limit: 20,
      });
      setMovements(items);
    } catch (err) {
      setMovementError(err instanceof Error ? err.message : '출고 내역을 불러올 수 없습니다.');
    } finally {
      setMovementLoading(false);
    }
  }, [order]);

  useEffect(() => {
    void fetchMovements();
  }, [fetchMovements]);

  const loadWarehouses = useCallback(async () => {
    setWarehouseLoading(true);
    setWarehouseError(null);
    try {
      const response = await fetchWarehouses({ pageSize: 100 });
      setWarehouses(response.items ?? []);
    } catch (err) {
      setWarehouseError('창고 목록을 불러오지 못했습니다.');
    } finally {
      setWarehouseLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWarehouses();
  }, [loadWarehouses]);

  useEffect(() => {
    if (!order) {
      return;
    }
    setReceiverMemo(order.memo ?? '');
  }, [order?.memo]);

  const totalOrdered = useMemo(() => {
    if (!order) {
      return 0;
    }
    return order.lines.reduce((sum, line) => sum + line.orderedQty, 0);
  }, [order]);

  const totalShipped = useMemo(() => {
    if (!order) {
      return 0;
    }
    return order.lines.reduce((sum, line) => sum + line.shippedQty, 0);
  }, [order]);

  const isReadyForShipment = useMemo(() => {
    return totalOrdered > totalShipped && order?.status !== 'canceled';
  }, [order, totalOrdered, totalShipped]);

  const monetary = useMemo<MonetarySummary>(() => {
    if (!order) {
      return { lineTotal: 0, baseTotal: 0, taxTotal: 0, total: 0, breakdown: [] };
    }
    const acc = {
      lineTotal: 0,
      baseTotal: 0,
      taxTotal: 0,
      total: 0,
      map: new Map<string, MonetaryBreakdownEntry>(),
    };
    order.lines.forEach((line) => {
      const grossValue = parseNumericValue(line.amount) ?? Math.round((line.unitPrice ?? 0) * line.orderedQty);
      const gross = round(grossValue);
      const explicitTax = parseNumericValue(line.taxAmount);
      const taxMeta = parseTaxMeta(line.taxLabel);
      let tax = 0;
      let base = gross;
      if (explicitTax !== null) {
        tax = round(explicitTax);
        base = Math.max(0, gross - tax);
      } else if (taxMeta.rate !== null) {
        if (taxMeta.mode === 'inclusive') {
          const computedBase = round(gross / (1 + taxMeta.rate));
          base = computedBase;
          tax = round(Math.max(0, gross - computedBase));
        } else if (taxMeta.mode === 'exclusive') {
          base = round(gross);
          tax = round(gross * taxMeta.rate);
        }
      }
      const total = base + tax;
      acc.lineTotal += gross;
      acc.baseTotal += base;
      acc.taxTotal += tax;
      acc.total += total;
      const key = line.taxLabel || taxMeta.name;
      const existing = acc.map.get(key);
      if (existing) {
        existing.base += base;
        existing.amount += tax;
      } else {
        acc.map.set(key, { key, name: taxMeta.name, rate: taxMeta.rate, mode: taxMeta.mode, base, amount: tax });
      }
    });
    return {
      lineTotal: acc.lineTotal,
      baseTotal: acc.baseTotal,
      taxTotal: acc.taxTotal,
      total: acc.total,
      breakdown: Array.from(acc.map.values()),
    };
  }, [order]);

  const customerPartner = useMemo(() => partners.find((entry) => entry.id === order?.customerId), [order?.customerId, partners]);

  const parsePartialQuantity = useCallback(
    (lineId: string, max: number) => {
      const raw = partialQuantities[lineId];
      if (!raw) {
        return 0;
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return 0;
      }
      return Math.min(Math.max(0, Math.round(parsed)), max);
    },
    [partialQuantities],
  );

  const closeShipmentModal = useCallback(() => {
    setShipmentModalOpen(false);
    setShipmentWarehouse('');
    setShipmentLocation('');
    setShipmentDate('');
    setShipmentNote('');
    setPartialQuantities({});
    setShipmentError(null);
    setPersistedWarehouse(null);
    setWarehouseError(null);
  }, []);

  const openShipmentModal = useCallback(
    (mode: 'bulk' | 'partial') => {
      if (mode === 'partial' && order) {
        const defaults: Record<string, string> = {};
        order.lines.forEach((line) => {
          const remaining = Math.max(0, line.orderedQty - line.shippedQty);
          if (remaining > 0) {
            defaults[line.id] = String(remaining);
          }
        });
        setPartialQuantities(defaults);
      } else {
        setPartialQuantities({});
      }
      setShipmentMode(mode);
      const storedWarehouse = order?.id ? readOrderWarehouse(order.id) : null;
      if (storedWarehouse?.code) {
        setShipmentWarehouse(storedWarehouse.code);
        setPersistedWarehouse(storedWarehouse);
      } else {
        setShipmentWarehouse('');
        setPersistedWarehouse(null);
      }
      setWarehouseError(null);
      setShipmentModalOpen(true);
      setShipmentDate(formatLocalDateTimeInput(new Date()));
      setShipmentError(null);
    },
    [order],
  );

  const handleBulkShipment = useCallback(() => {
    openShipmentModal('bulk');
  }, [openShipmentModal]);

  const handlePartialShipment = useCallback(() => {
    openShipmentModal('partial');
  }, [openShipmentModal]);

  const handleShipment = useCallback(async () => {
    if (!order) {
      return;
    }
    const warehouseCode = shipmentWarehouse.trim();
    if (!warehouseCode) {
      setShipmentError('출고 창고를 선택해 주세요.');
      return;
    }
    const occurredAt = shipmentDate ? new Date(shipmentDate).toISOString() : new Date().toISOString();
    const memo = shipmentNote.trim() || undefined;
    const quantityForLine = (lineId: string, remaining: number) => {
      if (shipmentMode === 'bulk') {
        return remaining;
      }
      return parsePartialQuantity(lineId, remaining);
    };

    const payloads: CreateMovementPayload[] = [];
    order.lines.forEach((line) => {
      const remaining = Math.max(0, line.orderedQty - line.shippedQty);
      const qty = quantityForLine(line.id, remaining);
      if (qty <= 0) {
        return;
      }
      payloads.push({
        type: 'ISSUE',
        sku: line.sku,
        qty,
        fromWarehouse: warehouseCode,
        partnerId: order.customerId,
        refNo: order.id,
        memo,
        occurredAt,
        userId: SHIPMENT_MOVEMENT_USER_ID,
        soId: order.id,
        soLineId: line.id,
      });
    });

    if (!payloads.length) {
      setShipmentError('출고할 품목과 수량을 선택해 주세요.');
      return;
    }

    setShipmentProcessing(true);
    setShipmentError(null);
    try {
      await Promise.all(payloads.map((payload) => submitMovement(payload)));
      setShipmentModalOpen(false);
      setShipmentDate('');
      setShipmentNote('');
      setPartialQuantities({});
      setShipmentWarehouse('');
      await loadOrder();
      await fetchMovements();
      showToast('출고가 등록되었습니다.', { tone: 'success' });
    } catch (err) {
      setShipmentError(err instanceof Error ? err.message : '출고 등록에 실패했습니다.');
    } finally {
      setShipmentProcessing(false);
    }
  }, [fetchMovements, loadOrder, order, partialQuantities, shipmentMode, shipmentNote, shipmentWarehouse, shipmentDate, showToast]);

  const handlePrint = useCallback(() => {
    setPrintModalOpen(true);
  }, []);

  const handleClosePrintModal = useCallback(() => {
    setPrintModalOpen(false);
  }, []);

  const handleConfirmPrint = useCallback(() => {
    setPrintModalOpen(false);
    setTimeout(() => {
      if (typeof window === 'undefined') {
        return;
      }
      window.print();
    }, 0);
  }, []);

  const handleExport = useCallback(() => {
    if (!order) {
      return;
    }
    const header = ['SKU', '요청 수량', '출고 수량', '단위', '상태'];
    const rows = order.lines.map((line) => [
      line.sku,
      line.orderedQty.toString(),
      line.shippedQty.toString(),
      line.unit ?? 'EA',
      line.status,
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((value) => `"${value?.toString().replace(/"/g, '""') ?? ''}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${order.orderNumber || order.id}-lines.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [order]);

  if (loading) {
    return <p className="p-6 text-sm text-slate-500">불러오는 중…</p>;
  }

  if (error || !order) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-rose-500">{error || '주문 정보를 불러올 수 없습니다.'}</p>
      </div>
    );
  }


  const customerName = customerPartner?.name ?? order.customerName ?? order.customerId;
  const isPrintDisabled = !order;
  const isExportDisabled = !order;
  const totalLines = order.lines.length;
  const salesStatusBadgeClass = getSalesStatusBadgeClass(order.status);
  const salesStatusRingClass = getSalesStatusRingClass(order.status);
  const warehouseSelectPlaceholder = warehouseLoading ? '창고 불러오는 중…' : '창고를 선택해 주세요';
  const persistedWarehouseLabel = persistedWarehouse
    ? persistedWarehouse.name?.trim() || persistedWarehouse.code
    : '';
  return (
    <>
      <div className="min-h-screen bg-slate-50 px-8 py-8 text-slate-900 print:hidden">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">판매주문 내역</p>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{(order.orderNumber ?? order.id).toUpperCase()}</h1>
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${salesStatusBadgeClass} ${salesStatusRingClass}`}
              >
                {getSalesStatusLabel(order.status)}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-500">
                {totalLines}개 품목 · 총 수량 {formatNumber(totalOrdered)} EA
              </span>
            </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                <div>
                  주문일 <span className="font-medium text-slate-700">{formatDateLabel(order.createdAt)}</span>
                </div>
                <div className="h-3 w-px bg-slate-200" />
                <div>
                  출고 예정일{' '}
                  <span className="font-medium text-slate-700">{formatExpectedDateLabel(order.promisedDate)}</span>
                </div>
              <div className="h-3 w-px bg-slate-200" />
              <div>
                고객 <span className="font-medium text-slate-700">{customerName}</span>
              </div>
              <div className="h-3 w-px bg-slate-200" />
              <div>
                메모 <span className="font-normal text-slate-400">{order.memo || '내부 메모 없음'}</span>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleBulkShipment}
              disabled={!isReadyForShipment}
              className={`${primaryActionButtonClass} justify-center`}
            >
              일괄출고
            </button>
            <button
              type="button"
              onClick={handlePartialShipment}
              disabled={!isReadyForShipment}
              className={`${secondaryActionButtonClass} justify-center`}
            >
              부분출고
            </button>
          </div>
        </div>

        <div className="grid grid-cols-[minmax(0,2.3fr)_minmax(0,1fr)] gap-6">
          <div className="space-y-6">
            <section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-slate-900">주문 기본 정보</h2>
              </div>
              <div className="grid grid-cols-3 gap-y-3 text-xs text-slate-500">
                <div className="space-y-1">
                  <div className="text-[11px]">주문 코드</div>
                  <div className="font-medium text-slate-800">{order.orderNumber ?? order.id}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px]">고객</div>
                  <div className="font-medium text-slate-800">{customerName}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px]">주문 상태</div>
                  <div className="font-medium text-slate-800">{getSalesStatusLabel(order.status)}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[11px]">주문일</div>
                  <div className="text-slate-800">{formatDateLabel(order.createdAt)}</div>
                </div>
                <div className="space-y-1">
                <div className="text-[11px]">출고 예정일</div>
                <div className="text-slate-800">{formatExpectedDateLabel(order.promisedDate)}</div>
              </div>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-100 bg-white/80 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">주문 품목</h3>
                <span className="text-xs text-slate-500">{totalLines}개 품목 · 총 {formatNumber(totalOrdered)} EA</span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => setActiveTab('items')}
                  className={`rounded-full px-3 py-1 transition ${activeTab === 'items' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  주문 품목
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('shipments')}
                  className={`rounded-full px-3 py-1 transition ${activeTab === 'shipments' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  출고 내역
                </button>
              </div>
              <div className="mt-4">
                {activeTab === 'items' ? (
                  <div className="space-y-6">
                    <div className="overflow-hidden rounded-2xl border">
                      <table className="min-w-full text-left text-xs">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-4 py-2">제품</th>
                            <th className="px-4 py-2">수량</th>
                            <th className="px-4 py-2">단가</th>
                            <th className="px-4 py-2">세금</th>
                            <th className="px-4 py-2">금액</th>
                          </tr>
                        </thead>
                        <tbody>
                          {order.lines.map((line) => {
                            const unitLabel = getLineUnitLabel(line);
                            const productTitle = formatProductDisplayTitle(line);
                            const formattedUnitPrice = parseNumericValue(line.unitPrice);
                            const amountValue =
                              parseNumericValue(line.amount) ?? (formattedUnitPrice !== null ? formattedUnitPrice * line.orderedQty : null);
                            const taxLabelText = line.taxLabel?.trim();
                            const taxMeta = parseTaxMeta(taxLabelText);
                            let computedTax = parseNumericValue(line.taxAmount);
                            if (computedTax === null && amountValue !== null && taxMeta.rate !== null) {
                              if (taxMeta.mode === 'inclusive') {
                                const base = round(amountValue / (1 + taxMeta.rate));
                                computedTax = Math.max(0, round(amountValue - base));
                              } else if (taxMeta.mode === 'exclusive') {
                                computedTax = round(amountValue * taxMeta.rate);
                              }
                            }
                            return (
                              <tr key={line.id} className="border-t border-slate-100 hover:bg-slate-50/60">
                                <td className="px-4 py-3 align-top">
                                  <div className="text-xs font-medium text-slate-900">{productTitle}</div>
                                  <div className="text-[11px] text-slate-400">{unitLabel}</div>
                                </td>
                                <td className="px-2 py-3 text-right text-xs text-slate-700">
                                  {formatNumber(line.orderedQty)} {unitLabel}
                                </td>
                                <td className="px-2 py-3 text-right text-xs text-slate-700">
                                  {formatCurrencyValue(formattedUnitPrice)}
                                </td>
                                <td className="px-2 py-3 text-right text-xs text-slate-700">
                                  <div>{formatCurrencyValue(computedTax)}</div>
                                  {taxLabelText && <div className="text-[11px] text-slate-400">{taxLabelText}</div>}
                                </td>
                                <td className="px-4 py-3 text-right text-xs font-semibold text-slate-900">
                                  {formatCurrencyValue(amountValue)}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <AmountSummaryCard summary={monetary} className="mt-5" />
                  </div>
                ) : (
                  <div className="space-y-3 rounded-2xl border border-slate-100 bg-white p-4 text-sm text-slate-600">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">출고 내역</p>
                      <span className="text-xs text-slate-500">최근 20건</span>
                    </div>
                    {movementError ? (
                      <p className="text-xs text-rose-600">{movementError}</p>
                    ) : movementLoading ? (
                      <p className="text-xs text-slate-500">출고 내역을 불러오는 중…</p>
                    ) : movements.length === 0 ? (
                      <p className="text-xs text-slate-500">등록된 출고 내역이 없습니다.</p>
                    ) : (
                      <div className="space-y-2">
                        {movements.map((movement) => (
                          <div key={movement.id} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm text-slate-600">
                            <p className="text-slate-900">
                              {movement.sku} · {movement.qty?.toLocaleString() ?? '0'} EA
                            </p>
                            <p className="text-xs text-slate-500">
                              {formatKstDateTimeLabelFromUtc(movement.occurredAt) ?? movement.occurredAt}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
          </div>
          <div className="space-y-4">
            <DocumentShareCard
              documentLabel="주문서"
              onPrint={handlePrint}
              onExport={handleExport}
              isPrintDisabled={isPrintDisabled}
              isExportDisabled={isExportDisabled}
            />
          </div>
        </div>
      </div>

      <Modal
        isOpen={shipmentModalOpen}
        onClose={closeShipmentModal}
        title="출고 등록"
        widthClassName="max-w-md"
      >
        <form
          className="space-y-4 text-sm text-slate-700"
          onSubmit={(event) => {
            event.preventDefault();
            void handleShipment();
          }}
        >
          <div className={infoBoxClass}>
            <div className="flex items-center justify-between">
              <p className="font-semibold text-slate-900">출고 방식</p>
              <p className="font-semibold text-slate-900">{shipmentMode === 'bulk' ? '일괄출고' : '부분출고'}</p>
            </div>
          </div>
          <div>
            <label className={inlineLabelClass}>
              출고 창고<span className="ml-1 text-rose-500">*</span>
            </label>
            {persistedWarehouse ? (
              <div className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                <div className="text-sm font-semibold text-slate-900">{persistedWarehouseLabel}</div>
                <p className="text-[11px] text-slate-500">주문서에서 지정한 창고입니다.</p>
              </div>
            ) : (
              <SelectDropdown
                value={shipmentWarehouse}
                onChange={(next) => setShipmentWarehouse(next)}
                options={shipmentWarehouseOptions}
                disabled={warehouseLoading && shipmentWarehouseOptions.length === 0}
                placeholder={warehouseSelectPlaceholder}
                emptyMessage={
                  warehouseLoading ? '창고 목록을 불러오는 중입니다...' : '창고를 선택해 주세요'
                }
                inputClassName={`${formInputClass} ${warehouseLoading ? 'cursor-not-allowed bg-slate-50 text-slate-400' : ''}`}
              />
            )}
            {warehouseError ? <p className="mt-1 text-xs text-rose-500">{warehouseError}</p> : null}
          </div>
          <div>
            <label className={blockLabelClass}>출고 일시</label>
            <input
              type="datetime-local"
              value={shipmentDate}
              max={formatLocalDateTimeInput(new Date())}
              step={60}
              onChange={(event) => setShipmentDate(event.target.value)}
              className={formInputClass}
            />
          </div>
          <div>
            <label className={blockLabelClass}>메모</label>
            <textarea
              rows={3}
              value={shipmentNote}
              onChange={(event) => setShipmentNote(event.target.value)}
              placeholder="출고에 필요한 내용을 작성해 주세요."
              className={formInputClass}
            />
          </div>
          {shipmentMode === 'partial' && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-xs font-semibold text-slate-500">부분 출고 수량</p>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {order.lines
                  .map((line) => {
                    const remaining = Math.max(0, line.orderedQty - line.shippedQty);
                    return { ...line, remaining };
                  })
                  .filter((line) => line.remaining > 0)
                  .map((line) => {
                    const value = partialQuantities[line.id] ?? line.remaining.toString();
                    return (
                      <div
                        key={line.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 bg-white/50 px-3 py-2"
                      >
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{formatLineNameWithSku(line)}</p>
                          <p className="text-[11px] text-slate-500">
                            요청 {line.orderedQty.toLocaleString()} · 출고 {line.shippedQty.toLocaleString()}
                          </p>
                        </div>
                        <input
                          type="number"
                          min="0"
                          max={line.remaining}
                          step="1"
                          value={value}
                          onChange={(event) => {
                            const next = event.target.value;
                            setPartialQuantities((prev) => ({
                              ...prev,
                              [line.id]: next,
                            }));
                          }}
                          className="w-24 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-right text-slate-900 focus:border-indigo-500 focus:outline-none"
                        />
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
          {shipmentError && <p className="text-xs text-rose-600">{shipmentError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={closeShipmentModal} disabled={shipmentProcessing} className={cancelButtonClass}>
              취소
            </button>
            <button type="submit" disabled={shipmentProcessing} className={confirmButtonClass}>
              {shipmentProcessing ? '출고 등록 중…' : '출고 등록'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        isOpen={printModalOpen}
        onClose={handleClosePrintModal}
        title="판매서 인쇄 정보"
        widthClassName="max-w-2xl max-h-[80vh]"
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleConfirmPrint();
          }}
        >
          <div>
            <label className="block text-xs font-semibold text-slate-500">담당자명</label>
            <input
              type="text"
              value={receiverContactName}
              onChange={(event) => setReceiverContactName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500">연락처</label>
            <input
              type="text"
              value={receiverPhone}
              onChange={(event) => setReceiverPhone(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500">메모</label>
            <textarea
              rows={3}
              value={receiverMemo}
              onChange={(event) => setReceiverMemo(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleClosePrintModal}
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600"
            >
              취소
            </button>
            <button type="submit" className="rounded-full bg-indigo-600 px-4 py-2 text-xs font-semibold text-white">
              인쇄
            </button>
          </div>
        </form>
      </Modal>
      <SalesOrderPrintDocument
        order={order}
        customer={customerPartner}
        receiverContactName={receiverContactName}
        receiverPhone={receiverPhone}
        receiverMemo={receiverMemo}
      />
    </>
  );
};

interface SalesOrderPrintDocumentProps {
  order: SalesOrder | null;
  customer?: Partner;
  receiverContactName: string;
  receiverPhone: string;
  receiverMemo: string;
}

const SalesOrderPrintDocument: React.FC<SalesOrderPrintDocumentProps> = ({
  order,
  customer,
  receiverContactName,
  receiverPhone,
  receiverMemo,
}) => {
  if (!order) {
    return null;
  }

  const createdLabel = formatDateLabel(order.createdAt);
  const promisedDateLabel = formatExpectedDateLabel(order.promisedDate);
  const createdKstLabel = formatKstDateTimeLabelFromUtc(order.createdAt) ?? createdLabel;

  const statusLabel = getSalesStatusLabel(order.status);
  const statusBadgeClass = getSalesStatusBadgeClass(order.status);
  const statusRingClass = getSalesStatusRingClass(order.status);

  const totalOrdered = order.lines.reduce((sum, line) => sum + line.orderedQty, 0);
  const customerNameLabel = customer?.name ?? order.customerName ?? '—';
  const customerPhoneLabel = customer?.phone ?? '—';
  const customerEmailLabel = customer?.email ?? '—';
  const customerAddressLabel = customer?.address ?? '—';
  const receiverContactLabel = receiverContactName.trim() || '—';
  const receiverPhoneLabel = receiverPhone.trim() || '—';
  const receiverMemoLabel = receiverMemo.trim() || '메모 없음';
  const orderNumber = order.orderNumber ?? order.id;

  return (
    <div className="print-document">
      <div className="min-h-screen w-full bg-slate-200 flex items-start justify-center py-8 print:bg-white print:py-0 print:min-h-0">
        <main className="relative bg-white w-[794px] min-h-[1123px] px-10 py-8 pb-12 text-slate-900 text-[10px] leading-relaxed rounded-[32px] border border-slate-200 shadow-[0_20px_60px_rgba(15,23,42,0.12)] print:border-0 print:shadow-none print:w-[176mm] print:max-w-[176mm] print:min-h-0 print:h-auto print:px-6 print:py-6 print:pb-6 print:rounded-[24px] print:bg-white print:overflow-visible">
          <header className="flex items-start justify-between border-b border-slate-200 pb-3 mb-3 print-avoid-break">
            <div>
              <div className="flex flex-wrap items-end gap-3">
                <h1 className="text-xl font-semibold text-slate-900">판매 주문서</h1>
                <span className="text-base font-medium text-slate-500">(Sales Order)</span>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[10px] font-medium tracking-[0.3em] text-slate-500 uppercase">주문번호</p>
              <p className="text-xl font-semibold text-slate-900">{orderNumber}</p>
              <span
                className={`mt-2 inline-flex items-center justify-center rounded-full border px-2 py-[2px] text-[9px] font-semibold ring-1 ring-inset ${statusBadgeClass} ${statusRingClass}`}
              >
                {statusLabel}
              </span>
            </div>
          </header>

          <section className="grid grid-cols-2 gap-3 mb-4 text-[10px] print-avoid-break">
            <div className="space-y-1">
              <p>
                <span className="font-medium text-slate-500">작성일:</span>{' '}
                <span className="font-semibold text-slate-900">{createdKstLabel}</span>
              </p>
              <p>
                <span className="font-medium text-slate-500">출고 예정일:</span>{' '}
                <span className="font-semibold text-slate-900">{promisedDateLabel}</span>
              </p>
            </div>
            <div className="space-y-1 text-right">
              <p>
                <span className="font-medium text-slate-500">주문 상태:</span>{' '}
                <span className="font-semibold text-slate-900">{statusLabel}</span> · 총 수량{' '}
                <span className="font-semibold text-slate-900">{formatNumber(totalOrdered)}</span> EA
              </p>
            </div>
          </section>

          <section className="grid gap-3 lg:grid-cols-2 mb-4 print-avoid-break">
            <article className="rounded-xl border border-slate-200 bg-white p-3">
              <h2 className="mb-2 text-xs font-semibold text-slate-900">고객 정보</h2>
              <dl className="space-y-2 text-[10px] text-slate-500">
                <div className="flex justify-between">
                  <dt className="text-slate-400">고객</dt>
                  <dd className="font-semibold text-slate-900">{customerNameLabel}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">연락처</dt>
                  <dd className="font-semibold text-slate-900">{customerPhoneLabel}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">이메일</dt>
                  <dd className="font-semibold text-slate-900">{customerEmailLabel}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">주소</dt>
                  <dd className="font-semibold text-slate-900">{customerAddressLabel}</dd>
                </div>
              </dl>
            </article>
            <article className="rounded-xl border border-slate-200 bg-white p-3">
              <h2 className="mb-2 text-xs font-semibold text-slate-900">출고 담당</h2>
              <dl className="space-y-2 text-[10px] text-slate-500">
                <div className="flex justify-between">
                  <dt className="text-slate-400">담당자</dt>
                  <dd className="font-semibold text-slate-900">{receiverContactLabel}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-400">연락처</dt>
                  <dd className="font-semibold text-slate-900">{receiverPhoneLabel}</dd>
                </div>
                <div className="space-y-1">
                  <dt className="text-slate-400">메모</dt>
                  <dd className="font-semibold text-slate-900 text-[10px] whitespace-pre-line">
                    {receiverMemoLabel}
                  </dd>
                </div>
              </dl>
            </article>
          </section>

          <section className="mb-4 print-avoid-break">
            <div className="mb-2 flex items-center justify-between text-[11px]">
              <h2 className="text-xs font-semibold text-slate-900">품목 내역</h2>
              <p className="text-[9px] text-slate-500">총 {order.lines.length}건</p>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-100">
              <table className="min-w-full border-collapse text-left text-[10px]">
                <thead className="bg-slate-50 text-slate-500 text-[9px] uppercase tracking-wider">
                  <tr>
                    <th className="px-2 py-2 font-semibold text-left text-[9px]">제품명 / 코드</th>
                    <th className="px-2 py-2 font-semibold text-left text-[9px]">규격</th>
                    <th className="px-2 py-2 font-semibold text-right text-[9px]">수량</th>
                    <th className="px-2 py-2 font-semibold text-right text-[9px]">단가</th>
                    <th className="px-2 py-2 font-semibold text-right text-[9px]">세액</th>
                    <th className="px-2 py-2 font-semibold text-right text-[9px]">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-2 py-5 text-center text-[10px] text-slate-400">
                        등록된 품목이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    order.lines.map((line) => {
                      const quantity = line.orderedQty;
                      const rawUnitPrice = parseNumericValue(line.unitPrice) ?? 0;
                      const numerator = parseNumericValue(line.amount) ?? 0;
                      const computedUnitPrice =
                        rawUnitPrice > 0
                          ? rawUnitPrice
                          : quantity > 0
                          ? Math.round(numerator / Math.max(1, quantity))
                          : 0;
                      const taxValue = parseNumericValue(line.taxAmount) ?? 0;
                      const amountValue =
                        parseNumericValue(line.amount) ??
                        Math.round(computedUnitPrice * Math.max(0, quantity));
                      return (
                        <tr key={line.id} className="border-b border-slate-100">
                          <td className="px-2 py-2">
                            <div className="font-semibold text-slate-900 text-[10px]">
                              {line.productName ?? line.sku}
                            </div>
                            <div className="text-[9px] uppercase tracking-wide text-slate-400">
                              {line.sku}
                            </div>
                          </td>
                          <td className="px-2 py-2 text-[10px] font-semibold text-slate-900">
                            {line.unit ?? 'EA'}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold text-slate-900 text-[10px]">
                            {formatNumber(quantity)}
                          </td>
                          <td className="px-2 py-2 text-right text-[10px] text-slate-900">
                            {formatCurrency(computedUnitPrice)}
                          </td>
                          <td className="px-2 py-2 text-right text-[10px] text-slate-900">
                            {formatCurrency(taxValue)}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold text-slate-900 text-[10px]">
                            {formatCurrency(amountValue)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default SalesOrderDetailPage;
