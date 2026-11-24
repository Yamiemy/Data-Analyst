import React, { useState } from 'react';
import { HelpCircle } from 'lucide-react';

interface MetricTooltipProps {
  label?: string;
  explanation: string;
}

export const MetricTooltip: React.FC<MetricTooltipProps> = ({ label, explanation }) => {
  const [open, setOpen] = useState(false);

  return (
    <span
      className="relative inline-flex items-center align-middle"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        aria-label={label ? `Explain ${label}` : 'Metric explanation'}
        className="inline-flex items-center justify-center text-slate-400 hover:text-indigo-600 dark:text-slate-500 dark:hover:text-indigo-400 transition-colors focus:outline-none"
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-40 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-60 p-2.5 rounded-lg text-[11px] leading-relaxed font-normal normal-case tracking-normal text-left bg-slate-900 text-slate-100 dark:bg-slate-800 dark:text-slate-100 border border-slate-700 shadow-lg pointer-events-none"
        >
          {label && <span className="block font-semibold text-white mb-0.5">{label}</span>}
          {explanation}
        </span>
      )}
    </span>
  );
};
