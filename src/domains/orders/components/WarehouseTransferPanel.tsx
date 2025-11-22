import * as React from 'react';
import Modal from '../../../../components/ui/Modal';
import { useToast } from '../../../components/Toaster';
import { emitInventoryRefreshEvent } from '../../../app/utils/inventoryEvents';
import { fetchProducts, type Product } from '../../../services/products';
import { submitMovement } from '../../../services/movements';
import type { OrdersWarehouse } from './types';
import {
  adjustWarehouseInventory,
  buildWarehouseInventoryIndex,
  type WarehouseInventoryIndex,
  type WarehouseInventoryItem,
} from '../utils/warehouseInventory';
import SelectDropdown from '../../../components/common/SelectDropdown';
import type { ComboboxOption } from '../../../components/common/Combobox';
interface WarehouseTransferPanelProps {
  warehouses: OrdersWarehouse[];
  defaultFromWarehouse?: string | null;
  defaultToWarehouse?: string | null;
  className?: string;
}
interface TransferHistoryEntry {
  sku: string;
  name: string;
  qty: number;
  fromId: string;
  toId: string;
  ts: number;
}
const USER_ID = 'orders-transfer-ui';

const normalizeQuantityInputValue = (rawValue: string): string => {
  const trimmed = rawValue.trim();
  if (trimmed === '') {
    return '';
  }
  const digitsOnly = trimmed.replace(/\D/g, '');
  if (digitsOnly === '') {
    return '';
  }
  const withoutLeadingZeros = digitsOnly.replace(/^0+/, '');
  return withoutLeadingZeros === '' ? '0' : withoutLeadingZeros;
};

const resolveInitialPair = (
  warehouses: OrdersWarehouse[],
  preferredFrom?: string | null,
  preferredTo?: string | null,
): { from?: string; to?: string } => {
  if (warehouses.length === 0) {
    return {};
  }
  const codes = warehouses.map((w) => w.code);
  const fromCandidate = preferredFrom && codes.includes(preferredFrom) ? preferredFrom : codes[0];
  let toCandidate = preferredTo && codes.includes(preferredTo) ? preferredTo : undefined;
  if (!toCandidate) {
    toCandidate = codes.find((code) => code !== fromCandidate) ?? codes[0];
  }
  if (fromCandidate === toCandidate && codes.length > 1) {
    toCandidate = codes.find((code) => code !== fromCandidate) ?? codes[0];
  }
  return { from: fromCandidate, to: toCandidate };
};
const useWarehouseLookup = (warehouses: OrdersWarehouse[]) =>
  React.useMemo(() => {
    const map = new Map<string, OrdersWarehouse>();
    warehouses.forEach((warehouse) => {
      map.set(warehouse.code, warehouse);
    });
    return map;
  }, [warehouses]);
