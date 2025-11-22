import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import WarehouseManagementPanel from '../components/WarehouseManagementPanel';
import type { ApiWarehouse } from '../../../../services/api';

const fetchWarehousesMock = vi.hoisted(() => vi.fn());
const deleteWarehouseMock = vi.hoisted(() => vi.fn());
const createWarehouseMock = vi.hoisted(() => vi.fn());
const updateWarehouseMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../services/api', () => ({
  fetchWarehouses: fetchWarehousesMock,
  deleteWarehouse: deleteWarehouseMock,
  createWarehouse: createWarehouseMock,
  updateWarehouse: updateWarehouseMock,
}));

const buildWarehouse = (overrides: Partial<ApiWarehouse> = {}): ApiWarehouse => ({
  id: overrides.id ?? 1,
  code: overrides.code ?? 'WH-001',
  name: overrides.name ?? '서울 센터',
  notes: overrides.notes ?? '기본 메모',
  address: overrides.address ?? null,
});

describe('WarehouseManagementPanel', () => {
  beforeEach(() => {
    fetchWarehousesMock.mockReset();
    deleteWarehouseMock.mockReset();
    createWarehouseMock.mockReset();
    updateWarehouseMock.mockReset();
    fetchWarehousesMock.mockResolvedValue({
      items: [buildWarehouse()],
    });
  });

  it('deletes a warehouse after confirmation', async () => {
    deleteWarehouseMock.mockResolvedValue(null);
    const onRequestReload = vi.fn();
    const user = userEvent.setup();

    render(<WarehouseManagementPanel refreshToken={0} onRequestReload={onRequestReload} />);

    const warehouseRow = await screen.findByText('서울 센터');
    const deleteButton = within(warehouseRow.closest('tr') as HTMLTableRowElement).getByRole('button', {
      name: '삭제',
    });
    await user.click(deleteButton);

    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: '삭제' }));

    await waitFor(() => expect(deleteWarehouseMock).toHaveBeenCalledWith('WH-001'));
    expect(onRequestReload).toHaveBeenCalled();
  });

  it('edits warehouse name and memo', async () => {
    updateWarehouseMock.mockResolvedValue(null);
    const onRequestReload = vi.fn();
    const user = userEvent.setup();

    render(<WarehouseManagementPanel refreshToken={0} onRequestReload={onRequestReload} />);

    const editButton = await screen.findByRole('button', { name: '수정' });
    await user.click(editButton);

    const nameInput = screen.getByLabelText('창고명');
    const memoInput = screen.getByLabelText('창고 메모');

    await user.clear(nameInput);
    await user.type(nameInput, '테스트 창고');
    await user.clear(memoInput);
    await user.type(memoInput, '매뉴얼 메모');

    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() =>
      expect(updateWarehouseMock).toHaveBeenCalledWith('WH-001', {
        name: '테스트 창고',
        notes: '매뉴얼 메모',
      }),
    );
    expect(onRequestReload).not.toHaveBeenCalled();
  });

  it('shows validation error when warehouse name is cleared', async () => {
    const user = userEvent.setup();
    const onRequestReload = vi.fn();

    render(<WarehouseManagementPanel refreshToken={0} onRequestReload={onRequestReload} />);

    const editButton = await screen.findByRole('button', { name: '수정' });
    await user.click(editButton);

    const nameInput = screen.getByLabelText('창고명');
    await user.clear(nameInput);
    await user.tab();

    expect(await screen.findByText('창고 이름을 입력해 주세요.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });

  it('creates a new warehouse', async () => {
    createWarehouseMock.mockResolvedValue({
      id: 999,
      code: 'WH-TEST',
      name: '신규 창고',
      notes: '새 메모',
    } satisfies ApiWarehouse);
    const onRequestReload = vi.fn();
    const user = userEvent.setup();

    render(<WarehouseManagementPanel refreshToken={0} onRequestReload={onRequestReload} />);

    await user.click(screen.getByRole('button', { name: '+ 창고 추가' }));
    const nameInput = screen.getByLabelText('창고명');
    const memoInput = screen.getByLabelText('창고 메모 (선택)');

    await user.type(nameInput, '신규 창고');
    await user.type(memoInput, '초기 메모');

    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(createWarehouseMock).toHaveBeenCalled());
    expect(createWarehouseMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '신규 창고',
        notes: '초기 메모',
        code: expect.stringMatching(/^WH-/),
      }),
    );
  });
});
