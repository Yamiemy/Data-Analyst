import React from 'react';

export const SkeletonBlock: React.FC<{ className?: string }> = ({ className = 'h-4 w-full' }) => (
  <div
    className={`animate-pulse rounded-md bg-slate-200/80 dark:bg-slate-800/80 ${className}`}
    aria-hidden="true"
  />
);

export const AnalysisSkeleton: React.FC<{ label?: string }> = ({ label }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 shadow-xs">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <div className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
        <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
          {label || 'Inspecting schema, executing calculations, and validating results…'}
        </span>
      </div>
      <SkeletonBlock className="h-4 w-20" />
    </div>
    <div className="space-y-2.5">
      <SkeletonBlock className="h-4 w-5/6" />
      <SkeletonBlock className="h-4 w-4/6" />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
      <SkeletonBlock className="h-16 w-full rounded-lg" />
      <SkeletonBlock className="h-16 w-full rounded-lg" />
      <SkeletonBlock className="h-16 w-full rounded-lg" />
    </div>
    <SkeletonBlock className="h-48 w-full rounded-xl" />
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({ rows = 5, cols = 5 }) => (
  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
    <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center gap-4">
      {Array.from({ length: cols }).map((_, idx) => (
        <SkeletonBlock key={idx} className="h-3.5 flex-1" />
      ))}
    </div>
    <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
      {Array.from({ length: rows }).map((_, rIdx) => (
        <div key={rIdx} className="px-4 py-3 flex items-center gap-4">
          {Array.from({ length: cols }).map((__, cIdx) => (
            <SkeletonBlock key={cIdx} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  </div>
);

export const CardGridSkeleton: React.FC<{ count?: number }> = ({ count = 3 }) => (
  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
    {Array.from({ length: count }).map((_, idx) => (
      <div
        key={idx}
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3"
      >
        <div className="flex items-center justify-between">
          <SkeletonBlock className="h-4 w-28" />
          <SkeletonBlock className="h-4 w-12" />
        </div>
        <SkeletonBlock className="h-3.5 w-full" />
        <SkeletonBlock className="h-3.5 w-4/5" />
        <SkeletonBlock className="h-10 w-full rounded-lg" />
      </div>
    ))}
  </div>
);
