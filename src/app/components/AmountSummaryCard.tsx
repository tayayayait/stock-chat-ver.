import React from 'react';

import { formatCurrency } from '@/src/utils/format';
import type { MonetarySummary, MonetaryBreakdownEntry } from '@/app/types/monetary';

type AmountSummaryCardProps = {
  summary: MonetarySummary;
  className?: string;
};

const buildBreakdownLabel = (entry: MonetaryBreakdownEntry) => {
  if (entry.rate === null) {
    return entry.name;
  }
  const rateLabel = `${(entry.rate * 100).toFixed(0)}%`;
  const modeLabel = entry.mode === 'inclusive' ? '포함' : entry.mode === 'exclusive' ? '별도' : '';
  const parts = [`${formatCurrency(entry.base)}에 대한`, rateLabel];
  if (modeLabel) {
    parts.push(modeLabel);
  }
  return `${entry.name} (${parts.join(' ')})`;
};

const AmountSummaryCard: React.FC<AmountSummaryCardProps> = ({ summary, className }) => (
  <div className={`rounded-2xl border border-slate-100 bg-slate-50 p-5 text-sm text-slate-600 ${className ?? ''}`}>
    <h3 className="text-sm font-semibold text-slate-900">금액 요약</h3>
    <dl className="mt-3 space-y-3">
      <div className="flex items-center justify-between">
        <dt>소계</dt>
        <dd className="font-medium text-slate-900">{formatCurrency(summary.lineTotal)}</dd>
      </div>
      <div className="flex items-center justify-between">
        <dt>총액 (세금 제외)</dt>
        <dd className="font-medium text-slate-900">{formatCurrency(summary.baseTotal)}</dd>
      </div>
      {summary.breakdown.map((entry) => (
        <div key={entry.key} className="flex items-center justify-between">
          <dt className="text-xs text-slate-500">{buildBreakdownLabel(entry)}</dt>
          <dd className="font-medium text-slate-900">{formatCurrency(entry.amount)}</dd>
        </div>
      ))}
      <div className="flex items-center justify-between text-sm">
        <dt className="font-semibold text-slate-900">총액</dt>
        <dd className="text-base font-semibold text-slate-900">{formatCurrency(summary.total)}</dd>
      </div>
    </dl>
  </div>
);

export default AmountSummaryCard;
