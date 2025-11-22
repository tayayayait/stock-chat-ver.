import * as React from 'react';
import Modal from '@/components/ui/Modal';
import { ko } from '@/src/i18n/ko';
import {
  buildRangeForPreset,
  buildRangeFromDateStrings,
  KST_RANGE_PRESETS,
  type DateRange,
  type KstRangePreset,
  MAX_PURCHASE_ORDER_RANGE_DAYS,
  MAX_PURCHASE_ORDER_RANGE_MS,
} from '@/shared/datetime/ranges';
import PurchaseOrderDateRangePicker from '@/src/app/components/PurchaseOrderDateRangePicker';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  deleteSalesOrder,
  deleteSalesOrderDraft,
  listSalesOrderDrafts,
  listSalesOrders,
  type SalesOrder,
  type SalesOrderDraftRecord,
} from '../../../services/salesOrders';
import { getSalesStatusBadgeClass } from '@/app/utils/orderStatusBadge';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const toKstDateString = (iso: string): string => {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return '';
  }
  const shifted = new Date(timestamp + KST_OFFSET_MS);
  const yyyy = shifted.getUTCFullYear();
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const toKstDayIndex = (timestamp: number): number => Math.floor((timestamp + KST_OFFSET_MS) / MS_PER_DAY);

const getSalesOrderDayDiff = (iso: string | null | undefined): number | null => {
  if (!iso) {
    return null;
  }
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return toKstDayIndex(timestamp) - toKstDayIndex(Date.now());
};

type SalesTab = 'all' | 'draft' | 'awaiting' | 'partial' | 'shipped';

const formatDdayLabel = (dayDiff: number | null): string => {
  if (dayDiff === null) {
    return '—';
  }
  if (dayDiff === 0) {
    return 'D-0';
  }
  if (dayDiff > 0) {
    return `D-${dayDiff}`;
  }
  return `D+${Math.abs(dayDiff)}`;
};

const getDdayBadgeClass = (dayDiff: number | null): string => {
  if (dayDiff === null) {
    return 'bg-slate-100 text-slate-600';
  }
  if (dayDiff < 0) {
    return 'bg-rose-100 text-rose-600';
  }
  if (dayDiff === 0) {
    return 'bg-sky-100 text-sky-700';
  }
  if (dayDiff <= 3) {
    return 'bg-amber-100 text-amber-700';
  }
  return 'bg-slate-100 text-slate-700';
};

const shouldShowOrder = (order: SalesOrder, tab: SalesTab): boolean => {
  const totalOrdered = order.lines.reduce((sum, line) => sum + line.orderedQty, 0);
  const totalShipped = order.lines.reduce((sum, line) => sum + line.shippedQty, 0);
  const remaining = Math.max(0, totalOrdered - totalShipped);
  switch (tab) {
    case 'all':
      return order.status !== 'canceled';
    case 'draft':
      return order.status === 'draft';
    case 'awaiting':
      return order.status !== 'draft' && order.status !== 'canceled' && remaining > 0 && totalShipped === 0;
    case 'partial':
      return order.status !== 'draft' && order.status !== 'canceled' && totalShipped > 0 && remaining > 0;
    case 'shipped':
      return remaining <= 0 && order.status !== 'canceled';
    default:
      return false;
  }
};

const salesCopy = ko.salesOrders;

const STATUS_LABELS: Record<SalesOrder['status'], string> = {
  draft: salesCopy.tabs.labels.draft,
  open: salesCopy.tabs.labels.awaiting,
  partial: salesCopy.tabs.labels.partial,
  packed: salesCopy.tabs.labels.partial,
  closed: salesCopy.tabs.labels.shipped,
  canceled: salesCopy.tabs.labels.canceled,
};

const FILTER_PARAM = 'salesFilter';
const FILTER_VALUE = 'range';
const RANGE_FROM_PARAM = 'salesFrom';
const RANGE_TO_PARAM = 'salesTo';
const PRESET_PARAM = 'salesPreset';

