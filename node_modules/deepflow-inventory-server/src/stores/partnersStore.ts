import { randomUUID } from 'node:crypto';

export type PartnerType = 'SUPPLIER' | 'CUSTOMER';

export interface PartnerRecord {
  id: string;
  type: PartnerType;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  isSample: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListPartnersOptions {
  type?: PartnerType;
  includeSample?: boolean;
}

interface PartnerSeed extends Omit<PartnerRecord, 'createdAt' | 'updatedAt'> {}

const partnerStore = new Map<string, PartnerRecord>();

const samplePartners: PartnerSeed[] = [
  {
    id: 'partner-s-1',
    type: 'SUPPLIER',
    name: '한빛식품',
    phone: '02-1234-5678',
    email: 'sales@hanbitfood.co.kr',
    address: '서울특별시 성동구 성수이로 77',
    isSample: true,
    isActive: true,
  },
  {
    id: 'partner-s-2',
    type: 'SUPPLIER',
    name: '코리아패키징',
    phone: '031-987-6543',
    email: 'order@korpack.kr',
    address: '경기도 안산시 단원구 고잔로 22',
    isSample: true,
    isActive: true,
  },
  {
    id: 'partner-s-cheongho',
    type: 'SUPPLIER',
    name: '청호유통',
    phone: '02-345-1122',
    email: 'info@cheongho.co.kr',
    address: '서울특별시 구로구 디지털로 201',
    isSample: true,
    isActive: true,
  },
  {
    id: 'partner-c-1',
    type: 'CUSTOMER',
    name: '스타마켓 강남점',
    phone: '02-333-0001',
    email: 'stock@starmarket.kr',
    address: '서울특별시 강남구 테헤란로 320',
    isSample: true,
    isActive: true,
  },
  {
    id: 'partner-c-2',
    type: 'CUSTOMER',
    name: '프레시몰 온라인',
    phone: '02-444-0020',
    email: 'ops@freshmall.co.kr',
    address: '서울특별시 송파구 위례성대로 55',
    isSample: true,
    isActive: true,
  },
];

const ensureSeedData = () => {
  if (partnerStore.size > 0) {
    return;
  }

  const timestamp = new Date().toISOString();
  samplePartners.forEach((entry) => {
    partnerStore.set(entry.id, {
      ...entry,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
};

const normalizeOptional = (value: string | null | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const generatePartnerId = (type: PartnerType): string => {
  const prefix = type === 'SUPPLIER' ? 'partner-s' : 'partner-c';
  return `${prefix}-${randomUUID().slice(0, 8)}`;
};

export function listPartners(options: ListPartnersOptions = {}) {
  ensureSeedData();
  const { type, includeSample = false } = options;

  return Array.from(partnerStore.values())
    .filter((partner) => (includeSample ? true : !partner.isSample))
    .filter((partner) => (type ? partner.type === type : true))
    .map((partner) => ({ ...partner }));
}

export function createPartner(input: {
  type: PartnerType;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
}) {
  ensureSeedData();
  const now = new Date().toISOString();
  const record: PartnerRecord = {
    id: generatePartnerId(input.type),
    type: input.type,
    name: input.name,
    phone: normalizeOptional(input.phone),
    email: normalizeOptional(input.email),
    address: normalizeOptional(input.address),
    notes: normalizeOptional(input.notes),
    isSample: false,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
  partnerStore.set(record.id, record);
  return { ...record };
}

export function updatePartner(input: {
  id: string;
  type?: PartnerType;
  name?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
}) {
  ensureSeedData();
  const target = partnerStore.get(input.id);
  if (!target) {
    throw new Error('요청한 거래처를 찾을 수 없습니다.');
  }

  const nextType = input.type ?? target.type;
  if (nextType !== 'SUPPLIER' && nextType !== 'CUSTOMER') {
    throw new Error('거래처 유형을 선택하세요.');
  }

  const nextName = input.name?.trim() ?? target.name;
  if (!nextName) {
    throw new Error('거래처명을 입력하세요.');
  }

  const updated: PartnerRecord = {
    ...target,
    type: nextType,
    name: nextName,
    phone: normalizeOptional(input.phone ?? undefined) ?? undefined,
    email: normalizeOptional(input.email ?? undefined) ?? undefined,
    address: normalizeOptional(input.address ?? undefined) ?? undefined,
    notes: normalizeOptional(input.notes ?? undefined) ?? undefined,
    isActive: typeof input.isActive === 'boolean' ? input.isActive : target.isActive,
    updatedAt: new Date().toISOString(),
  };

  partnerStore.set(updated.id, updated);
  return { ...updated };
}

export function deletePartner(partnerId: string) {
  ensureSeedData();
  const existing = partnerStore.get(partnerId);
  if (!existing) {
    throw new Error('요청한 거래처를 찾을 수 없습니다.');
  }
  partnerStore.delete(partnerId);
  return { ...existing };
}

export function __resetPartnerStore() {
  partnerStore.clear();
}
