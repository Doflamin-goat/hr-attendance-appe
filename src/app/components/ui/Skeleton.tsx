type Props = {
  className?: string;
  rounded?: "sm" | "md" | "lg" | "full";
};

const roundedClass = {
  sm: "rounded",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
};

export function Skeleton({ className = "", rounded = "md" }: Props) {
  return (
    <span
      aria-hidden="true"
      className={`ui-skeleton block ${roundedClass[rounded]} ${className}`}
    />
  );
}

export function SkeletonTable({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className="px-5 py-4 space-y-3" aria-busy="true">
      {Array.from({ length: rows }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className="flex items-center gap-4"
          style={{ animationDelay: `${rowIdx * 60}ms` }}
        >
          <Skeleton rounded="full" className="h-10 w-10 flex-shrink-0" />
          {Array.from({ length: columns - 1 }).map((__, colIdx) => (
            <Skeleton
              key={colIdx}
              className={`h-4 ${colIdx === 0 ? "w-40" : "w-20"}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonStatCard() {
  return (
    <div
      className="bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5"
      aria-busy="true"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 space-y-3">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
        <Skeleton className="h-10 w-10" rounded="lg" />
      </div>
    </div>
  );
}

export function SkeletonStatGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, idx) => (
        <SkeletonStatCard key={idx} />
      ))}
    </div>
  );
}

export function SkeletonDashboardCard({ lines = 3 }: { lines?: number }) {
  return (
    <div
      className="bg-white rounded-xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden"
      aria-busy="true"
    >
      <div className="px-5 pt-5 pb-3 flex items-center gap-3">
        <Skeleton className="h-9 w-9" rounded="lg" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="px-5 pb-5 space-y-3">
        {Array.from({ length: lines }).map((_, idx) => (
          <Skeleton key={idx} className={`h-3 ${idx === lines - 1 ? "w-3/4" : "w-full"}`} />
        ))}
      </div>
    </div>
  );
}