const ListPanel: React.FC<{ title: string; className?: string; children?: React.ReactNode }> = ({
  title,
  className,
  children,
}) => (
  <div className={`flex flex-1 flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className ?? ''}`}>
    <div className="text-xs font-semibold text-slate-500">{title}</div>
    <div className="flex flex-1 flex-col gap-3 text-sm text-slate-600">{children}</div>
  </div>
);
const QuickSendButton: React.FC<{ onClick: () => void; disabled?: boolean }> = ({ onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="rounded border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600 transition hover:border-blue-400 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
  >
    보내기
  </button>
);
const WarehouseTransferPanel: React.FC<WarehouseTransferPanelProps> = ({
  warehouses,
  defaultFromWarehouse,
  defaultToWarehouse,
  className,
}) => {
  const showToast = useToast();
  const warehouseLookup = useWarehouseLookup(warehouses);
  const [{ from, to }, setPair] = React.useState<{ from?: string; to?: string }>(() =>
    resolveInitialPair(warehouses, defaultFromWarehouse ?? undefined, defaultToWarehouse ?? undefined),
  );
  const [inventoryIndex, setInventoryIndex] = React.useState<WarehouseInventoryIndex>({});
  const [loading, setLoading] = React.useState(false);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [pendingCount, setPendingCount] = React.useState(0);
  const [recent, setRecent] = React.useState<TransferHistoryEntry[]>([]);
  const [quantityPrompt, setQuantityPrompt] = React.useState<{
    sku: string;
    name: string;
    maxQty: number;
    fromWarehouse: string;
    toWarehouse: string;
  } | null>(null);
  const [quantityInput, setQuantityInput] = React.useState<string>('1');
  const isBusy = pendingCount > 0;
  const fromProducts = (from && inventoryIndex[from]) ?? [];
  const toProducts = (to && inventoryIndex[to]) ?? [];
  const warehouseOptions = React.useMemo<ComboboxOption[]>(() => {
    return warehouses.map((warehouse) => ({
      value: warehouse.code,
      label: warehouse.name ? `${warehouse.name} (${warehouse.code})` : warehouse.code,
    }));
  }, [warehouses]);
  const resetState = React.useCallback(() => {
    setRecent([]);
  }, []);
  React.useEffect(() => {
    const { from: initialFrom, to: initialTo } = resolveInitialPair(
      warehouses,
      defaultFromWarehouse ?? undefined,
      defaultToWarehouse ?? undefined,
    );
    setPair({ from: initialFrom, to: initialTo });
    resetState();
  }, [defaultFromWarehouse, defaultToWarehouse, resetState, warehouses]);
  const loadInventory = React.useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const products: Product[] = await fetchProducts();
      const index = buildWarehouseInventoryIndex(products);
      setInventoryIndex(index);
    } catch (error) {
      console.error('[orders] warehouse transfer: failed to load inventory', error);
      setLoadError('창고 재고를 불러오지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setLoading(false);
    }
  }, []);
  React.useEffect(() => {
    void loadInventory();
  }, [loadInventory]);
  const runTransfer = React.useCallback(
    async (input: { sku: string; qty: number; fromWarehouse: string; toWarehouse: string; productName?: string }) => {
      const { sku, qty, fromWarehouse, toWarehouse, productName } = input;
      if (qty <= 0) {
        return false;
      }

      const sourceItems = inventoryIndex[fromWarehouse] ?? [];
      const sourceItem = sourceItems.find((item) => item.sku === sku);
      if (!sourceItem || sourceItem.onHand <= 0) {
        showToast('선택한 창고에 해당 상품 재고가 없습니다.', { tone: 'info' });
        return false;
      }
      if (qty > sourceItem.onHand) {
        showToast('요청 수량이 현재 재고를 초과합니다.', { tone: 'info' });
        return false;
      }

      setPendingCount((count) => count + 1);
      try {
        await submitMovement({
          type: 'TRANSFER',
          sku,
          qty,
          fromWarehouse,
          toWarehouse,
          occurredAt: new Date().toISOString(),
          userId: USER_ID,
        });

        setInventoryIndex((previous) => {
          let next = adjustWarehouseInventory(previous, fromWarehouse, sku, -qty, {
            fallbackName: productName,
          });
          next = adjustWarehouseInventory(next, toWarehouse, sku, qty, {
            fallbackName: productName,
          });
          return next;
        });
        emitInventoryRefreshEvent({
          source: 'transfers',
          movements: [
            {
              product: { sku },
              change: qty,
              occurredAt: new Date().toISOString(),
            },
          ],
        });
        return true;
      } catch (error) {
        console.error('[orders] warehouse transfer: submitMovement failed', error);
        const message =
          error instanceof Error && error.message
            ? error.message
            : '이동 요청이 실패했어요. 창고와 재고를 확인해 주세요.';
        showToast(message, { tone: 'error' });
        return false;
      } finally {
        setPendingCount((count) => Math.max(0, count - 1));
      }
    },
    [inventoryIndex, showToast],
  );
  const ensureTransferReady = React.useCallback(
    (
      sku: string,
      overrides?: { fromWarehouse?: string; toWarehouse?: string },
    ):
      | { sourceWarehouse: string; targetWarehouse: string; sourceItem: WarehouseInventoryItem }
      | null => {
      const sourceWarehouse = overrides?.fromWarehouse ?? from;
      const targetWarehouse = overrides?.toWarehouse ?? to;
      if (!sourceWarehouse || !targetWarehouse) {
        showToast('Please choose both warehouses first.', { tone: 'info' });
        return null;
      }
      if (sourceWarehouse === targetWarehouse) {
        showToast('You cannot move stock within the same warehouse.', { tone: 'info' });
        return null;
      }
      const sourceItems = inventoryIndex[sourceWarehouse] ?? [];
      const sourceItem = sourceItems.find((item) => item.sku === sku);
      if (!sourceItem) {
        showToast('No matching stock exists in the selected warehouse.', { tone: 'info' });
        return null;
      }
      if (sourceItem.onHand <= 0) {
        showToast('There is no available stock to move.', { tone: 'info' });
        return null;
      }
      return { sourceWarehouse, targetWarehouse, sourceItem };
    },
    [from, to, inventoryIndex, showToast],
  );
  const openQuantityPrompt = React.useCallback(
    (sku: string) => {
      const context = ensureTransferReady(sku);
      if (!context) {
        return;
      }
      const { sourceWarehouse, targetWarehouse, sourceItem } = context;
      setQuantityInput(normalizeQuantityInputValue('1'));
      setQuantityPrompt({
        sku,
        name: sourceItem.name,
        maxQty: sourceItem.onHand,
        fromWarehouse: sourceWarehouse,
        toWarehouse: targetWarehouse,
      });
    },
    [ensureTransferReady],
  );
  const moveNow = React.useCallback(
    async (
      sku: string,
      qty = 1,
      options?: { productName?: string; fromWarehouse?: string; toWarehouse?: string },
    ) => {
      const context = ensureTransferReady(sku, {
        fromWarehouse: options?.fromWarehouse,
        toWarehouse: options?.toWarehouse,
      });
      if (!context) {
        return false;
      }
      const { sourceWarehouse, targetWarehouse, sourceItem } = context;
      const moveQty = Math.min(Math.max(1, qty), sourceItem.onHand);
      const success = await runTransfer({
        sku,
        qty: moveQty,
        fromWarehouse: sourceWarehouse,
        toWarehouse: targetWarehouse,
        productName: options?.productName ?? sourceItem.name,
      });
      if (!success) {
        return false;
      }
      const timestamp = Date.now();
      setRecent((prev) => [
        {
          sku,
          name: options?.productName ?? sourceItem.name,
          qty: moveQty,
          fromId: sourceWarehouse,
          toId: targetWarehouse,
          ts: timestamp,
        },
        ...prev.slice(0, 19),
      ]);
      return true;
    },
    [ensureTransferReady, runTransfer],
  );
  const handleQuantitySubmit = React.useCallback(
    async () => {
      if (!quantityPrompt) {
        return;
      }
      const normalized = Math.floor(Number(quantityInput));
      if (!Number.isFinite(normalized) || normalized <= 0) {
        showToast('Enter a quantity of at least 1.', { tone: 'info' });
        return;
      }
      if (normalized > quantityPrompt.maxQty) {
        showToast('Requested quantity exceeds available stock.', { tone: 'info' });
        return;
      }
      const success = await moveNow(quantityPrompt.sku, normalized, {
        productName: quantityPrompt.name,
        fromWarehouse: quantityPrompt.fromWarehouse,
        toWarehouse: quantityPrompt.toWarehouse,
      });
      if (success) {
        setQuantityPrompt(null);
        setQuantityInput('1');
      }
    },
    [moveNow, quantityInput, quantityPrompt, showToast],
  );
  const handleQuantityClose = React.useCallback(() => {
    if (isBusy) {
      return;
    }
    setQuantityPrompt(null);
    setQuantityInput('1');
  }, [isBusy]);
  const undoMove = React.useCallback(
    async (entry: TransferHistoryEntry) => {
      const success = await runTransfer({
        sku: entry.sku,
        qty: entry.qty,
        fromWarehouse: entry.toId,
        toWarehouse: entry.fromId,
        productName: entry.name,
      });
      if (!success) {
        return;
      }
      setRecent((prev) => prev.filter((candidate) => candidate.ts !== entry.ts));
      showToast('Transfer has been reverted.', { tone: 'success' });
    },
    [runTransfer, showToast],
  );

  const getWarehouseLabel = React.useCallback(
    (code?: string) => {
      if (!code) {
        return '미선택';
      }
      const record = warehouseLookup.get(code);
      const name = record?.name?.trim();
      return name || '미지정 창고';
    },
    [warehouseLookup],
  );
  const containerClassName = React.useMemo(
    () =>
      [
        'flex min-h-[640px] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm',
        className,
      ]
        .filter(Boolean)
        .join(' '),
    [className],
  );
  return (
    <>
      <div className={containerClassName}>
        <div className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-slate-500">출발 창고</label>
              <SelectDropdown
                value={from ?? ''}
                onChange={(next) => setPair((prev) => ({ ...prev, from: next }))}
                options={warehouseOptions}
                placeholder="출발 창고 선택"
                inputClassName="mt-1 min-w-[200px] rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
                disabled={isBusy || loading || warehouses.length === 0}
              />
            </div>
            <span className="text-xl text-slate-400">→</span>
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-slate-500">도착 창고</label>
              <SelectDropdown
                value={to ?? ''}
                onChange={(next) => setPair((prev) => ({ ...prev, to: next }))}
                options={warehouseOptions}
                placeholder="도착 창고 선택"
                inputClassName={`mt-1 min-w-[200px] rounded border px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 ${
                  from && to && from === to ? 'border-rose-300 bg-rose-50 text-rose-600' : 'border-slate-300'
                }`}
                disabled={isBusy || loading || warehouses.length === 0}
              />
              {from && to && from === to ? (
                <span className="mt-1 text-[11px] text-rose-500">동일 창고로는 이동할 수 없습니다.</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-60 border-r border-slate-200 bg-white p-4">
            <div className="mb-3 text-sm font-semibold text-slate-700">최근 이동</div>
            <div className="flex flex-col gap-2 overflow-y-auto">
              {recent.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 p-3 text-xs text-slate-400">
                  아직 이동 내역이 없어요.
                </p>
              ) : (
                recent.map((entry) => {
                  const fromLabel = getWarehouseLabel(entry.fromId);
                  const toLabel = getWarehouseLabel(entry.toId);
                  return (
                    <div key={entry.ts} className="rounded-lg border border-slate-200 p-3 text-xs text-slate-600">
                      <div className="font-semibold text-slate-700">{entry.name}</div>
                      <div className="mt-1 text-[11px] text-slate-500">
                        {entry.sku} · {fromLabel} → {toLabel}
                      </div>
                      <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                        <span>{entry.qty.toLocaleString('ko-KR')} EA</span>
                        <button
                          type="button"
                          onClick={() => void undoMove(entry)}
                          disabled={isBusy}
                          className="text-blue-500 transition hover:text-blue-400 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          되돌리기
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>
          <section className="flex-1 bg-slate-50">
            {loading ? (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">재고를 불러오는 중...</div>
            ) : loadError ? (
              <div className="flex h-full items-center justify-center">
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-600">
                  {loadError}
                </div>
              </div>
            ) : (
              <div className="flex min-h-full flex-col gap-6 px-6 py-6">
                <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="mb-4">
                    <div>
                      <h3 className="text-base font-semibold text-slate-800">바로 이동</h3>
                      <p className="text-xs text-slate-500">수량을 입력해 상품을 즉시 이동할 수 있어요.</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm text-slate-700">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                          <th className="py-2">제품</th>
                          <th className="w-24 py-2 text-right">현재고</th>
                          <th className="w-24 py-2 text-right">바로 이동</th>
                        </tr>
                      </thead>
                      <tbody>
                        {from && fromProducts.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="py-6 text-center text-xs text-slate-400">
                              선택한 창고에 표시할 재고가 없어요.
                            </td>
                          </tr>
                        ) : (
                          fromProducts.map((item) => (
                            <tr key={item.sku} className="border-b border-slate-100">
                              <td className="py-3">
                                <div className="font-medium text-slate-800">{item.name}</div>
                                <div className="text-xs text-slate-500">{item.sku}</div>
                              </td>
                              <td className="py-3 text-right font-semibold text-slate-700">
                                {item.onHand.toLocaleString('ko-KR')}
                              </td>
                              <td className="py-3 text-right">
                                <QuickSendButton
                                  onClick={() => openQuantityPrompt(item.sku)}
                                  disabled={isBusy || item.onHand <= 0}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <ListPanel title={`출발 창고 재고 – ${getWarehouseLabel(from)}`}>
                    {fromProducts.length === 0 ? (
                      <p className="rounded-lg border border-slate-200 px-3 py-5 text-center text-xs text-slate-400">
                        선택한 창고에 표시할 재고가 없어요.
                      </p>
                    ) : (
                      fromProducts.map((item) => (
                        <div key={item.sku} className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                          <div className="text-xs text-slate-500">{item.sku}</div>
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-500">
                            <span className="font-semibold text-slate-700">
                              재고 {item.onHand.toLocaleString('ko-KR')} EA
                            </span>
                            <QuickSendButton
                              onClick={() => openQuantityPrompt(item.sku)}
                              disabled={isBusy || item.onHand <= 0}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </ListPanel>
                  <ListPanel title={`도착 창고 재고 – ${getWarehouseLabel(to)}`}>
                    {toProducts.length === 0 ? (
                      <p className="rounded-lg border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-400">
                        아직 표시할 재고가 없어요. 바로 이동 버튼을 눌러 도착 창고를 채워보세요.
                      </p>
                    ) : (
                      toProducts.map((item) => (
                        <div key={item.sku} className="rounded-xl border border-slate-200 bg-white px-3 py-2">
                          <div className="text-sm font-medium text-slate-800">{item.name}</div>
                          <div className="text-xs text-slate-500">
                            {item.sku} · 재고 {item.onHand.toLocaleString('ko-KR')} EA
                          </div>
                        </div>
                      ))
                    )}
                    <div className="text-[11px] text-slate-400">
                      바로 이동 버튼으로 도착 창고를 채워보세요.
                    </div>
                  </ListPanel>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
      {quantityPrompt ? (
        <Modal
          isOpen
          onClose={handleQuantityClose}
          title="이동 수량 입력"
        >
          <div className="space-y-5 text-sm text-slate-700">
            <div>
              <div className="text-base font-semibold text-slate-800">{quantityPrompt.name}</div>
              <div className="text-xs text-slate-500 mt-1">{quantityPrompt.sku}</div>
              <div className="mt-2 text-xs text-slate-500">
                이동 가능 수량: {quantityPrompt.maxQty.toLocaleString('ko-KR')}
              </div>
            </div>
            <label className="flex flex-col gap-2 text-xs font-semibold text-slate-600">
              이동 수량
              <input
                type="number"
                min={1}
                max={quantityPrompt.maxQty}
                value={quantityInput}
                onChange={(event) => setQuantityInput(normalizeQuantityInputValue(event.target.value))}
                disabled={isBusy}
                className="w-full rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200 disabled:cursor-not-allowed disabled:bg-slate-100"
              />
            </label>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={handleQuantityClose}
                disabled={isBusy}
                className="rounded border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:border-slate-300 hover:text-slate-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => void handleQuantitySubmit()}
                disabled={isBusy}
                className="rounded bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
              >
                이동
              </button>
            </div>
          </div>
        </Modal>
      ) : null}
    </>
  );
};
export default WarehouseTransferPanel;
