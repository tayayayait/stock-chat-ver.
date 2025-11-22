const actionPillBase =
  'flex h-10 items-center rounded-full px-4 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed';

export const primaryActionButtonClass = `${actionPillBase} bg-primary-600 text-white hover:bg-primary-700 disabled:bg-primary-300 disabled:text-white/70`;
export const secondaryActionButtonClass = `${actionPillBase} border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:border-slate-200 disabled:text-slate-400 disabled:bg-white`;
