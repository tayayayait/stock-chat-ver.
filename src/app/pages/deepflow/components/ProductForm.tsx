import React, { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import { DEFAULT_UNIT_OPTIONS, generateSku, type Product } from '../../../../domains/products';
import { type Category } from '../../../../services/categories';
import { validateProductDraft } from '../productValidation';
import { useCategoryStore } from '../stores/categoryStore';
import Combobox from '../../../../components/common/Combobox';
import SelectDropdown from '../../../../components/common/SelectDropdown';

export interface ProductFormProps {
  row: Product;
  onChange: (row: Product) => void;
  existingSkus: string[];
}

const ProductForm: React.FC<ProductFormProps> = ({ row, onChange, existingSkus }) => {
  const {
    items: categoryTree,
    loading: categoriesLoading,
    error: categoriesError,
    load: loadCategories,
  } = useCategoryStore();

  useEffect(() => {
    if (!categoriesLoading && categoryTree.length === 0) {
      void loadCategories().catch(() => undefined);
    }
  }, [categoriesLoading, categoryTree.length, loadCategories]);

  const { categoryOptions, selectedSubCategoryOptions } = useMemo(() => {
    const categories = new Set<string>();
    const normalizedTarget = row.category.trim().toLowerCase();
    let resolvedCategory: Category | null = null;

    const traverse = (nodes: Category[], depth: number) => {
      nodes.forEach((node) => {
        const name = node.name.trim();
        if (!name) {
          return;
        }
        if (depth === 0) {
          categories.add(name);
        }
        if (!resolvedCategory && name.toLowerCase() === normalizedTarget) {
          resolvedCategory = node;
        }
        if (node.children.length > 0) {
          traverse(node.children, depth + 1);
        }
      });
    };

    traverse(categoryTree, 0);

    const subCategoryNames = resolvedCategory
      ? resolvedCategory.children
          .map((child) => child.name.trim())
          .filter((childName) => childName.length > 0)
      : [];

    return {
      categoryOptions: Array.from(categories).sort((a, b) => a.localeCompare(b)),
      selectedSubCategoryOptions: Array.from(new Set(subCategoryNames)).sort((a, b) =>
        a.localeCompare(b),
      ),
    };
  }, [categoryTree, row.category]);

  const duplicateSku = useMemo(() => {
    const normalized = row.sku.trim().toUpperCase();
    if (!normalized) {
      return false;
    }
    return existingSkus.some((value) => value.trim().toUpperCase() === normalized);
  }, [existingSkus, row.sku]);

  const updateRow = useCallback(
    (patch: Partial<Product>) => {
      onChange({ ...row, ...patch });
    },
    [onChange, row],
  );

  const previousCategoryRef = useRef(row.category);
  useEffect(() => {
    const normalizedPrevious = previousCategoryRef.current.trim().toLowerCase();
    const normalizedCurrent = row.category.trim().toLowerCase();
    if (normalizedPrevious === normalizedCurrent) {
      return;
    }
    previousCategoryRef.current = row.category;

    if (!row.subCategory.trim()) {
      return;
    }

    const allowed = new Set(selectedSubCategoryOptions.map((option) => option.toLowerCase()));
    if (!allowed.has(row.subCategory.trim().toLowerCase())) {
      updateRow({ subCategory: '' });
    }
  }, [row.category, row.subCategory, selectedSubCategoryOptions, updateRow]);

  const skuInputId = useId();
  const nameInputId = useId();
  const categoryListId = useId();
  const subCategoryInputId = useId();

  const inputClassName =
    'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm shadow-sm placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200';

  const handleSkuGenerate = useCallback(() => {
    const generated = generateSku(existingSkus);
    updateRow({ sku: generated });
  }, [existingSkus, updateRow]);

  const handleOptionalNumberChange = useCallback(
    (key: 'supplyPrice' | 'salePrice') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value.trim();
        if (!raw) {
          updateRow({ [key]: null } as Partial<Product>);
          return;
        }
        const value = Number.parseFloat(raw);
        if (!Number.isFinite(value)) {
          return;
        }
        updateRow({ [key]: Math.max(0, Math.round(value * 100) / 100) } as Partial<Product>);
      },
    [updateRow],
  );

  const hasSelectedCategory = row.category.trim().length > 0;

  const validationMessage = useMemo(() => validateProductDraft(row), [row]);
  const showValidationMessage = useMemo(() => {
    if (!validationMessage) {
      return false;
    }

    const hasTyped =
      row.sku.trim().length > 0 ||
      row.name.trim().length > 0 ||
      row.category.trim().length > 0 ||
      row.subCategory.trim().length > 0;

    return hasTyped;
  }, [row.category, row.name, row.sku, row.subCategory, validationMessage]);

  return (
    <form className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={skuInputId} className="text-xs font-semibold text-slate-600">
            SKU
          </label>
          <div className="mt-1 flex gap-2">
            <input
              id={skuInputId}
              className={inputClassName}
              value={row.sku}
              onChange={(event) => updateRow({ sku: event.target.value })}
              placeholder="SKU 입력"
            />
            <button
              type="button"
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
              onClick={handleSkuGenerate}
            >
              자동생성
            </button>
          </div>
          {duplicateSku && (
            <p className="mt-1 text-xs text-rose-500">이미 사용 중인 SKU입니다.</p>
          )}
        </div>
        <div>
          <label htmlFor={nameInputId} className="text-xs font-semibold text-slate-600">
            품명
          </label>
          <input
            id={nameInputId}
            className={inputClassName}
            value={row.name}
            onChange={(event) => updateRow({ name: event.target.value })}
            placeholder="품명 입력"
          />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={categoryListId} className="text-xs font-semibold text-slate-600">
            카테고리
          </label>
          <Combobox
            id={categoryListId}
            value={row.category}
            onChange={(next) => updateRow({ category: next })}
            onSelect={(option) => updateRow({ category: option })}
            options={categoryOptions}
            placeholder="카테고리 선택 또는 입력"
            helperText="목록에 원하는 분류가 없다면 직접 입력할 수 있습니다."
            toggleAriaLabel="카테고리 목록 토글"
            inputClassName={inputClassName}
          />
        </div>
        <div>
          <label htmlFor={subCategoryInputId} className="text-xs font-semibold text-slate-600">
            하위 카테고리
          </label>
          <Combobox
            id={subCategoryInputId}
            value={row.subCategory}
            onChange={(next) => updateRow({ subCategory: next })}
            onSelect={(option) => updateRow({ subCategory: option })}
            options={selectedSubCategoryOptions}
            disabled={!hasSelectedCategory}
            placeholder={
              hasSelectedCategory ? '하위 카테고리 선택 또는 입력' : '카테고리를 먼저 선택하세요'
            }
            helperText="목록에 원하는 분류가 없다면 직접 입력할 수 있습니다."
            disabledHelperText="카테고리를 선택하면 하위 분류를 추천해 드립니다."
            allowManualInput={hasSelectedCategory}
            emptyMessage="등록된 하위 카테고리가 없습니다. 카테고리 관리에서 추가할 수 있습니다."
            noMatchMessage="일치하는 하위 카테고리가 없습니다."
            toggleAriaLabel="하위 카테고리 목록 토글"
          />
        </div>
      </div>
      {categoriesError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {categoriesError}
        </div>
      )}

      <div>
        <label className="text-xs font-semibold text-slate-600">단위</label>
        <SelectDropdown
          value={row.unit}
          onChange={(next) => updateRow({ unit: next })}
          options={DEFAULT_UNIT_OPTIONS.map((unitOption) => ({
            label: unitOption,
            value: unitOption,
          }))}
          inputClassName={inputClassName}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label className="text-xs font-semibold text-slate-600">매입가</label>
          <input
            type="number"
            min={0}
            step="0.01"
            className={inputClassName}
            value={row.supplyPrice ?? ''}
            onChange={handleOptionalNumberChange('supplyPrice')}
          />
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">판매가</label>
          <input
            type="number"
            min={0}
            step="0.01"
            className={inputClassName}
            value={row.salePrice ?? ''}
            onChange={handleOptionalNumberChange('salePrice')}
          />
        </div>
      </div>

      {(duplicateSku || showValidationMessage) && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600">
          {duplicateSku ? '이미 사용 중인 SKU입니다. 다른 값을 입력해 주세요.' : validationMessage}
        </div>
      )}
    </form>
  );
};

export default ProductForm;
