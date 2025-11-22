import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { Partner } from '../../../services/orders';
import { listPartners } from '../../../services/orders';
import type { Product } from '../../../services/products';
import { fetchProducts } from '../../../services/products';
import {
  createSalesOrder,
  createSalesOrderDraft,
  deleteSalesOrderDraft,
  getNextSalesOrderNumber,
  getSalesOrderDraft,
  updateSalesOrderDraft,
  type CreateSalesOrderLine,
  type SalesOrder,
  type SalesOrderDraftRecord,
} from '../../../services/salesOrders';
import { submitMovement, type CreateMovementPayload } from '../../../services/movements';
import { useToast } from '@/src/components/Toaster';
import Modal from '@/components/ui/Modal';
import SelectDropdown from '../../../components/common/SelectDropdown';
import type { ComboboxOption } from '../../../components/common/Combobox';
import { fetchWarehouses, type ApiWarehouse } from '../../../services/api';
import { createTaxType, listTaxTypes, type TaxMode, type TaxType } from '../../../services/taxTypes';
import { persistOrderWarehouse } from '@/src/utils/orderWarehouse';
import {
  convertToDatetimeLocal,
  convertToIsoTimestamp,
  ensureDatetimeLocalValue,
} from '@/app/utils/datetimeLocal';

type DraftLine = {
  id: string;
  productSku: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  taxTypeId: string | null;
};

const createLineId = () => crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 10);

const createEmptyLine = (taxTypeId: string | null = null): DraftLine => ({
  id: createLineId(),
  productSku: '',
  productName: '',
  quantity: '',
  unitPrice: '',
  taxTypeId,
});

const formatCurrency = (value: number) =>
  Number.isFinite(value)
    ? value.toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
    : '0';
const formatPriceInput = (value: number | null | undefined) =>
  value !== null && value !== undefined ? value.toFixed(2) : '';

const normalizeSalesPriceEntry = (value: string) => {
  const stripped = value.replace(/[^\d.]/g, '');
  if (stripped === '') {
    return '';
  }
  const parts = stripped.split('.');
  const integerPart = parts[0];
  const fractional = parts[1] ? parts[1].slice(0, 2) : '';
  return fractional ? `${integerPart}.${fractional}` : integerPart;
};

const formatSalesPriceForDisplay = (raw: string) => {
  if (!raw) {
    return '';
  }
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) {
    return '';
  }
  const decimalPart = raw.includes('.') ? raw.split('.')[1] : '';
  const hasNonZeroDecimal = /[1-9]/.test(decimalPart);
  const decimals = hasNonZeroDecimal ? Math.min(2, decimalPart.length) : 0;
  return numeric.toLocaleString('ko-KR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

const shippingModeOptions: ComboboxOption[] = [
  { label: '즉시출고', value: '즉시출고' },
  { label: '예약출고', value: '예약출고' },
];

const taxModeOptions: ComboboxOption[] = [
  { label: '별도', value: 'exclusive' },
  { label: '포함', value: 'inclusive' },
];

const toDateInputValue = (value?: string | null): string => {
  const normalized = convertToDatetimeLocal(value);
  if (!normalized) {
    return '';
  }
  return normalized.split('T')[0];
};

const SHIPMENT_MOVEMENT_USER_ID = 'sales-order-ui';

const DRAFT_STORAGE_KEY = 'sales-order:draft';

const convertRecordToDraft = (record: SalesOrderDraftRecord): SalesOrderDraft => ({
  customer: record.customerId,
  orderNumber: record.orderNumber || '',
  orderDate: record.orderDate ?? '',
  shipmentDate: record.promisedDate ?? '',
  memo: record.memo ?? '',
  shippingMode: record.shippingMode ?? '즉시출고',
  shippingNote: record.shippingNote ?? '',
  warehouse: record.warehouse ?? '',
  lines: record.lines.map((line) => ({
    id: createLineId(),
    productSku: line.sku,
    productName: line.productName ?? '',
    quantity: String(line.orderedQty),
    unitPrice:
      line.unitPrice !== undefined && line.unitPrice !== null ? line.unitPrice.toString() : '',
    taxTypeId: line.taxTypeId ?? null,
  })),
  draftId: record.id,
});

const normalizeWarehouseCode = (value?: string | null): string =>
  value?.trim().toUpperCase() ?? '';

const sanitizeStockValue = (value?: number | null): number => {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.round(numeric));
};

const persistDraftToStorage = (draft: SalesOrderDraft, overrideDraftId?: string | null) => {
  if (typeof window === 'undefined') {
    return;
  }
  const payload: SalesOrderDraft = {
    ...draft,
    draftId: overrideDraftId !== undefined ? overrideDraftId ?? undefined : draft.draftId,
  };
  if (!payload.draftId) {
    delete payload.draftId;
  }
  window.localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(payload));
};

const TAX_ADD_KEY = '__tax_add__';

type LineSummary = {
  lineId: string;
  base: number;
  tax: number;
  total: number;
  taxType: TaxType | null;
};

type TaxBreakdownEntry = {
  taxType: TaxType;
  base: number;
  amount: number;
};

const roundToWon = (value: number) => Math.round(value);

interface SalesOrderDraft {
  customer: string;
  orderNumber: string;
  orderDate: string;
  shipmentDate: string;
  memo: string;
  shippingMode: string;
  shippingNote: string;
  warehouse: string;
  lines: DraftLine[];
  draftId?: string;
}

const NewSalesOrderPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const draftIdParam = searchParams.get('draftId');
  const [customer, setCustomer] = useState('');
  const [orderDate, setOrderDate] = useState(() => ensureDatetimeLocalValue(undefined));
  const [shipmentDate, setShipmentDate] = useState('');
  const [memo, setMemo] = useState('');
  const [shippingMode, setShippingMode] = useState('즉시출고');
  const [shippingNote, setShippingNote] = useState('');
  const [selectedWarehouseCode, setSelectedWarehouseCode] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([createEmptyLine()]);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerLoading, setPartnerLoading] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [productLoading, setProductLoading] = useState(false);
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [orderNumber, setOrderNumber] = useState('');
  const [orderNumberLoading, setOrderNumberLoading] = useState(false);
  const [orderNumberError, setOrderNumberError] = useState<string | null>(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [isServerDraftLoaded, setIsServerDraftLoaded] = useState(false);
  const [taxTypes, setTaxTypes] = useState<TaxType[]>([]);
  const [taxLoading, setTaxLoading] = useState(false);
  const [taxLoadError, setTaxLoadError] = useState<string | null>(null);
  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [pendingTaxLineId, setPendingTaxLineId] = useState<string | null>(null);
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('0');
  const [newTaxMode, setNewTaxMode] = useState<TaxMode>('exclusive');
  const [taxNameError, setTaxNameError] = useState<string | null>(null);
  const [taxRateError, setTaxRateError] = useState<string | null>(null);
  const [taxCreating, setTaxCreating] = useState(false);
  const showToast = useToast();
  const partnerOptions = useMemo(
    () => partners.map((partner) => ({ label: partner.name, value: partner.id })),
    [partners],
  );
  const warehouseOptions = useMemo(
    () =>
      warehouses.map((entry) => ({
        label: `${entry.name} (${entry.code})`,
        value: entry.code,
      })),
    [warehouses],
  );
  const warehouseChangeMetaRef = useRef<{ code: string; showToast: boolean }>({ code: '', showToast: false });
  const hasSelectedWarehouseRef = useRef(false);
  const hasAttemptedProductLoadRef = useRef(false);
  const getWarehouseAvailableStock = useCallback(
    (product: Product, warehouseCode?: string) => {
      const target = normalizeWarehouseCode(warehouseCode);
      let total = 0;
      (product.inventory ?? []).forEach((entry) => {
        const entryCode = normalizeWarehouseCode(entry?.warehouseCode ?? null);
        if (target && entryCode !== target) {
          return;
        }
        const onHand = sanitizeStockValue(entry?.onHand ?? 0);
        const reserved = sanitizeStockValue(entry?.reserved ?? 0);
        total += Math.max(0, onHand - reserved);
      });
      if (target) {
        return total;
      }
      const fallback = sanitizeStockValue(product.onHand) - sanitizeStockValue(product.reserved);
      return Math.max(total, fallback, 0);
    },
    [],
  );
  const sanitizeLinesForWarehouse = useCallback(
    (currentLines: DraftLine[], warehouseCode: string) => {
      const normalizedWarehouse = normalizeWarehouseCode(warehouseCode);
      if (!normalizedWarehouse) {
        return { filteredLines: currentLines, removedCount: 0 };
      }
      let removedCount = 0;
      const filteredLines = currentLines.filter((line) => {
        const sku = line.productSku?.trim();
        if (!sku) {
          return true;
        }
        const product = products.find((entry) => entry.sku === sku);
        if (!product) {
          removedCount += 1;
          return false;
        }
        const available = getWarehouseAvailableStock(product, normalizedWarehouse);
        if (available <= 0) {
          removedCount += 1;
          return false;
        }
        return true;
      });
      return { filteredLines, removedCount };
    },
    [getWarehouseAvailableStock, products],
  );
  const scheduleWarehouseChange = useCallback(
    (code: string, options?: { showToast?: boolean }) => {
      warehouseChangeMetaRef.current = {
        code,
        showToast: options?.showToast ?? hasSelectedWarehouseRef.current,
      };
      setSelectedWarehouseCode(code);
    },
    [setSelectedWarehouseCode],
  );

  const lineSummaries = useMemo<LineSummary[]>(() => {
    return lines.map((line) => {
      const quantity = Number(line.quantity) || 0;
      const unitPrice = Number(line.unitPrice) || 0;
      const rawAmount = quantity * unitPrice;
      const taxType = taxTypes.find((type) => type.id === line.taxTypeId) ?? null;
      let base = roundToWon(rawAmount);
      let tax = 0;
      let total = base;

      if (taxType && taxType.rate > 0) {
        if (taxType.mode === 'exclusive') {
          tax = roundToWon(base * taxType.rate);
          total = base + tax;
        } else {
          const divisor = 1 + taxType.rate;
          base = roundToWon(rawAmount / divisor);
          tax = roundToWon(rawAmount - base);
          total = base + tax;
        }
      }

      return {
        lineId: line.id,
        base,
        tax,
        total,
        taxType,
      };
    });
  }, [lines, taxTypes]);

  const totals = useMemo(() => {
    const baseTotal = lineSummaries.reduce((sum, entry) => sum + entry.base, 0);
    const lineTotal = lineSummaries.reduce((sum, entry) => sum + entry.total, 0);
    const taxTotal = lineSummaries.reduce((sum, entry) => sum + entry.tax, 0);
    const breakdownMap = new Map<string, TaxBreakdownEntry>();

    lineSummaries.forEach(({ taxType, base, tax }) => {
      if (!taxType || tax === 0) {
        return;
      }
      const existing = breakdownMap.get(taxType.id);
      if (existing) {
        existing.base += base;
        existing.amount += tax;
      } else {
        breakdownMap.set(taxType.id, { taxType, base, amount: tax });
      }
    });

    return {
      lineTotal,
      baseTotal,
      taxTotal,
      total: baseTotal + taxTotal,
      taxBreakdown: Array.from(breakdownMap.values()),
    };
  }, [lineSummaries]);

  const lineSummaryMap = useMemo(() => {
    return new Map<string, LineSummary>(lineSummaries.map((entry) => [entry.lineId, entry]));
  }, [lineSummaries]);

  const buildSanitizedLines = useCallback(() => {
    return lines
      .map((line) => {
        const qty = Math.max(0, Math.round(Number(line.quantity) || 0));
        if (!line.productSku || qty <= 0) {
          return null;
        }
        const summary = lineSummaryMap.get(line.id);
        const selectedProduct = products.find((product) => product.sku === line.productSku) ?? null;
        const parsedUnitPrice = Number(line.unitPrice);
        const unitPrice = Number.isFinite(parsedUnitPrice) ? Math.round(parsedUnitPrice) : undefined;
        const amount = summary ? summary.total : Math.round(qty * (unitPrice ?? 0));
        const taxAmount = summary ? summary.tax : undefined;
        const taxType = summary?.taxType;
        const taxLabel = taxType
          ? `${taxType.name} (${(taxType.rate * 100).toFixed(0)}% ${
              taxType.mode === 'inclusive' ? '포함' : '별도'
            })`
          : undefined;
        return {
          sku: line.productSku,
          orderedQty: qty,
          productName: line.productName?.trim() || selectedProduct?.name,
          unit: selectedProduct?.unit ?? undefined,
          unitPrice,
          amount,
          taxAmount,
          taxLabel,
          currency: selectedProduct?.currency ?? undefined,
          taxTypeId: line.taxTypeId ?? undefined,
        };
      })
      .filter((entry): entry is CreateSalesOrderLine => Boolean(entry));
  }, [lineSummaryMap, lines, products]);

  const restoreDraftState = useCallback(
    (draft: SalesOrderDraft, overrideDraftId?: string | null) => {
      setCustomer(draft.customer || '');
      setOrderNumber(draft.orderNumber || '');
      setOrderDate(ensureDatetimeLocalValue(draft.orderDate));
      setShipmentDate(toDateInputValue(draft.shipmentDate));
      setMemo(draft.memo || '');
      setShippingMode(draft.shippingMode || '즉시출고');
      setShippingNote(draft.shippingNote || '');
      scheduleWarehouseChange(draft.warehouse || '', { showToast: false });
      setDraftId(overrideDraftId ?? draft.draftId ?? null);
      setLines(draft.lines && draft.lines.length ? draft.lines : [createEmptyLine()]);
    },
    [
      setCustomer,
      setOrderNumber,
      setOrderDate,
      setShipmentDate,
      setMemo,
      setShippingMode,
      setShippingNote,
      scheduleWarehouseChange,
      setDraftId,
      setLines,
    ],
  );

  const updateLine = (lineId: string, updater: (line: DraftLine) => DraftLine) => {
    setLines((prev) => prev.map((line) => (line.id === lineId ? updater(line) : line)));
  };

  const handleAddLine = () => {
    const defaultTaxId = taxTypes.find((type) => type.isDefault)?.id ?? null;
    setLines((prev) => [...prev, createEmptyLine(defaultTaxId)]);
  };

  const handleRemoveLine = (lineId: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((line) => line.id !== lineId) : prev));
  };

  const handleSaveDraft = useCallback(async () => {
    if (!customer) {
      showToast('고객을 선택하세요.', { tone: 'error' });
      return;
    }

    const sanitizedLines = buildSanitizedLines();
    if (!sanitizedLines.length) {
      showToast('최소 한 개 이상의 품목을 등록하세요.', { tone: 'error' });
      return;
    }

    const normalizedOrderNumber = orderNumber.trim();
    const normalizedOrderDateIso = convertToIsoTimestamp(orderDate);
    const selectedPartner = partners.find((entry) => entry.id === customer);
    setSavingDraft(true);
    const payload = {
      customerId: customer,
      customerName: selectedPartner?.name,
      orderNumber: normalizedOrderNumber || undefined,
      orderDate: normalizedOrderDateIso || undefined,
      memo: memo || shippingNote || undefined,
      promisedDate: convertToIsoTimestamp(shipmentDate) || undefined,
      shippingMode,
      shippingNote: shippingNote || undefined,
      warehouse: selectedWarehouseCode || undefined,
      lines: sanitizedLines,
    };

    const buildStoredDraft = (id: string): SalesOrderDraft => ({
      customer,
      orderNumber,
      orderDate,
      shipmentDate,
      memo,
      shippingMode,
      shippingNote,
      warehouse: selectedWarehouseCode,
      lines,
      draftId: id,
    });

    const finalizeDraftSave = (savedDraft: SalesOrder) => {
      const storedDraft = buildStoredDraft(savedDraft.id);
      persistDraftToStorage(storedDraft);
      setDraftId(savedDraft.id);
      setIsServerDraftLoaded(true);
      showToast('임시 저장되었습니다.', { tone: 'success' });
    };

    const attemptSave = () =>
      draftId ? updateSalesOrderDraft(draftId, payload) : createSalesOrderDraft(payload);

    try {
      const savedDraft = await attemptSave();
      finalizeDraftSave(savedDraft);
    } catch (error) {
      if (
        draftId &&
        error instanceof Error &&
        error.message.includes('주문서를 찾을 수 없습니다.')
      ) {
        setDraftId(null);
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(DRAFT_STORAGE_KEY);
        }
        try {
          const savedDraft = await createSalesOrderDraft(payload);
          finalizeDraftSave(savedDraft);
          return;
        } catch (fallbackError) {
          console.error('Failed to save draft', fallbackError);
          const description =
            fallbackError instanceof Error ? fallbackError.message : undefined;
          showToast('임시 저장에 실패했습니다.', { tone: 'error', description });
          return;
        }
      }
      console.error('Failed to save draft', error);
      const description = error instanceof Error ? error.message : undefined;
      showToast('임시 저장에 실패했습니다.', { tone: 'error', description });
    } finally {
      setSavingDraft(false);
    }
  }, [
    customer,
    orderNumber,
    orderDate,
    shipmentDate,
    memo,
    shippingMode,
    shippingNote,
    selectedWarehouseCode,
    lines,
    partners,
    draftId,
    buildSanitizedLines,
    showToast,
    createSalesOrderDraft,
    updateSalesOrderDraft,
  ]);

  const buildShipmentOccurredAt = () => {
    return (
      convertToIsoTimestamp(shipmentDate) ??
      convertToIsoTimestamp(orderDate) ??
      new Date().toISOString()
    );
  };

  const recordImmediateShipments = useCallback(
    async (order: SalesOrder): Promise<number> => {
      const normalizedWarehouse = selectedWarehouseCode.trim();
      if (!normalizedWarehouse) {
        throw new Error('즉시출고 시 창고를 선택해주세요.');
      }
      const occurredAt = buildShipmentOccurredAt();
      const memo = shippingNote.trim() || undefined;
      const payloads: CreateMovementPayload[] = order.lines
        .map((line) => {
          const pendingQty = Math.max(0, Math.round(line.orderedQty - (line.shippedQty ?? 0)));
          if (pendingQty <= 0) {
            return null;
          }
          return {
            type: 'ISSUE',
            sku: line.sku,
            qty: pendingQty,
            fromWarehouse: normalizedWarehouse,
            partnerId: order.customerId,
            refNo: order.id,
            memo,
            occurredAt,
            userId: SHIPMENT_MOVEMENT_USER_ID,
            soId: order.id,
            soLineId: line.id,
          };
        })
        .filter((entry): entry is CreateMovementPayload => Boolean(entry));

      if (!payloads.length) {
        return 0;
      }

      await Promise.all(payloads.map((payload) => submitMovement(payload)));
      return payloads.length;
    },
    [shipmentDate, orderDate, shippingNote, selectedWarehouseCode],
  );

  const handleConfirmOrder = useCallback(async () => {
    if (!customer) {
      showToast('고객을 선택하세요.', { tone: 'error' });
      return;
    }
    const sanitizedLines = buildSanitizedLines();

    if (!sanitizedLines.length) {
      showToast('최소 한 개 이상의 품목을 등록하세요.', { tone: 'error' });
      return;
    }

    const normalizedOrderNumber = orderNumber.trim();
    const normalizedOrderDateIso = convertToIsoTimestamp(orderDate);
    const selectedPartner = partners.find((entry) => entry.id === customer);
    const isImmediateMode = shippingMode === '즉시출고';
    if (isImmediateMode && !selectedWarehouseCode.trim()) {
      showToast('즉시출고 시 창고를 선택해주세요.', { tone: 'error' });
      return;
    }
    setSubmittingOrder(true);
    try {
      const order = await createSalesOrder({
        customerId: customer,
        customerName: selectedPartner?.name,
        orderNumber: normalizedOrderNumber || undefined,
        orderDate: normalizedOrderDateIso || undefined,
        memo: memo || shippingNote || undefined,
        promisedDate: convertToIsoTimestamp(shipmentDate) || undefined,
        lines: sanitizedLines,
      });
      if (selectedWarehouseCode.trim()) {
        persistOrderWarehouse(order.id, {
          code: selectedWarehouseCode,
          name: selectedWarehouse?.name ?? null,
        });
      }
      let immediateShipmentCount = 0;
      if (isImmediateMode) {
        immediateShipmentCount = await recordImmediateShipments(order);
      }
      const previousDraftId = draftId;
      if (previousDraftId) {
        try {
          await deleteSalesOrderDraft(previousDraftId);
        } catch (deleteError) {
          console.error('Failed to delete draft after order confirm', deleteError);
        }
      }
      setDraftId(null);
      window.localStorage.removeItem(DRAFT_STORAGE_KEY);
      const successMessage =
        isImmediateMode && immediateShipmentCount > 0
          ? `주문 등록 및 즉시출고 ${immediateShipmentCount.toLocaleString()}건이 기록되었습니다.`
          : '주문이 등록되었습니다.';
      showToast(successMessage, { tone: 'success' });
      navigate('/sales-orders', { replace: true });
    } catch (error) {
      console.error('Failed to create sales order', error);
      showToast('주문 확정에 실패했습니다.', {
        tone: 'error',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSubmittingOrder(false);
    }
  }, [
    shipmentDate,
    buildSanitizedLines,
    memo,
    navigate,
    orderNumber,
    partners,
    shippingMode,
    recordImmediateShipments,
    showToast,
    customer,
    selectedWarehouseCode,
    deleteSalesOrderDraft,
    draftId,
  ]);

  const handleGoBack = useCallback(() => {
    navigate('/sales-orders', { replace: true });
  }, [navigate]);

  const loadTaxTypes = useCallback(async () => {
    setTaxLoading(true);
    setTaxLoadError(null);
    try {
      const items = await listTaxTypes();
      setTaxTypes(items);
    } catch (error) {
      console.error('Failed to load tax types', error);
      setTaxLoadError('세금 목록을 불러오는 중 오류가 발생했습니다.');
    } finally {
      setTaxLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTaxTypes();
  }, [loadTaxTypes]);

  const defaultTaxTypeId = useMemo(() => taxTypes.find((type) => type.isDefault)?.id ?? null, [taxTypes]);

  useEffect(() => {
    if (!defaultTaxTypeId) {
      return;
    }
    setLines((prev) =>
      prev.map((line) =>
        line.taxTypeId ? line : { ...line, taxTypeId: defaultTaxTypeId },
      ),
    );
  }, [defaultTaxTypeId]);

  const taxDropdownOptions = useMemo<ComboboxOption[]>(() => {
    const base = taxTypes.map((taxType) => ({
      label: `${taxType.name} (${(taxType.rate * 100).toFixed(0)}%${taxType.mode === 'inclusive' ? ' 포함' : ''})`,
      value: taxType.id,
    }));

    return [
      { label: '없음', value: '' },
      ...base,
      { label: '+ 추가하기', value: TAX_ADD_KEY },
    ];
  }, [taxTypes]);

  const handleTaxSelectChange = (lineId: string, value: string) => {
    if (value === TAX_ADD_KEY) {
      setPendingTaxLineId(lineId);
      setTaxModalOpen(true);
      return;
    }
    updateLine(lineId, (current) => ({ ...current, taxTypeId: value || null }));
  };

  const resetTaxModal = useCallback(() => {
    setTaxModalOpen(false);
    setPendingTaxLineId(null);
    setNewTaxName('');
    setNewTaxRate('0');
    setNewTaxMode('exclusive');
    setTaxNameError(null);
    setTaxRateError(null);
  }, []);

  const handleCreateTax = useCallback(async () => {
    const trimmedName = newTaxName.trim();
    const rateValue = Number(newTaxRate);
    if (!trimmedName) {
      setTaxNameError('세금명을 입력해 주세요.');
      return;
    }
    setTaxNameError(null);
    if (!Number.isFinite(rateValue) || rateValue < 0 || rateValue > 100) {
      setTaxRateError('세율은 0~100 사이여야 합니다.');
      return;
    }
    setTaxRateError(null);

    setTaxCreating(true);
    try {
      const created = await createTaxType({
        name: trimmedName,
        rate: rateValue / 100,
        mode: newTaxMode,
      });
      setTaxTypes((prev) => [...prev, created]);
      showToast('세금이 추가되었습니다.', { tone: 'success' });
      const targetLineId = pendingTaxLineId;
      resetTaxModal();
      if (targetLineId) {
        updateLine(targetLineId, (current) => ({ ...current, taxTypeId: created.id }));
      }
    } catch (error) {
      console.error('Failed to create tax type', error);
      showToast('세금 추가에 실패했습니다.', {
        tone: 'error',
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setTaxCreating(false);
    }
  }, [
    newTaxMode,
    newTaxName,
    newTaxRate,
    pendingTaxLineId,
    resetTaxModal,
    showToast,
  ]);

  const formatProductOptionLabel = useCallback(
    (product: Product) => {
      if (!selectedWarehouseCode) {
        return `${product.name} (${product.sku})`;
      }
      const available = getWarehouseAvailableStock(product, selectedWarehouseCode);
      const amountLabel = available.toLocaleString('ko-KR');
      const unitLabel = product.unit ? ` ${product.unit}` : '';
      return `${product.name} (${product.sku}) · 가용재고 ${amountLabel}${unitLabel}`;
    },
    [getWarehouseAvailableStock, selectedWarehouseCode],
  );

  const handleProductSelection = (lineId: string, sku: string) => {
    const selection = products.find((product) => product.sku === sku);
    updateLine(lineId, (current) => ({
      ...current,
      productSku: sku,
      productName: selection ? selection.name : current.productName,
      unitPrice: selection?.supplyPrice != null ? formatPriceInput(selection.supplyPrice) : current.unitPrice,
    }));
  };

  const suggestOrderNumber = useCallback(async () => {
    setOrderNumberLoading(true);
    setOrderNumberError(null);
    try {
      const orderDateIso = convertToIsoTimestamp(orderDate);
      if (!orderDateIso) {
        throw new Error('주문일을 선택해 주세요.');
      }
      const suggestion = await getNextSalesOrderNumber(orderDateIso);
      setOrderNumber(suggestion.orderNumber);
    } catch (error) {
      console.error('Failed to suggest order number', error);
      setOrderNumberError(
        error instanceof Error ? error.message : '주문 번호 자동 추천에 실패했습니다. 다시 시도해 주세요.',
      );
    } finally {
      setOrderNumberLoading(false);
    }
  }, [orderDate]);

  const loadPartners = useCallback(async () => {
    setPartnerLoading(true);
    try {
      const items = await listPartners({ type: 'CUSTOMER' });
      setPartners(items);
    } catch (error) {
      console.error('Failed to load partners', error);
    } finally {
      setPartnerLoading(false);
    }
  }, []);

  const loadProducts = useCallback(async () => {
    hasAttemptedProductLoadRef.current = true;
    setProductLoading(true);
    try {
      const items = await fetchProducts();
      setProducts(items);
    } catch (error) {
      console.error('Failed to load products', error);
    } finally {
      setProductLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPartners();
  }, [loadPartners]);

  useEffect(() => {
    void loadProducts();
  }, [loadProducts]);

  const loadWarehouses = useCallback(async () => {
    setWarehouseLoading(true);
    try {
      const response = await fetchWarehouses({ pageSize: 100 });
      setWarehouses(response.items);
    } catch (error) {
      console.error('Failed to load warehouses', error);
    } finally {
      setWarehouseLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWarehouses();
  }, [loadWarehouses]);

  useEffect(() => {
    const pendingChange = warehouseChangeMetaRef.current;
    if (!pendingChange.code) {
      return;
    }
    if (!hasAttemptedProductLoadRef.current) {
      return;
    }
    if (productLoading) {
      return;
    }
    const defaultTaxId = taxTypes.find((type) => type.isDefault)?.id ?? null;
    let removedCount = 0;
    setLines((prev) => {
      const { filteredLines, removedCount: count } = sanitizeLinesForWarehouse(prev, pendingChange.code);
      removedCount = count;
      return filteredLines.length ? filteredLines : [createEmptyLine(defaultTaxId)];
    });
    if (pendingChange.showToast && removedCount > 0) {
      showToast(
        `선택된 창고에 재고가 없는 ${removedCount.toLocaleString()}개의 품목을 제거했습니다.`,
        { tone: 'info' },
      );
    }
    hasSelectedWarehouseRef.current = true;
    warehouseChangeMetaRef.current = { code: '', showToast: false };
  }, [productLoading, sanitizeLinesForWarehouse, selectedWarehouseCode, showToast, taxTypes]);

  const selectedWarehouse = useMemo(
    () => warehouses.find((entry) => entry.code === selectedWarehouseCode) ?? null,
    [selectedWarehouseCode, warehouses],
  );

  const hasProductsWithQty = useMemo(
    () => lines.some((line) => {
      const hasSku = Boolean(line.productSku?.trim());
      const quantity = Number(line.quantity);
      return hasSku && quantity > 0;
    }),
    [lines],
  );

  const availableProducts = useMemo(() => {
    if (!selectedWarehouseCode) {
      return [];
    }
    return products.filter((product) => getWarehouseAvailableStock(product, selectedWarehouseCode) > 0);
  }, [getWarehouseAvailableStock, products, selectedWarehouseCode]);
  const hasAvailableProducts = availableProducts.length > 0;
  const isProductSelectionLocked = !selectedWarehouseCode;
  const canConfirmOrder = Boolean(selectedWarehouseCode && hasProductsWithQty);
  const productSelectPlaceholder = productLoading
    ? '상품 목록을 불러오는 중입니다...'
    : isProductSelectionLocked
      ? '먼저 출고 창고를 선택해 주세요.'
      : hasAvailableProducts
        ? '제품을 선택하세요'
        : '해당 창고에 보유 중인 상품이 없습니다.';
  const productSelectionOptions = useMemo(
    () =>
      availableProducts.map((product) => ({
        label: formatProductOptionLabel(product),
        value: product.sku,
      })),
    [availableProducts, formatProductOptionLabel],
  );

  const handleWarehouseSelectChange = useCallback(
    (nextCode: string) => {
      if (nextCode === selectedWarehouseCode) {
        return;
      }
      scheduleWarehouseChange(nextCode);
    },
    [scheduleWarehouseChange, selectedWarehouseCode],
  );

  const isWarehouseEnabled = !warehouseLoading;
  const isImmediate = shippingMode === '즉시출고';

  useEffect(() => {
    if (isImmediate) {
      setShipmentDate(toDateInputValue(orderDate));
    }
  }, [isImmediate, orderDate]);

  useEffect(() => {
    if (typeof window === 'undefined' || isServerDraftLoaded || draftIdParam) {
      return;
    }

    const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) {
      return;
    }

    let isActive = true;

    const parsed = JSON.parse(raw) as SalesOrderDraft;

    const applyLocalDump = (draft: SalesOrderDraft, keepDraftId: boolean) => {
      restoreDraftState(draft, keepDraftId ? undefined : null);
      persistDraftToStorage(draft, keepDraftId ? draft.draftId ?? null : null);
    };

    if (!parsed.draftId) {
      applyLocalDump(parsed, true);
      return;
    }

    void (async () => {
      try {
        const record = await getSalesOrderDraft(parsed.draftId);
        if (!isActive) {
          return;
        }
        const payload = convertRecordToDraft(record);
        restoreDraftState(payload);
        persistDraftToStorage(payload);
        setIsServerDraftLoaded(true);
      } catch (error) {
        if (!isActive) {
          return;
        }
        console.error('Failed to load sales order draft', error);
        applyLocalDump(parsed, false);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [draftIdParam, getSalesOrderDraft, isServerDraftLoaded, restoreDraftState]);

  useEffect(() => {
    if (!draftIdParam) {
      return;
    }

    let isActive = true;

    void (async () => {
      try {
        const record = await getSalesOrderDraft(draftIdParam);
        if (!isActive) {
          return;
        }
        const payload = convertRecordToDraft(record);

        restoreDraftState(payload);
        persistDraftToStorage(payload);
        setIsServerDraftLoaded(true);
      } catch (error) {
        console.error('Failed to load sales order draft', error);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [draftIdParam, getSalesOrderDraft, restoreDraftState, setIsServerDraftLoaded]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">판매 주문</p>
          <h1 className="mt-1 text-3xl font-semibold text-slate-900">주문서</h1>
          <p className="mt-2 text-sm text-slate-500">고객을 선택하고 주문 내역을 입력하세요. 초안은 언제든지 다시 편집할 수 있습니다.</p>
        </div>
        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            목록으로
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">고객</h2>
            <p className="text-sm text-slate-500">고객 마스터에 등록된 정보를 기반으로 주문이 생성됩니다.</p>
          </div>
          <button type="button" className="text-sm font-semibold text-indigo-600">신규 고객 등록</button>
        </header>
        <div className="mt-4 max-w-xl">
          <label htmlFor="customer" className="text-sm font-medium text-slate-700">고객 선택</label>
          <SelectDropdown
            id="customer"
            className="mt-1"
            value={customer}
            onChange={(next) => setCustomer(next)}
            options={partnerOptions}
            placeholder={partnerLoading ? '고객을 불러오는 중입니다...' : '고객을 선택하세요'}
            emptyMessage={
              partnerLoading ? '고객을 불러오는 중입니다...' : '등록된 고객이 없습니다.'
            }
            helperText="고객 마스터에 등록된 업체를 고르세요."
            inputClassName="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none"
            disabled={partnerLoading && partnerOptions.length === 0}
          />
        </div>
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">주문 정보</h2>
          <div className="mt-4 space-y-4 text-sm">
            <div>
              <label className="block text-sm font-medium text-slate-700">주문 번호</label>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={orderNumber}
                  onChange={(event) => setOrderNumber(event.target.value.toUpperCase())}
                  placeholder="예: SO-20251110-001"
                  className="flex-1 rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={suggestOrderNumber}
                  disabled={orderNumberLoading}
                  className="rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 transition hover:bg-indigo-700 disabled:bg-indigo-400"
                >
                  {orderNumberLoading ? '추천 중…' : '자동 추천'}
                </button>
              </div>
              {orderNumberError && (
                <p className="mt-1 text-xs text-rose-600">{orderNumberError}</p>
              )}
              <p className="mt-1 text-xs text-slate-500">
                자동 추천된 주문번호는 서버에서 중복 검증되며, 수동 입력보다 자동 추천을 우선 사용하시길 권장합니다.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-slate-700">주문일</label>
                <input
                  type="datetime-local"
                  step="60"
                  value={orderDate}
                  onChange={(event) => setOrderDate(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700">출고 예정일</label>
                <input
                  type="date"
                  value={shipmentDate}
                  onChange={(event) => setShipmentDate(event.target.value)}
                  disabled={isImmediate}
                  className={`mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none ${
                    isImmediate ? 'cursor-not-allowed bg-slate-50 text-slate-400' : ''
                  }`}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-base font-semibold text-slate-900">출고 설정</h2>
          <div className="mt-4 space-y-4 text-sm">
            <div>
              <label className="block text-sm font-medium text-slate-700">출고 방식</label>
              <SelectDropdown
                className="mt-1"
                value={shippingMode}
                onChange={(next) => setShippingMode(next)}
                options={shippingModeOptions}
                placeholder="출고 방식 선택"
                helperText="즉시출고는 주문 확정과 동시에 재고를 차감합니다."
                inputClassName="w-full rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-500">
                즉시출고는 주문 확정과 동시에 재고가 차감되며, 예약출고는 출고 처리 전까지 재고에 반영되지 않습니다.
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">메모</label>
              <textarea
                value={shippingNote}
                onChange={(event) => setShippingNote(event.target.value)}
                rows={3}
                placeholder="창고팀 전달 사항을 입력하세요"
                className="mt-1 w-full rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700">창고 선택</label>
              <SelectDropdown
                className="mt-1"
                value={selectedWarehouseCode}
                onChange={handleWarehouseSelectChange}
                options={warehouseOptions}
                disabled={!isWarehouseEnabled || warehouseLoading}
                placeholder={warehouseLoading ? '창고 목록을 불러오는 중입니다...' : '창고를 선택하세요'}
                emptyMessage={
                  warehouseLoading ? '창고 목록을 불러오는 중입니다...' : '등록된 창고가 없습니다.'
                }
                helperText="출고를 수행할 창고를 선택하세요."
                inputClassName={`w-full rounded-xl border border-slate-300 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none ${
                  !isWarehouseEnabled || warehouseLoading ? 'cursor-not-allowed bg-slate-50 text-slate-400' : ''
                }`}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">제품 선택</h2>
            {isProductSelectionLocked ? (
              <p className="mt-1 text-xs font-semibold text-rose-600">먼저 출고 창고를 선택해 주세요.</p>
            ) : (
              selectedWarehouse && (
                <p className="mt-1 text-xs text-slate-500">
                  현재 선택된 창고: {selectedWarehouse.name} ({selectedWarehouse.code}) 기준의 가용재고만 보여집니다.
                  0 재고 상품은 목록에서 숨김 처리됩니다.
                </p>
              )
            )}
          </div>
        </div>

          <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-3">
            {!productLoading && selectedWarehouse && !hasAvailableProducts ? (
              <p className="rounded-md border border-dashed border-rose-200 bg-rose-50 p-3 text-xs text-rose-600">
                선택한 창고에 가용재고가 있는 상품이 없습니다.
              </p>
            ) : null}
            <div className="rounded-xl border border-slate-200">
                  <table className="min-w-full divide-y divide-slate-200 text-sm table-fixed">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 text-left w-[280px]">제품</th>
                        <th className="px-4 py-3 text-left w-28">SKU</th>
                        <th className="px-4 py-3 text-left w-32">세금</th>
                        <th className="px-4 py-3 text-right w-28">수량</th>
                        <th className="px-4 py-3 text-right w-36">구매가</th>
                        <th className="px-4 py-3 text-right w-32">금액</th>
                        <th className="px-4 py-3 text-center w-20">삭제</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((line, index) => {
                        const quantity = Number(line.quantity) || 0;
                        const unitPrice = Number(line.unitPrice) || 0;
                        const selectedProduct = products.find((product) => product.sku === line.productSku) ?? null;
                        const summary = lineSummaryMap.get(line.id);
                        const displayedAmount = summary ? summary.total : Math.round(quantity * unitPrice);
                        return (
                          <tr key={line.id} className={index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}>
                            <td className="px-4 py-3">
                              <SelectDropdown
                                className="w-full"
                                value={line.productSku}
                                onChange={(next) => handleProductSelection(line.id, next)}
                                options={productSelectionOptions}
                                placeholder={productSelectPlaceholder}
                                emptyMessage={productSelectPlaceholder}
                                helperText="선택한 창고 기준으로 재고가 있는 상품만 표시됩니다."
                                inputClassName={`w-full rounded-md border border-slate-200 px-2 py-1 text-sm focus:border-indigo-500 focus:outline-none ${
                                  productLoading || isProductSelectionLocked
                                    ? 'cursor-not-allowed bg-slate-50 text-slate-500'
                                    : ''
                                }`}
                                disabled={productLoading || isProductSelectionLocked}
                              />
                      {selectedProduct && (
                        <p className="mt-1 text-xs text-slate-500">
                          가용재고: {getWarehouseAvailableStock(selectedProduct, selectedWarehouseCode).toLocaleString('ko-KR')}{' '}
                          {selectedProduct.unit ?? ''}
                        </p>
                      )}
                            </td>
                            <td className="px-4 py-3 text-slate-600">
                              {selectedProduct?.sku ?? '—'}
                            </td>
                            <td className="px-4 py-3">
                              <SelectDropdown
                                className="w-full"
                                value={line.taxTypeId ?? ''}
                                onChange={(next) => handleTaxSelectChange(line.id, next)}
                                options={taxDropdownOptions}
                                placeholder="세금 유형 선택"
                                emptyMessage={taxLoading ? '세금 목록을 불러오는 중입니다...' : '세금 유형을 선택하세요'}
                                inputClassName="w-full rounded-md border border-slate-200 px-2 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                                disabled={taxLoading}
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <input
                                type="number"
                                min="0"
                                value={line.quantity}
                                onChange={(event) =>
                                  updateLine(line.id, (current) => ({ ...current, quantity: event.target.value }))
                                }
                                className="w-full rounded-md border border-slate-200 px-2 py-1 text-right text-sm focus:border-indigo-500 focus:outline-none"
                              />
                            </td>
                            <td className="px-4 py-3 text-right">
                              <input
                                type="text"
                                value={formatSalesPriceForDisplay(line.unitPrice)}
                                onChange={(event) =>
                                  updateLine(line.id, (current) => ({
                                    ...current,
                                    unitPrice: normalizeSalesPriceEntry(event.target.value),
                                  }))
                                }
                                className="w-full rounded-md border border-slate-200 px-2 py-1 text-right text-sm focus:border-indigo-500 focus:outline-none"
                              />
                            </td>
                            <td className="px-4 py-3 text-right font-semibold text-slate-800">
                              {formatCurrency(displayedAmount)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <button
                                type="button"
                                onClick={() => handleRemoveLine(line.id)}
                                className="text-xs font-semibold text-rose-600 hover:text-rose-500"
                                disabled={lines.length <= 1}
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
            <button
              type="button"
              onClick={handleAddLine}
              disabled={isProductSelectionLocked}
              className="rounded-xl border border-dashed border-slate-300 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
            >
              + 품목 추가
            </button>
          </div>

            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-5 text-sm">
              {taxLoadError && <p className="text-xs text-rose-600">{taxLoadError}</p>}
              <dl className="space-y-3">
                <div className="flex justify-between text-slate-600">
                  <dt>소계</dt>
                  <dd>{formatCurrency(totals.lineTotal)}</dd>
                </div>
                <div className="flex justify-between text-slate-600">
                  <dt>총액 (세금 제외)</dt>
                  <dd>{formatCurrency(totals.baseTotal)}</dd>
                </div>
                {totals.taxBreakdown.map((entry) => (
                  <div key={entry.taxType.id} className="flex items-center justify-between text-slate-600">
                    <dt className="text-xs text-slate-600">
                      {entry.taxType.name} ({formatCurrency(entry.base)}에 대한 {(entry.taxType.rate * 100).toFixed(0)}%
                      {entry.taxType.mode === 'inclusive' ? ' 포함' : ''})
                    </dt>
                    <dd className="text-slate-800">{formatCurrency(entry.amount)}</dd>
                  </div>
                ))}
                <div className="flex justify-between text-base font-semibold text-slate-900">
                  <dt>총액</dt>
                  <dd>{formatCurrency(totals.total)}</dd>
                </div>
              </dl>
            </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleGoBack}
          className="rounded-md border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          뒤로가기
        </button>
        <button
          type="button"
          onClick={handleSaveDraft}
          disabled={savingDraft}
          className="rounded-md border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed"
        >
          {savingDraft ? '임시 저장 중…' : '임시 저장'}
        </button>
        <button
          type="button"
          onClick={handleConfirmOrder}
          disabled={submittingOrder || !canConfirmOrder}
          className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-700 disabled:bg-indigo-500 disabled:cursor-not-allowed"
        >
          {submittingOrder ? '주문 확정 중…' : '주문 확정'}
        </button>
      </div>
      <Modal isOpen={taxModalOpen} onClose={resetTaxModal} title="세금 추가">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreateTax();
          }}
          className="space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700">이름</label>
            <input
              type="text"
              value={newTaxName}
              onChange={(event) => setNewTaxName(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none"
            />
            {taxNameError && <p className="text-xs text-rose-600">{taxNameError}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">세율</label>
            <div className="mt-1 flex gap-2">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={newTaxRate}
                onChange={(event) => setNewTaxRate(event.target.value)}
                className="w-24 rounded-xl border border-slate-200 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none"
              />
              <span className="px-2 py-2 text-sm text-slate-500">%</span>
              <SelectDropdown
                value={newTaxMode}
                onChange={(next) => setNewTaxMode(next as TaxMode)}
                options={taxModeOptions}
                placeholder="세율 적용 방식"
                inputClassName="rounded-xl border border-slate-200 px-4 py-2 text-sm focus:border-indigo-500 focus:outline-none"
                className="flex-1"
              />
            </div>
            {taxRateError && <p className="text-xs text-rose-600">{taxRateError}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={resetTaxModal} className="rounded-xl border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600">
              취소
            </button>
            <button
              type="submit"
              disabled={taxCreating}
              className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-500/30 hover:bg-indigo-700 disabled:bg-indigo-500"
            >
              {taxCreating ? '저장 중…' : '등록'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default NewSalesOrderPage;
