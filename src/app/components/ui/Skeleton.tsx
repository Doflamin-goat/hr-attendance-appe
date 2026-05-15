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
