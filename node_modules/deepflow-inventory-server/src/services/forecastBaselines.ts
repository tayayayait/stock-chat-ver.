import { getLeadTimeStatsForSku } from '../stores/leadTimeStore.js';
import { __getProductRecords } from '../routes/products.js';
const DEFAULT_LEAD_TIME_DAYS = 14;

const parseEnvFloat = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseEnvInt = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (!raw) {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const clampServiceLevelPercent = (value: number): number => {
  const clamped = Math.max(50, Math.min(99.9, Math.round(value * 10) / 10));
  return Number.isFinite(clamped) ? clamped : 50;
};

const LEAD_TIME_PERCENTILE = Math.min(90, Math.max(0, parseEnvInt('LEAD_TIME_PERCENTILE', 50)));
const LEAD_TIME_MIN_SAMPLES = Math.max(1, parseEnvInt('LEAD_TIME_MIN_SAMPLES', 5));
export const LEAD_TIME_ADJUST_MAX_PCT = Math.max(0, parseEnvFloat('LEAD_TIME_ADJUST_MAX_PCT', 0.2));
const SERVICE_LEVEL_BASE = clampServiceLevelPercent(parseEnvFloat('SERVICE_LEVEL_BASE', 95));
export const SERVICE_LEVEL_ADJUST_MAX_PCT = Math.max(0, parseEnvFloat('SERVICE_LEVEL_ADJUST_MAX_PCT', 3));

const RISK_SHORTAGE = '결품위험';
const RISK_OVERSTOCK = '과잉';

const ABC_XYZ_TARGETS: Record<string, number> = {
  'A/X': 98,
  'A/Y': 97,
  'A/Z': 95,
  'B/X': 97,
  'B/Y': 96,
  'B/Z': 94,
  'C/X': 95,
  'C/Y': 93,
  'C/Z': 92,
};

const RISK_ADJUSTMENTS: Record<string, number> = {
  [RISK_SHORTAGE]: 3,
  [RISK_OVERSTOCK]: -3,
};

interface LeadTimeBaselineInput {
  sku?: string;
}

interface LeadTimeBaseline {
  leadTimeDays: number | null;
  sigma: number | null;
  sampleCount: number;
  percentile: number;
  notes: string[];
}

interface ServiceLevelBaselineInput {
  sku?: string;
}

interface ServiceLevelBaseline {
  serviceLevelPercent: number;
  notes: string[];
}

const buildFallbackLeadTimeNote = (count: number) => {
  if (count > 0) {
    return `샘플이 ${count}건으로 ${LEAD_TIME_MIN_SAMPLES}건 미만이므로 기본 ${DEFAULT_LEAD_TIME_DAYS}일을 사용합니다.`;
  }
  return '리드타임 샘플이 없어 기본 14일을 사용합니다.';
};

export const computeLeadTimeBaseline = (input: LeadTimeBaselineInput): LeadTimeBaseline => {
  const notes: string[] = [];
  const normalizedSku = input.sku?.trim().toUpperCase();
  if (!normalizedSku) {
    notes.push('SKU 정보가 없어 기본 리드타임을 사용합니다.');
    return {
      leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
      sigma: null,
      sampleCount: 0,
      percentile: LEAD_TIME_PERCENTILE,
      notes,
    };
  }

  const stats = getLeadTimeStatsForSku(normalizedSku);
  if (!stats || stats.count < LEAD_TIME_MIN_SAMPLES) {
    notes.push(buildFallbackLeadTimeNote(stats?.count ?? 0));
    return {
      leadTimeDays: DEFAULT_LEAD_TIME_DAYS,
      sigma: stats?.sigma ?? null,
      sampleCount: stats?.count ?? 0,
      percentile: LEAD_TIME_PERCENTILE,
      notes,
    };
  }

  const percentileUsed = LEAD_TIME_PERCENTILE >= 90 ? 90 : 50;
  const percentileValue = percentileUsed === 90 ? stats.l90 : stats.l50;
  const rounded = Math.max(1, Math.round(percentileValue));
  notes.push(
    `${stats.count}건 리드타임 샘플의 p${percentileUsed}(${rounded}일)을 사용합니다.`,
  );

  return {
    leadTimeDays: rounded,
    sigma: stats.sigma,
    sampleCount: stats.count,
    percentile: percentileUsed,
    notes,
  };
};

export const computeServiceLevelBaseline = (input: ServiceLevelBaselineInput): ServiceLevelBaseline => {
  const notes: string[] = [];
  const normalizedSku = input.sku?.trim().toUpperCase();
  const records = __getProductRecords();
  const product =
    normalizedSku &&
    records.find((entry) => entry.sku.trim().toUpperCase() === normalizedSku);

  let level = SERVICE_LEVEL_BASE;

  if (product) {
    const key = `${product.abcGrade}/${product.xyzGrade}`;
    const target = ABC_XYZ_TARGETS[key];
    if (typeof target === 'number') {
      level = target;
      notes.push(`${key} 기준 ${target}%로 기본 서비스를 설정합니다.`);
    } else {
      notes.push('ABC/XYZ 기준 정보를 확인해 기본값을 사용합니다.');
    }
  } else {
    notes.push('제품 메타 정보가 없어 기본 서비스 수준을 사용합니다.');
  }

  const risk = product?.risk;
  if (risk && Object.prototype.hasOwnProperty.call(RISK_ADJUSTMENTS, risk)) {
    const adjustment = RISK_ADJUSTMENTS[risk];
    level += adjustment;
    notes.push(`${risk} 리스크에 따라 ${adjustment > 0 ? '+' : ''}${adjustment}%p 보정합니다.`);
  }

  const serviceLevelPercent = clampServiceLevelPercent(level);
  return {
    serviceLevelPercent,
    notes,
  };
};