const isPresetParam = (value: string | null): value is KstRangePreset =>
  value !== null && KST_RANGE_PRESETS.includes(value as KstRangePreset);

type DraftRow = SalesOrderDraftRecord & { __isDraft: true };
type DisplayRow = SalesOrder | DraftRow;

const isDraftRow = (value: DisplayRow): value is DraftRow =>
  Boolean((value as DraftRow).__isDraft);

const SalesOrdersPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [orders, setOrders] = React.useState<SalesOrder[]>([]);
  const [drafts, setDrafts] = React.useState<SalesOrderDraftRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [draftsLoading, setDraftsLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [draftsError, setDraftsError] = React.useState<string | null>(null);
  const [activeTab, setActiveTab] = React.useState<SalesTab>('all');
  const [manualRange, setManualRange] = React.useState({ from: '', to: '' });
  const [manualError, setManualError] = React.useState<string | null>(null);
  const [orderToDelete, setOrderToDelete] = React.useState<DisplayRow | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);

  const filterPanelOpen = searchParams.get(FILTER_PARAM) === FILTER_VALUE;
  const presetParam = searchParams.get(PRESET_PARAM);
  const manualFromParam = searchParams.get(RANGE_FROM_PARAM);
  const manualToParam = searchParams.get(RANGE_TO_PARAM);

  const activeRange = React.useMemo(() => {
    if (isPresetParam(presetParam)) {
      return buildRangeForPreset(presetParam);
    }
    if (manualFromParam && manualToParam) {
      return buildRangeFromDateStrings(manualFromParam, manualToParam);
    }
    return null;
  }, [manualFromParam, manualToParam, presetParam]);

  const activePreset: 'all' | KstRangePreset | 'custom' = React.useMemo(() => {
    if (isPresetParam(presetParam)) {
      return presetParam;
    }
    if (activeRange && manualFromParam && manualToParam) {
      return 'custom';
    }
    return 'all';
  }, [activeRange, manualFromParam, presetParam]);

  const isManualValid = React.useMemo(() => {
    if (!manualRange.from || !manualRange.to) {
      return true;
    }
    const candidate = buildRangeFromDateStrings(manualRange.from, manualRange.to);
    if (!candidate) {
      return false;
    }
    const duration = Date.parse(candidate.to) - Date.parse(candidate.from);
    return duration <= MAX_PURCHASE_ORDER_RANGE_MS;
  }, [manualRange]);

  const ensureRangeLoaded = React.useCallback(async (range?: DateRange | null) => {
    setLoading(true);
    setError(null);
    try {
      const response = await listSalesOrders(
        range ? { from: range.from, to: range.to } : undefined,
      );
      setOrders(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : '불러오는 중 오류 발생');
    } finally {
      setLoading(false);
    }
  }, []);

  const ensureDraftRangeLoaded = React.useCallback(async (range?: DateRange | null) => {
    setDraftsLoading(true);
    setDraftsError(null);
    try {
      const response = await listSalesOrderDrafts(
        range ? { from: range.from, to: range.to } : undefined,
      );
      setDrafts(response);
    } catch (err) {
      setDraftsError(err instanceof Error ? err.message : '불러오는 중 오류 발생');
    } finally {
      setDraftsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void ensureRangeLoaded(activeRange);
    void ensureDraftRangeLoaded(activeRange);
  }, [activeRange, ensureRangeLoaded, ensureDraftRangeLoaded]);

  React.useEffect(() => {
    if (!filterPanelOpen) {
      return;
    }
    if (activeRange) {
      setManualRange({
        from: toKstDateString(activeRange.from),
        to: toKstDateString(activeRange.to),
      });
      setManualError(null);
      return;
    }
    setManualRange({
      from: manualFromParam ?? '',
      to: manualToParam ?? '',
    });
    setManualError(null);
  }, [activeRange, filterPanelOpen, manualFromParam, manualToParam]);

  const handleOpenFilter = React.useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.set(FILTER_PARAM, FILTER_VALUE);
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const handleCloseFilter = React.useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete(FILTER_PARAM);
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const manualCandidate = React.useMemo(() => {
    if (!manualRange.from || !manualRange.to) {
      return null;
    }
    return buildRangeFromDateStrings(manualRange.from, manualRange.to);
  }, [manualRange]);

  const handleManualApply = React.useCallback(() => {
    if (!manualCandidate) {
      setManualError(salesCopy.filter.errors.invalidRange);
      return;
    }
    const duration = Date.parse(manualCandidate.to) - Date.parse(manualCandidate.from);
    if (duration > MAX_PURCHASE_ORDER_RANGE_MS) {
      setManualError(salesCopy.filter.errors.limitExceeded);
      return;
    }
    const next = new URLSearchParams(searchParams);
    next.set(RANGE_FROM_PARAM, manualRange.from);
    next.set(RANGE_TO_PARAM, manualRange.to);
    next.delete(PRESET_PARAM);
    next.delete(FILTER_PARAM);
    setSearchParams(next);
  }, [manualCandidate, manualRange, searchParams, setSearchParams]);

  const handlePresetSelect = React.useCallback(
    (preset: KstRangePreset | 'all') => {
      const next = new URLSearchParams(searchParams);
      next.delete(FILTER_PARAM);
      next.delete(RANGE_FROM_PARAM);
      next.delete(RANGE_TO_PARAM);
      if (preset === 'all') {
        next.delete(PRESET_PARAM);
      } else {
        next.set(PRESET_PARAM, preset);
      }
      setSearchParams(next);
    },
    [searchParams, setSearchParams],
  );

  const handleManualChange = React.useCallback(
    (range: { from: string; to: string }) => {
      setManualRange(range);
      setManualError(null);
    },
    [],
  );

  const handleClearFilter = React.useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete(RANGE_FROM_PARAM);
    next.delete(RANGE_TO_PARAM);
    next.delete(PRESET_PARAM);
    next.delete(FILTER_PARAM);
    setSearchParams(next);
  }, [searchParams, setSearchParams]);

  const manualViewRangeSummary = activeRange
    ? `${toKstDateString(activeRange.from)} ~ ${toKstDateString(activeRange.to)}`
    : salesCopy.filter.summaryEmpty;

  const filteredOrders = React.useMemo(
    () => orders.filter((order) => shouldShowOrder(order, activeTab)),
    [orders, activeTab],
  );

  const annotatedDrafts = React.useMemo<DisplayRow[]>(
    () => drafts.map((draft) => ({ ...draft, __isDraft: true })),
    [drafts],
  );

  const summaryByTab = React.useMemo(() => {
    const counts: Record<SalesTab, number> = {
      all: 0,
      draft: 0,
      awaiting: 0,
      partial: 0,
      shipped: 0,
    };
    orders.forEach((order) => {
      (Object.keys(counts) as SalesTab[]).forEach((tab) => {
        if (shouldShowOrder(order, tab)) {
          counts[tab] += 1;
        }
      });
    });
    counts.all += drafts.length;
    counts.draft = drafts.length;
    return counts;
  }, [orders, drafts]);

  const tabs: Array<{ key: SalesTab; label: string }> = [
    { key: 'all', label: salesCopy.tabs.labels.all },
    { key: 'draft', label: salesCopy.tabs.labels.draft },
    { key: 'awaiting', label: salesCopy.tabs.labels.awaiting },
    { key: 'partial', label: salesCopy.tabs.labels.partial },
    { key: 'shipped', label: salesCopy.tabs.labels.shipped },
  ];

  const handleRowClick = React.useCallback(
    (orderId: string, isDraft: boolean) => {
      if (isDraft) {
        navigate(`/sales-orders/new?draftId=${encodeURIComponent(orderId)}`);
        return;
      }
      navigate(`/sales-orders/${encodeURIComponent(orderId)}`);
    },
    [navigate],
  );

  const openDeleteModal = React.useCallback((row: DisplayRow) => {
    setOrderToDelete(row);
    setDeleteError(null);
  }, []);

  const closeDeleteModal = React.useCallback(() => {
    if (isDeleting) {
      return;
    }
    setOrderToDelete(null);
    setDeleteError(null);
  }, [isDeleting]);

  const handleConfirmDelete = React.useCallback(async () => {
    if (!orderToDelete) {
      return;
    }
    setIsDeleting(true);
    setDeleteError(null);
    try {
      if (isDraftRow(orderToDelete)) {
        await deleteSalesOrderDraft(orderToDelete.id);
        setDrafts((prev) => prev.filter((entry) => entry.id !== orderToDelete.id));
      } else {
        await deleteSalesOrder(orderToDelete.id);
        setOrders((prev) => prev.filter((entry) => entry.id !== orderToDelete.id));
      }
      setOrderToDelete(null);
    } catch (deleteErr) {
      const message =
        deleteErr instanceof Error ? deleteErr.message : '삭제에 실패했습니다. 다시 시도해 주세요.';
      setDeleteError(message);
    } finally {
      setIsDeleting(false);
    }
  }, [deleteSalesOrder, deleteSalesOrderDraft, orderToDelete]);

  const isDraftTab = activeTab === 'draft';
  const activeRows = React.useMemo<DisplayRow[]>(() => {
    if (isDraftTab) {
      return annotatedDrafts;
    }
    if (activeTab === 'all') {
      return [...filteredOrders, ...annotatedDrafts];
    }
    return filteredOrders;
  }, [activeTab, annotatedDrafts, filteredOrders, isDraftTab]);
  const activeError = isDraftTab ? draftsError : error;
  const activeLoading = isDraftTab ? draftsLoading : loading;
  const activeEmptyMessage = isDraftTab ? salesCopy.tabs.empty : salesCopy.list.empty;
  const deleteTargetIsDraft = orderToDelete ? isDraftRow(orderToDelete) : false;

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{salesCopy.title}</h1>
          <p className="text-sm text-slate-500">{salesCopy.description}</p>
          <p className="mt-1 text-xs text-slate-500">{manualViewRangeSummary}</p>
        </div>
        <div className="flex gap-2">
          {activeRange ? (
            <button
              type="button"
              onClick={handleClearFilter}
              className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900"
            >
              {salesCopy.filter.actions.clear}
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleOpenFilter}
            className="rounded-full border border-slate-200 px-4 py-2 min-w-[120px] text-center text-xs font-semibold uppercase tracking-[0.3em] text-slate-600 transition hover:border-indigo-400 hover:text-indigo-600"
          >
            {salesCopy.filter.actions.open}
          </button>
          <button
            type="button"
            onClick={() => navigate('/sales-orders/new')}
            className="rounded-full bg-indigo-600 px-4 py-2 min-w-[120px] text-center text-xs font-semibold text-white transition hover:bg-indigo-700"
          >
            {salesCopy.actions.newOrder}
          </button>
        </div>
      </header>

      <section className="rounded-2xl border border-slate-100 bg-white/80 px-4 py-4">
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="주문 상태">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`inline-flex items-center gap-2 pb-3 text-xs font-semibold transition ${
                activeTab === tab.key
                  ? 'border-b-2 border-indigo-600 text-indigo-600'
                  : 'border-b-2 border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-200'
              }`}
            >
              <span>{tab.label}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
                {summaryByTab[tab.key].toLocaleString('ko-KR')}건
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-100 bg-white/80 p-4">
        {activeError ? (
          <p className="text-sm text-rose-500">
            {salesCopy.list.error}
            {activeError ? ` (${activeError})` : ''}
          </p>
        ) : activeLoading ? (
          <p className="text-sm text-slate-500">{salesCopy.list.loading}</p>
        ) : activeRows.length === 0 ? (
          <p className="text-sm text-slate-500">{activeEmptyMessage}</p>
        ) : (
          <div className="overflow-hidden rounded-2xl border">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">번호</th>
                  <th className="px-4 py-3">고객</th>
                  <th className="px-4 py-3">상태</th>
                  <th className="px-4 py-3">총 주문</th>
                  <th className="px-4 py-3">출고</th>
                  <th className="px-4 py-3">출고 D-Day</th>
                  <th className="px-4 py-3">출고 예정일</th>
                  <th className="px-4 py-3 text-right">작업</th>
                </tr>
              </thead>
              <tbody>
                {activeRows.map((order) => {
                  const totalOrdered = order.lines.reduce((sum, line) => sum + line.orderedQty, 0);
                  const totalShipped = isDraftRow(order)
                    ? 0
                    : order.lines.reduce((sum, line) => sum + line.shippedQty, 0);
                  const dayDiff = getSalesOrderDayDiff(order.promisedDate);
                  const statusLabel = STATUS_LABELS[order.status];
                  return (
                    <tr
                      key={order.id}
                      className="border-t border-slate-100 hover:bg-slate-50"
                      onClick={() => handleRowClick(order.id, isDraftRow(order))}
                      style={{ cursor: 'pointer' }}
                    >
                      <td className="px-4 py-3 font-medium">{order.orderNumber || order.id}</td>
                      <td className="px-4 py-3">{order.customerName ?? order.customerId}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${getSalesStatusBadgeClass(
                            order.status,
                          )}`}
                        >
                          {statusLabel}
                        </span>
                      </td>
                      <td className="px-4 py-3">{totalOrdered.toLocaleString()} EA</td>
                      <td className="px-4 py-3 text-slate-600">
                        {totalShipped.toLocaleString()} / {totalOrdered.toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold ${getDdayBadgeClass(
                            dayDiff,
                          )}`}
                        >
                          {formatDdayLabel(dayDiff)}
                        </span>
                      </td>
                      <td className="px-4 py-3">{order.promisedDate ? toKstDateString(order.promisedDate) : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          aria-label={`${
                            isDraftRow(order) ? '임시 저장 주문서' : '주문서'
                          } ${order.orderNumber || order.id} 삭제`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            openDeleteModal(order);
                          }}
                          className="rounded-full border border-rose-100 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 transition hover:border-rose-200 hover:bg-rose-100"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Modal
        isOpen={Boolean(orderToDelete)}
        onClose={closeDeleteModal}
        title={deleteTargetIsDraft ? '임시 저장 주문서 삭제' : '주문서 삭제'}
      >
        <p className="text-sm text-slate-700">
          {orderToDelete
            ? `${orderToDelete.orderNumber || orderToDelete.id} ${
                deleteTargetIsDraft ? '임시 저장 주문서' : '주문서'
              } 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.`
            : '삭제할 주문서를 선택해 주세요.'}
        </p>
        {deleteError && <p className="mt-3 text-sm text-rose-600">{deleteError}</p>}
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleConfirmDelete}
            disabled={isDeleting}
            className="rounded-full bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isDeleting ? '삭제 중…' : '확인'}
          </button>
          <button
            type="button"
            onClick={closeDeleteModal}
            disabled={isDeleting}
            className="rounded-full border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            취소
          </button>
        </div>
      </Modal>

      <PurchaseOrderDateRangePicker
        isOpen={filterPanelOpen}
        onClose={handleCloseFilter}
        onPresetSelect={handlePresetSelect}
        manualFrom={manualRange.from}
        manualTo={manualRange.to}
        onManualChange={handleManualChange}
        onApply={handleManualApply}
        isManualValid={isManualValid}
        validationMessage={manualError}
        activePreset={activePreset}
        maxRangeDays={MAX_PURCHASE_ORDER_RANGE_DAYS}
      />
    </div>
  );
};

export default SalesOrdersPage;
