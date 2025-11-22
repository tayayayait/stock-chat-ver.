import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createWarehouse,
  deleteWarehouse,
  fetchWarehouses,
  type ApiWarehouse,
  updateWarehouse,
} from '../../../../services/api';
import { generateWarehouseCode } from '../../../../utils/warehouse';

interface WarehouseManagementPanelProps {
  refreshToken: number;
  onRequestReload: () => void;
}

interface WarehouseFormState {
  name: string;
  memo: string;
}

interface WarehouseFormTouched {
  name: boolean;
  memo: boolean;
}

const INITIAL_CREATE_FORM: WarehouseFormState = {
  name: '',
  memo: '',
};

const INITIAL_CREATE_TOUCHED: WarehouseFormTouched = {
  name: false,
  memo: false,
};

const INITIAL_EDIT_FORM: WarehouseFormState = {
  name: '',
  memo: '',
};

const INITIAL_EDIT_TOUCHED: WarehouseFormTouched = {
  name: false,
  memo: false,
};

const WarehouseManagementPanel: React.FC<WarehouseManagementPanelProps> = ({ refreshToken, onRequestReload }) => {
  const [warehouses, setWarehouses] = useState<ApiWarehouse[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(false);
  const [warehousesError, setWarehousesError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState<WarehouseFormState>(INITIAL_CREATE_FORM);
  const [createFormTouched, setCreateFormTouched] = useState<WarehouseFormTouched>(INITIAL_CREATE_TOUCHED);
  const [createSubmitError, setCreateSubmitError] = useState<string | null>(null);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const lastCreatedWarehouseCodeRef = useRef<string | null>(null);

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editTargetWarehouse, setEditTargetWarehouse] = useState<ApiWarehouse | null>(null);
  const [editForm, setEditForm] = useState<WarehouseFormState>(INITIAL_EDIT_FORM);
  const [editFormTouched, setEditFormTouched] = useState<WarehouseFormTouched>(INITIAL_EDIT_TOUCHED);
  const [editSubmitError, setEditSubmitError] = useState<string | null>(null);
  const [editSubmitting, setEditSubmitting] = useState(false);

  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [confirmTargetWarehouse, setConfirmTargetWarehouse] = useState<ApiWarehouse | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);

  const loadWarehouses = useCallback(async (query: string) => {
    setWarehousesLoading(true);
    setWarehousesError(null);
    setSearchError(null);
    try {
      const response = await fetchWarehouses({
        pageSize: 100,
        ...(query ? { q: query } : {}),
      });
      const items = Array.isArray(response.items) ? response.items : [];
      const pendingCode = lastCreatedWarehouseCodeRef.current;
      let orderedItems = items;
      if (pendingCode) {
        const targetIndex = items.findIndex((item) => item.code === pendingCode);
        if (targetIndex >= 0) {
          const target = items[targetIndex];
          orderedItems = [
            ...items.slice(0, targetIndex),
            ...items.slice(targetIndex + 1),
            target,
          ];
          lastCreatedWarehouseCodeRef.current = null;
        }
      }
      setWarehouses(orderedItems);
    } catch (error) {
      const fallback = query ? '검색 결과를 불러오지 못했습니다.' : '창고 목록을 불러오지 못했습니다.';
      const message = error instanceof Error && error.message ? error.message : fallback;
      if (query) {
        setSearchError(message);
      } else {
        setWarehousesError(message);
      }
      setWarehouses([]);
    } finally {
      setWarehousesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWarehouses(searchQuery);
  }, [loadWarehouses, refreshToken, searchQuery]);

  const tableRows = useMemo(
    () =>
      warehouses.map((warehouse) => ({
        id: warehouse.id ? `warehouse-${warehouse.id}` : `warehouse-${warehouse.code}`,
        warehouse,
      })),
    [warehouses],
  );

  const handleSearchInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchInput(event.target.value);
    setSearchError(null);
  }, []);

  const handleSearchSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = searchInput.trim();
      setSearchInput(trimmed);
      setSearchError(null);
      if (trimmed === searchQuery) {
        void loadWarehouses(trimmed);
        return;
      }
      setSearchQuery(trimmed);
    },
    [loadWarehouses, searchInput, searchQuery],
  );

  const handleSearchReset = useCallback(() => {
    setSearchInput('');
    setSearchError(null);
    if (searchQuery) {
      setSearchQuery('');
      return;
    }
    void loadWarehouses('');
  }, [loadWarehouses, searchQuery]);

  const handleOpenCreateDialog = useCallback(() => {
    setCreateForm(INITIAL_CREATE_FORM);
    setCreateFormTouched(INITIAL_CREATE_TOUCHED);
    setCreateSubmitError(null);
    setCreateDialogOpen(true);
  }, []);

  const handleCloseCreateDialog = useCallback(() => {
    if (createSubmitting) {
      return;
    }
    setCreateDialogOpen(false);
  }, [createSubmitting]);

  const handleCreateFormChange = useCallback(
    (field: keyof WarehouseFormState, value: string) => {
      setCreateForm((prev) => ({ ...prev, [field]: value }));
      setCreateSubmitError(null);
    },
    [],
  );

  const handleCreateFormBlur = useCallback((field: keyof WarehouseFormTouched) => {
    setCreateFormTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const handleCreateWarehouse = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (createSubmitting) {
        return;
      }

      const trimmedName = createForm.name.trim();
      const trimmedMemo = createForm.memo.trim();

      const nextTouched: WarehouseFormTouched = {
        name: true,
        memo: true,
      };
      setCreateFormTouched(nextTouched);

      if (!trimmedName) {
        return;
      }

      setCreateSubmitting(true);
      setCreateSubmitError(null);

      try {
        const code = generateWarehouseCode(trimmedName);
        const warehouse = await createWarehouse({
          code,
          name: trimmedName,
          ...(trimmedMemo ? { notes: trimmedMemo } : {}),
        });
        if (!warehouse?.id) {
          throw new Error('생성된 창고 정보를 확인할 수 없습니다.');
        }

        lastCreatedWarehouseCodeRef.current = warehouse.code;

        setCreateDialogOpen(false);
        setCreateForm(INITIAL_CREATE_FORM);
        setCreateFormTouched(INITIAL_CREATE_TOUCHED);
        onRequestReload();
        await loadWarehouses(searchQuery);
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : '창고를 저장하지 못했습니다. 다시 시도해주세요.';
        setCreateSubmitError(message);
      } finally {
        setCreateSubmitting(false);
      }
    },
    [createForm, createSubmitting, loadWarehouses, onRequestReload, searchQuery],
  );

  const handleManualReload = useCallback(() => {
    onRequestReload();
    void loadWarehouses(searchQuery);
  }, [loadWarehouses, onRequestReload, searchQuery]);

  const resetEditState = useCallback(() => {
    setEditTargetWarehouse(null);
    setEditForm(INITIAL_EDIT_FORM);
    setEditFormTouched(INITIAL_EDIT_TOUCHED);
    setEditSubmitError(null);
  }, []);

  const handleEditRow = useCallback((warehouse: ApiWarehouse) => {
    setEditTargetWarehouse(warehouse);
    setEditForm({
      name: warehouse.name ?? '',
      memo: warehouse.notes ?? '',
    });
    setEditFormTouched(INITIAL_EDIT_TOUCHED);
    setEditSubmitError(null);
    setEditDialogOpen(true);
  }, []);

  const handleCloseEditDialog = useCallback(() => {
    if (editSubmitting) {
      return;
    }
    setEditDialogOpen(false);
  }, [editSubmitting]);

  useEffect(() => {
    if (!editDialogOpen) {
      resetEditState();
      setEditSubmitting(false);
    }
  }, [editDialogOpen, resetEditState]);

  const handleEditFormChange = useCallback((field: keyof WarehouseFormState, value: string) => {
    setEditForm((prev) => ({ ...prev, [field]: value }));
    setEditSubmitError(null);
  }, []);

  const handleEditFormBlur = useCallback((field: keyof WarehouseFormTouched) => {
    setEditFormTouched((prev) => ({ ...prev, [field]: true }));
  }, []);

  const handleSubmitEditForm = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!editTargetWarehouse || editSubmitting) {
        return;
      }

      const trimmedName = editForm.name.trim();
      const trimmedMemo = editForm.memo.trim();
      setEditFormTouched({
        name: true,
        memo: true,
      });

      if (trimmedName === '') {
        return;
      }

      const normalizedWarehouseName = editTargetWarehouse.name?.trim() ?? '';
      const normalizedWarehouseMemo = editTargetWarehouse.notes?.trim() ?? '';
      const nameChanged = trimmedName !== normalizedWarehouseName;
      const memoChanged = trimmedMemo !== normalizedWarehouseMemo;

      if (!nameChanged && !memoChanged) {
        setEditDialogOpen(false);
        return;
      }

      setEditSubmitting(true);
      setEditSubmitError(null);
      setWarehousesError(null);

      try {
        const payload: Partial<ApiWarehouse> = {
          name: trimmedName,
        };
        if (memoChanged) {
          payload.notes = trimmedMemo !== '' ? trimmedMemo : null;
        }

        await updateWarehouse(editTargetWarehouse.code, payload);
        setWarehouses((prev) =>
          prev.map((warehouse) =>
            warehouse.code === editTargetWarehouse.code
              ? {
                  ...warehouse,
                  name: trimmedName,
                  notes: memoChanged ? payload.notes ?? null : warehouse.notes,
                }
              : warehouse,
          ),
        );
      } catch (error) {
        const message =
          error instanceof Error && error.message ? error.message : '창고를 수정하지 못했습니다.';
        setWarehousesError(message);
        setEditSubmitError(message);
        setEditSubmitting(false);
        return;
      }

      setEditDialogOpen(false);
      setEditSubmitting(false);
    },
    [editForm, editSubmitting, editTargetWarehouse],
  );

  const handleDeleteRow = useCallback((warehouse: ApiWarehouse) => {
    setConfirmTargetWarehouse(warehouse);
    setConfirmDialogOpen(true);
  }, []);

  const handleCloseConfirmDialog = useCallback(() => {
    if (confirmSubmitting) {
      return;
    }
    setConfirmDialogOpen(false);
    setConfirmTargetWarehouse(null);
  }, [confirmSubmitting]);

  const handleConfirmDelete = useCallback(async () => {
    if (!confirmTargetWarehouse) {
      return;
    }

    try {
      setWarehousesError(null);
      setConfirmSubmitting(true);

      await deleteWarehouse(confirmTargetWarehouse.code);

      setConfirmDialogOpen(false);
      setConfirmTargetWarehouse(null);
      await loadWarehouses(searchQuery);
      onRequestReload();
    } catch (error) {
      const message =
        error instanceof Error && error.message ? error.message : '창고를 삭제하지 못했습니다.';
      setWarehousesError(message);
    } finally {
      setConfirmSubmitting(false);
    }
  }, [confirmTargetWarehouse, loadWarehouses, onRequestReload, searchQuery]);
  const nameError = createFormTouched.name && !createForm.name.trim() ? '창고 이름을 입력해 주세요.' : null;
  const canSubmitCreateForm = createForm.name.trim() !== '' && !createSubmitting;

  const editNameError = editFormTouched.name && !editForm.name.trim() ? '창고 이름을 입력해 주세요.' : null;
  const canSubmitEditForm = Boolean(editTargetWarehouse) && editForm.name.trim() !== '' && !editSubmitting;

  return (
    <div className="py-10">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">창고 관리</h1>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <form className="flex flex-wrap items-center gap-2" onSubmit={handleSearchSubmit}>
              <input
                type="search"
                value={searchInput}
                onChange={handleSearchInputChange}
                className="w-48 rounded-2xl border border-slate-200/70 bg-white px-4 py-2 text-sm text-slate-700 shadow-inner focus:border-indigo-400 focus:outline-none sm:w-60"
                placeholder="창고명 또는 코드를 입력하세요"
              />
              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  className="rounded-full bg-indigo-500 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-600"
                >
                  검색
                </button>
                {(searchQuery || searchInput) && (
                  <button
                    type="button"
                    onClick={handleSearchReset}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600"
                  >
                    초기화
                  </button>
                )}
              </div>
            </form>
            <button
              type="button"
              onClick={handleManualReload}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-indigo-200 hover:text-indigo-600"
            >
              새로고침
            </button>
            <button
              type="button"
              onClick={handleOpenCreateDialog}
              className="rounded-full bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500"
            >
              + 창고 추가
            </button>
          </div>
          {searchError && <p className="text-xs text-rose-500">{searchError}</p>}
        </div>
      </div>

      <div className="space-y-8">
        <section className="rounded-3xl border border-slate-200/70 bg-white/80 p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">창고</h2>
              <p className="mt-1 text-xs text-slate-400">등록된 창고를 관리하세요.</p>
            </div>
            {warehousesLoading && (
              <span className="text-xs text-indigo-500">불러오는 중...</span>
            )}
          </div>

          {warehousesError && (
            <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50/80 p-4 text-sm text-rose-600">
              {warehousesError}
            </div>
          )}
          {tableRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200/80 p-8 text-center text-sm text-slate-400">
              등록된 창고가 없습니다. 상단의 <span className="font-semibold text-indigo-500">+ 창고 추가</span> 버튼을 눌러 새 창고를 등록하세요.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200/70">
              <table className="min-w-full divide-y divide-slate-200/60 text-sm">
                <thead className="bg-slate-50/80 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 text-left">창고명</th>
                    <th className="px-4 py-3 text-left">메모</th>
                    <th className="px-4 py-3 text-left">수정</th>
                    <th className="px-4 py-3 text-left">삭제</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100/80 bg-white/60 text-slate-600">
                  {tableRows.map((row) => {
                    const warehouse = row.warehouse;
                    const rowMemo = warehouse.notes?.trim();

                    return (
                      <tr key={row.id}>
                        <td className="px-4 py-3 align-top">
                          <div className="font-medium text-slate-700">{warehouse.name}</div>
                          <div className="text-xs text-slate-400">{warehouse.code ?? '—'}</div>
                        </td>
                        <td className="px-4 py-3 align-top text-slate-500">
                          {rowMemo ? (
                            <span className="whitespace-pre-line text-sm text-slate-600">{rowMemo}</span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleEditRow(warehouse)}
                            className="rounded-full border border-indigo-200 bg-indigo-50/80 px-3 py-1 text-xs font-semibold text-indigo-600 transition hover:border-indigo-300 hover:bg-indigo-100"
                          >
                            수정
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={() => handleDeleteRow(warehouse)}
                            className="rounded-full border border-rose-200 bg-rose-50/80 px-3 py-1 text-xs font-semibold text-rose-600 transition hover:border-rose-300 hover:bg-rose-100"
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

      </div>

      {confirmDialogOpen && confirmTargetWarehouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
          <div
            className="w-full max-w-md rounded-xl bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="warehouse-delete-title"
          >
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 id="warehouse-delete-title" className="text-lg font-semibold text-slate-800">
                창고 삭제 확인
              </h2>
              <button
                type="button"
                onClick={handleCloseConfirmDialog}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={confirmSubmitting}
              >
                닫기
              </button>
            </div>
            <div className="space-y-4 px-5 py-6 text-sm text-slate-700">
              <p>
                창고 <span className="font-semibold">{confirmTargetWarehouse.name}</span>을(를) 삭제하시겠습니까?
              </p>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={handleCloseConfirmDialog}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={confirmSubmitting}
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  className="rounded-md bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:bg-rose-300"
                  disabled={confirmSubmitting}
                >
                  {confirmSubmitting ? '삭제 중...' : '삭제'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editDialogOpen && editTargetWarehouse && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-800">창고 정보 수정</h2>
              <button
                type="button"
                onClick={handleCloseEditDialog}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={editSubmitting}
              >
                닫기
              </button>
            </div>
            <form className="space-y-5 px-5 py-6 text-sm text-slate-700" onSubmit={handleSubmitEditForm}>
              <p className="text-slate-500">선택한 창고 정보를 수정하세요.</p>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">창고명</span>
                <input
                  type="text"
                  value={editForm.name}
                  onChange={(event) => handleEditFormChange('name', event.target.value)}
                  onBlur={() => handleEditFormBlur('name')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                  autoFocus
                />
                {editNameError && <span className="text-xs text-rose-500">{editNameError}</span>}
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">창고 메모</span>
                <textarea
                  value={editForm.memo}
                  onChange={(event) => handleEditFormChange('memo', event.target.value)}
                  onBlur={() => handleEditFormBlur('memo')}
                  className="h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                  placeholder="창고 비고를 입력하세요."
                />
              </label>
              {editSubmitError && (
                <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-600">{editSubmitError}</p>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseEditDialog}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={editSubmitting}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
                  disabled={!canSubmitEditForm}
                >
                  {editSubmitting ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {createDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-800">새 창고 추가</h2>
              <button
                type="button"
                onClick={handleCloseCreateDialog}
                className="rounded-full border border-slate-200 px-3 py-1 text-sm text-slate-500 transition hover:border-slate-300 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={createSubmitting}
              >
                닫기
              </button>
            </div>
            <form className="space-y-5 px-5 py-6 text-sm text-slate-700" onSubmit={handleCreateWarehouse}>
              <p className="text-slate-500">창고 정보를 입력하고 필요한 메모를 남기세요.</p>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">창고명</span>
                <input
                  type="text"
                  value={createForm.name}
                  onChange={(event) => handleCreateFormChange('name', event.target.value)}
                  onBlur={() => handleCreateFormBlur('name')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                  placeholder="예: 서울 센터"
                  autoFocus
                />
                {nameError && <span className="text-xs text-rose-500">{nameError}</span>}
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">창고 메모 (선택)</span>
                <textarea
                  value={createForm.memo}
                  onChange={(event) => handleCreateFormChange('memo', event.target.value)}
                  onBlur={() => handleCreateFormBlur('memo')}
                  className="h-24 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm transition focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1"
                  placeholder="창고에 대한 비고를 입력하세요"
                />
              </label>
              {createSubmitError && (
                <p className="rounded-md bg-rose-50 px-3 py-2 text-xs text-rose-600">{createSubmitError}</p>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={handleCloseCreateDialog}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 transition hover:border-indigo-300 hover:text-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={createSubmitting}
                >
                  취소
                </button>
                <button
                  type="submit"
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-indigo-300"
                  disabled={!canSubmitCreateForm}
                >
                  {createSubmitting ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default WarehouseManagementPanel;
