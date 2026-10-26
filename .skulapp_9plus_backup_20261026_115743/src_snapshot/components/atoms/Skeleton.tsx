interface SkeletonProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export default function Skeleton({ rows = 3, columns = 4, className = "" }: SkeletonProps) {
  return (
    <div className={`animate-pulse ${className}`}>
      <div className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4">
            {Array.from({ length: columns }).map((_, j) => (
              <div key={j} className="h-4 bg-gray-200 rounded flex-1 max-w-[200px]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}