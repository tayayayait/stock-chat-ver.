import assert from 'node:assert/strict';

import { buildServer } from '../app.js';
import { __resetMovementStore } from '../routes/movements.js';
import { __resetProductStore } from '../routes/products.js';
import { __resetInventoryStore } from '../stores/inventoryStore.js';
import { __resetWarehouseStore } from '../stores/warehousesStore.js';
import { __resetLocationStore } from '../stores/locationsStore.js';

const TRACKED_SKU = 'RANGE-SKU-001';
const DATE_ONLY = '2024-05-15';
const MOVEMENT_TIMES = ['2024-05-15T09:00:00.000Z', '2024-05-15T17:30:00.000Z'];

async function main() {
  __resetMovementStore();
  __resetProductStore();
  __resetInventoryStore();
  __resetWarehouseStore();
  __resetLocationStore();

  const server = await buildServer();

  try {
    const productResponse = await server.inject({
      method: 'POST',
      url: '/api/products',
      payload: {
        sku: TRACKED_SKU,
        name: '범위 테스트',
        category: '테스트',
        abcGrade: 'A',
        xyzGrade: 'X',
        dailyAvg: 4,
        dailyStd: 1.5,
        totalInbound: 0,
        totalOutbound: 0,
        avgOutbound7d: 0,
        inventory: [
          {
            warehouseCode: 'WH-SEOUL',
            onHand: 0,
            reserved: 0,
          },
        ],
      },
    });
    assert.equal(productResponse.statusCode, 201);

    for (const occurredAt of MOVEMENT_TIMES) {
      const movementResponse = await server.inject({
        method: 'POST',
        url: '/api/movements',
        payload: {
          type: 'RECEIPT',
          sku: TRACKED_SKU,
          qty: 5,
          toWarehouse: 'WH-SEOUL',
          occurredAt,
          userId: 'range-test',
          memo: 'range inclusion check',
        },
      });
      assert.equal(movementResponse.statusCode, 201);
    }

    const rangeResponse = await server.inject({
      method: 'GET',
      url: `/api/movements?sku=${encodeURIComponent(TRACKED_SKU)}&from=${DATE_ONLY}&to=${DATE_ONLY}`,
    });
    assert.equal(rangeResponse.statusCode, 200);
    const rangeBody = rangeResponse.json() as {
      count: number;
      total: number;
      items: Array<{ occurredAt: string }>;
    };

    assert.equal(rangeBody.count, 2);
    assert.equal(rangeBody.total, 2);
    assert.equal(rangeBody.items.length, 2);
    const observed = new Set(rangeBody.items.map((item) => item.occurredAt));
    for (const expected of MOVEMENT_TIMES) {
      assert.ok(observed.has(expected));
    }
  } finally {
    await server.close();
    __resetMovementStore();
    __resetProductStore();
    __resetInventoryStore();
    __resetWarehouseStore();
    __resetLocationStore();
  }
}

await main();
