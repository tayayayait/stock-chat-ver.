// Fastify라는 도구를 가져와서 서버를 만들 거예요
import Fastify from 'fastify';

// 서버 만들기
const fastify = Fastify({ logger: true });
fastify.addHook('onSend', (request, reply, payload, done) => {
  reply.header('Access-Control-Allow-Origin', 'http://localhost:3000');
  reply.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  reply.header('Access-Control-Allow-Headers', 'Content-Type');
  done();
});
fastify.options('/*', async () => ({ ok: true }));

// 서버가 데이터를 보낼 수 있도록 만들어 줄 코드
fastify.get('/api/data', async (request, reply) => {
  return reply.send({ message: "정상적으로 데이터를 보냈습니다!" });  // 서버가 보내는 데이터
});

// 앱 헬스체크용 (200 + JSON)
fastify.get('/api/health', async () => {
  return { ok: true };
});

// UI에서 초기에 호출하는 최소 엔드포인트들(빈 목록 반환)
// 품목 목록
const __mem = {
  products: [],
  previewCache: new Map(), // previewId -> { rows: ParsedRow[], createdAt }
  nextLegacyId: 1,
};

const nowIso = () => new Date().toISOString();

const toNumber = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

const upsertProduct = (row) => {
  const existingIndex = __mem.products.findIndex((p) => p.sku === row.sku);
  const base = {
    productId: row.productId || `P-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    legacyProductId: row.legacyProductId || __mem.nextLegacyId++,
    imageUrl: null,
    brand: null,
    abcGrade: row.abcGrade || 'A',
    xyzGrade: row.xyzGrade || 'X',
    bufferRatio: toNumber(row.bufferRatio, 0.2),
    dailyAvg: toNumber(row.dailyAvg, 0),
    dailyStd: toNumber(row.dailyStd, 0),
    totalInbound: toNumber(row.totalInbound, 0),
    totalOutbound: toNumber(row.totalOutbound, 0),
    avgOutbound7d: toNumber(row.avgOutbound7d, 0),
    isActive: true,
    expiryDays: null,
    supplyPrice: null,
    salePrice: null,
    referencePrice: null,
    currency: 'KRW',
    inventory: [],
  };

  const record = {
    ...base,
    sku: String(row.sku || '').trim(),
    name: String(row.name || '').trim(),
    category: String(row.category || '기타').trim(),
    subCategory: String(row.subCategory || '').trim(),
    unit: String(row.unit || 'EA').trim(),
    packCase: String(row.packCase || '1/1').trim(),
    pack: toNumber(row.pack, 1),
    casePack: toNumber(row.casePack, 1),
    onHand: toNumber(row.onHand, 0),
    reserved: toNumber(row.reserved, 0),
    risk: '정상',
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  if (existingIndex >= 0) {
    __mem.products[existingIndex] = { ...__mem.products[existingIndex], ...record, updatedAt: nowIso() };
    return { action: 'update', item: __mem.products[existingIndex] };
  }
  __mem.products.push(record);
  return { action: 'create', item: record };
};

fastify.get('/api/products', async () => {
  return { items: __mem.products, count: __mem.products.length };
});
fastify.get('/products', async () => {
  return { items: __mem.products, count: __mem.products.length };
});

// 창고 목록
fastify.get('/api/warehouses', async () => {
  return { items: [], count: 0 };
});

// 로케이션 목록(warehouseCode 쿼리 유무와 상관없이 빈 목록 반환)
fastify.get('/api/locations', async () => {
  return { items: [], count: 0 };
});

// 재고 레벨(대시보드 등에서 참조) – 빈 결과 반환
fastify.get('/api/levels', async () => {
  return { total: 0, count: 0, items: [] };
});

const createInventoryDashboardPayload = () => ({
  generatedAt: new Date().toISOString(),
  summary: {
    skuCount: 0,
    shortageSkuCount: 0,
    shortageRate: 0,
    totalOnHand: 0,
    totalReserved: 0,
    totalAvailable: 0,
    avgDaysOfSupply: 0,
    inventoryTurnover: 0,
    serviceLevelPercent: 0,
  },
  riskDistribution: [],
  warehouseTotals: [],
  movementHistory: [],
  insights: {
    shortages: [],
    overstock: [],
    sampleLocations: [],
  },
});

const createInventoryAnalysisPayload = () => ({
  generatedAt: new Date().toISOString(),
  range: {
    from: '',
    to: '',
    dayCount: 0,
    groupBy: 'month',
  },
  scope: {
    warehouseCode: null,
    sku: null,
  },
  totals: {
    inbound: 0,
    outbound: 0,
    adjustments: 0,
    transfers: 0,
    net: 0,
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

const createInventoryWarehouseItemsPayload = () => ({
  generatedAt: new Date().toISOString(),
  warehouseCode: null,
  range: {
    from: '',
    to: '',
    dayCount: 0,
  },
  totals: {
    inbound: 0,
    outbound: 0,
    avgDailyOutbound: 0,
    avgDailyInbound: 0,
    onHand: 0,
    reserved: 0,
    available: 0,
    safetyStock: 0,
    stockoutEtaDays: null,
    projectedStockoutDate: null,
  },
  movementSeries: [],
  items: [],
});

// 대시보드/분석용 목업 응답
fastify.get('/inventory/dashboard', async () => createInventoryDashboardPayload());
fastify.get('/api/inventory/dashboard', async () => createInventoryDashboardPayload());

fastify.get('/inventory/analysis', async () => createInventoryAnalysisPayload());
fastify.get('/api/inventory/analysis', async () => createInventoryAnalysisPayload());

fastify.get('/inventory/warehouse-items', async () => createInventoryWarehouseItemsPayload());
fastify.get('/api/inventory/warehouse-items', async () => createInventoryWarehouseItemsPayload());

// ----- Categories (tree) -----
const createEmptyCategories = () => ({ items: [], count: 0 });
fastify.get('/categories', async () => createEmptyCategories());
fastify.get('/api/categories', async () => createEmptyCategories());

// ----- CSV templates -----
const CSV_TEMPLATES = {
  products: 'sku,name,category,subCategory,unit,pack,casePack,onHand,reserved\n',
  initial_stock: 'sku,warehouseCode,locationCode,onHand,reserved\n',
  movements: 'sku,change,reason,warehouseCode,locationCode\n',
};
fastify.get('/csv/template', async (request, reply) => {
  const type = request.query?.type || 'products';
  const content = CSV_TEMPLATES[type] || CSV_TEMPLATES.products;
  reply.header('content-type', 'text/csv; charset=utf-8');
  return `\uFEFF${content}`;
});
fastify.get('/api/csv/template', async (request, reply) => {
  const type = request.query?.type || 'products';
  const content = CSV_TEMPLATES[type] || CSV_TEMPLATES.products;
  reply.header('content-type', 'text/csv; charset=utf-8');
  return `\uFEFF${content}`;
});

// CSV upload + jobs
const parseCsvText = (text = '') => {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length > 0 && lines[0].charCodeAt(0) === 0xfeff) {
    lines[0] = lines[0].slice(1);
  }
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim());
  const rows = lines.slice(1).map((line) => {
    const cells = line.split(',');
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = cells[i] !== undefined ? cells[i].trim() : '';
    });
    return obj;
  });
  return { headers, rows };
};

const buildPreview = (type, text) => {
  const { rows } = parseCsvText(text);
  const normalized = rows
    .map((r) => ({
      sku: r.sku || r.SKU || r.Sku || r.SKU_CODE || r.code,
      name: r.name || r.productName || r.NAME,
      category: r.category || r.CATEGORY || r.cat,
      subCategory: r.subCategory || r.sub || '',
      unit: r.unit || 'EA',
      pack: r.pack || 1,
      casePack: r.casePack || 1,
      onHand: r.onHand || r.stock || 0,
      reserved: r.reserved || 0,
    }))
    .filter((r) => r.sku);

  let newCount = 0;
  let updateCount = 0;
  normalized.forEach((row) => {
    const exists = __mem.products.some((p) => p.sku === row.sku);
    if (exists) updateCount += 1; else newCount += 1;
  });

  const errors = rows.length - normalized.length;
  const previewId = `preview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  __mem.previewCache.set(previewId, { rows: normalized, createdAt: Date.now(), type: String(type || 'products') });

  return {
    previewId,
    type: String(type || 'products'),
    columns: [],
    summary: { total: normalized.length, newCount, updateCount, errorCount: Math.max(0, errors) },
    errors: [],
  };
};

const buildCompletedJob = () => ({
  job: {
    id: `job-${Date.now()}`,
    status: 'completed',
    total: 0,
    processed: 0,
    summary: { total: 0, newCount: 0, updateCount: 0, errorCount: 0 },
    errorCount: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  },
});

fastify.post('/csv/upload', async (request) => {
  const stage = request.body?.stage || 'preview';
  const type = request.query?.type || 'products';
  if (stage === 'commit') {
    const id = request.body?.previewId;
    const cached = id ? __mem.previewCache.get(String(id)) : null;
    const rows = cached?.rows ?? [];
    rows.forEach((row) => upsertProduct(row));
    return buildCompletedJob();
  }
  const text = request.body?.content || '';
  return buildPreview(type, text);
});
fastify.post('/api/csv/upload', async (request) => fastify
  .inject({ method: 'POST', url: '/csv/upload', payload: request.body, query: request.query })
  .then((r) => r.json()));

// Frontend alias: importCsv({ csvText }) -> preview + commit
fastify.post('/api/import/csv', async (request, reply) => {
  try {
    const body = request.body || {};
    const csvText = typeof body.csvText === 'string' ? body.csvText : '';
    if (!csvText.trim()) {
      reply.code(400);
      return { success: false, message: 'CSV 내용이 비어 있습니다.' };
    }

    // 1) Preview
    const previewRes = await fastify.inject({
      method: 'POST',
      url: '/csv/upload?type=products',
      payload: { content: csvText },
    });
    const preview = previewRes.json();
    const previewId = preview?.previewId;
    if (!previewId) {
      reply.code(previewRes.statusCode || 500);
      return preview || { success: false, message: '미리보기 생성에 실패했습니다.' };
    }

    // 2) Commit
    const commitRes = await fastify.inject({
      method: 'POST',
      url: '/csv/upload?type=products',
      payload: { stage: 'commit', previewId },
    });
    const committed = commitRes.json();
    reply.code(commitRes.statusCode || 200);
    return committed;
  } catch (err) {
    request.log.error({ err }, 'CSV import failed');
    reply.code(500);
    return { success: false, message: 'CSV 업로드 처리 중 오류가 발생했습니다.' };
  }
});

fastify.get('/csv/jobs/:id', async () => buildCompletedJob());
fastify.get('/api/csv/jobs/:id', async (request) => fastify
  .inject({ method: 'GET', url: `/csv/jobs/${request.params.id}` })
  .then((r) => r.json()));

fastify.get('/csv/jobs/:id/errors', async (request, reply) => {
  reply.code(204);
  return null;
});
fastify.get('/api/csv/jobs/:id/errors', async (request) => fastify
  .inject({ method: 'GET', url: `/csv/jobs/${request.params.id}/errors` })
  .then((r) => ({ status: r.statusCode })));

// ----- Partners -----
const SAMPLE_PARTNERS = [
  { id: 'partner-s-1', type: 'SUPPLIER', name: '한빛식품', isSample: true, isActive: true },
  { id: 'partner-s-2', type: 'SUPPLIER', name: '코리아패키징', isSample: true, isActive: true },
  { id: 'partner-c-1', type: 'CUSTOMER', name: '스타마켓 강남점', isSample: true, isActive: true },
  { id: 'partner-c-2', type: 'CUSTOMER', name: '프레시몰 온라인', isSample: true, isActive: true },
];

const listPartners = (query) => {
  let items = [...SAMPLE_PARTNERS];
  const type = query?.type?.toString().trim();
  if (type) {
    items = items.filter((p) => p.type === type);
  }
  // includeSample=true simply leaves sample entries in
  return { success: true, items };
};

fastify.get('/partners', async (request) => listPartners(request.query));
fastify.get('/api/partners', async (request) => listPartners(request.query));

fastify.post('/partners', async (request) => {
  const body = request.body || {};
  const item = {
    id: body.id?.toString() || `p-${Date.now()}`,
    type: body.type || 'CUSTOMER',
    name: body.name || '새 거래처',
    phone: body.phone || null,
    email: body.email || null,
    address: body.address || null,
    notes: body.notes || null,
    isActive: body.isActive !== false,
  };
  return { success: true, item };
});
fastify.post('/api/partners', async (request) => fastify.inject({ method: 'POST', url: '/partners', payload: request.body }).then(r => r.json()));

fastify.patch('/partners/:id', async (request) => {
  const id = request.params?.id?.toString() || `p-${Date.now()}`;
  const body = request.body || {};
  const item = { id, ...body };
  return { success: true, item };
});
fastify.patch('/api/partners/:id', async (request) => fastify.inject({ method: 'PATCH', url: `/partners/${request.params.id}`, payload: request.body }).then(r => r.json()));

fastify.delete('/partners/:id', async (request) => {
  const id = request.params?.id?.toString() || '';
  const item = SAMPLE_PARTNERS.find((p) => p.id === id) || { id };
  return { success: true, item };
});
fastify.delete('/api/partners/:id', async (request) => fastify.inject({ method: 'DELETE', url: `/partners/${request.params.id}` }).then(r => r.json()));

// ----- Policies -----
fastify.get('/api/policies', async () => ({ success: true, items: [] }));
fastify.post('/api/policies/bulk-save', async () => ({ success: true }));
fastify.put('/api/policies/:sku', async (request) => ({ success: true, item: { sku: request.params.sku, name: null, forecastDemand: null, demandStdDev: null, leadTimeDays: null, serviceLevelPercent: null, smoothingAlpha: 0.4, corrRho: 0.25 } }));

fastify.post('/api/policies/recommend', async () => ({ success: true, recommendation: { patch: {}, notes: [] } }));
fastify.post('/api/policies/recommend-forecast', async () => ({ success: true, recommendation: { forecastDemand: null, demandStdDev: null, leadTimeDays: null, serviceLevelPercent: null, notes: [] } }));

// ----- Purchase Orders -----
const buildPurchaseOrder = (overrides = {}) => ({
  id: overrides.id || `po-${Date.now()}`,
  vendorId: overrides.vendorId || 'partner-s-1',
  status: overrides.status || 'open',
  vendorName: overrides.vendorName || '한빛식품',
  orderNumber: overrides.orderNumber || 'PO-000001',
  orderDate: overrides.orderDate || new Date().toISOString().slice(0, 10),
  receivingMode: overrides.receivingMode || 'STANDARD',
  receivingNote: overrides.receivingNote || null,
  warehouse: overrides.warehouse || 'WHS-SEOUL',
  orderSequence: overrides.orderSequence || 1,
  memo: overrides.memo ?? null,
  createdAt: overrides.createdAt || new Date().toISOString(),
  approvedAt: overrides.approvedAt ?? null,
  promisedDate: overrides.promisedDate ?? null,
  lines: Array.isArray(overrides.lines) ? overrides.lines : [],
});

fastify.get('/purchase-orders', async () => ({ success: true, items: [] }));
fastify.get('/api/purchase-orders', async () => ({ success: true, items: [] }));

fastify.get('/purchase-orders/next-number', async (request) => {
  const orderDate = (request.query?.orderDate || new Date().toISOString().slice(0, 10)).toString();
  return { success: true, item: { orderNumber: 'PO-000001', orderDate, sequence: 1 } };
});
fastify.get('/api/purchase-orders/next-number', async (request) => fastify
  .inject({ method: 'GET', url: '/purchase-orders/next-number', query: request.query })
  .then((r) => r.json()));

fastify.post('/purchase-orders', async (request) => ({ success: true, item: buildPurchaseOrder(request.body || {}) }));
fastify.post('/api/purchase-orders', async (request) => fastify
  .inject({ method: 'POST', url: '/purchase-orders', payload: request.body })
  .then((r) => r.json()));

fastify.post('/purchase-orders/drafts', async (request) => ({ success: true, item: buildPurchaseOrder({ ...(request.body || {}), status: 'draft' }) }));
fastify.post('/api/purchase-orders/drafts', async (request) => fastify
  .inject({ method: 'POST', url: '/purchase-orders/drafts', payload: request.body })
  .then((r) => r.json()));

fastify.put('/purchase-orders/drafts/:id', async (request) => ({ success: true, item: buildPurchaseOrder({ ...(request.body || {}), id: request.params.id, status: 'draft' }) }));
fastify.put('/api/purchase-orders/drafts/:id', async (request) => fastify
  .inject({ method: 'PUT', url: `/purchase-orders/drafts/${request.params.id}`, payload: request.body })
  .then((r) => r.json()));

fastify.put('/purchase-orders/:id/approve', async (request) => ({ success: true, item: buildPurchaseOrder({ id: request.params.id, approvedAt: new Date().toISOString(), status: 'open' }) }));
fastify.put('/api/purchase-orders/:id/approve', async (request) => fastify
  .inject({ method: 'PUT', url: `/purchase-orders/${request.params.id}/approve` })
  .then((r) => r.json()));

fastify.get('/purchase-orders/:id', async (request) => ({ success: true, item: buildPurchaseOrder({ id: request.params.id }) }));
fastify.get('/api/purchase-orders/:id', async (request) => fastify
  .inject({ method: 'GET', url: `/purchase-orders/${request.params.id}` })
  .then((r) => r.json()));

fastify.delete('/purchase-orders/:id', async (request) => ({ success: true, item: buildPurchaseOrder({ id: request.params.id }) }));
fastify.delete('/api/purchase-orders/:id', async (request) => fastify
  .inject({ method: 'DELETE', url: `/purchase-orders/${request.params.id}` })
  .then((r) => r.json()));

// 서버가 잘 작동하도록 하는 코드
fastify.listen({ port: 8787, host: '0.0.0.0' }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`서버가 ${address}에서 실행 중`);
});
