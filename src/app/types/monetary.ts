export type MonetaryMode = 'inclusive' | 'exclusive' | 'unknown';

export interface MonetaryBreakdownEntry {
  key: string;
  name: string;
  rate: number | null;
  mode: MonetaryMode;
  base: number;
  amount: number;
}

export interface MonetarySummary {
  lineTotal: number;
  baseTotal: number;
  taxTotal: number;
  total: number;
  breakdown: MonetaryBreakdownEntry[];
}
