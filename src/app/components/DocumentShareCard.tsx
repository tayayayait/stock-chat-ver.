import React from 'react';

import { primaryActionButtonClass, secondaryActionButtonClass } from './buttonVariants';

type DocumentShareCardProps = {
  documentLabel: string;
  lineDetailLabel?: string;
  onPrint: () => void;
  onExport: () => void;
  isPrintDisabled?: boolean;
  isExportDisabled?: boolean;
  className?: string;
};

const DocumentShareCard: React.FC<DocumentShareCardProps> = ({
  documentLabel,
  onPrint,
  onExport,
  isPrintDisabled = false,
  isExportDisabled = false,
  lineDetailLabel = '라인 상세 포함',
  className,
}) => (
  <section className={`rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100 ${className ?? ''}`}>
    <div className="flex items-center justify-between">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">문서 공유</h3>
        <p className="text-[11px] text-slate-500">PDF / 프린터</p>
      </div>
      <span className="text-xs text-slate-500">{lineDetailLabel}</span>
    </div>
    <div className="mt-4 space-y-2 text-xs">
      <button
        type="button"
        onClick={onPrint}
        disabled={isPrintDisabled}
        className={`${primaryActionButtonClass} w-full justify-between`}
      >
        <span>{documentLabel} 인쇄</span>
        <span className="text-[11px] text-slate-400">PDF / 프린터</span>
      </button>
      <button
        type="button"
        onClick={onExport}
        disabled={isExportDisabled}
        className={`${secondaryActionButtonClass} w-full justify-between`}
      >
        <span>엑셀로 내보내기</span>
        <span className="text-[11px] text-slate-400">라인 상세 포함</span>
      </button>
    </div>
  </section>
);

export default DocumentShareCard;
