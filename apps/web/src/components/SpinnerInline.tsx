import { cn } from '../lib/cn';

interface SpinnerInlineProps {
  size?: number;
  className?: string;
  label?: string;
}

/**
 * 16px-default coral spinner used inside buttons and inline statuses.
 * Pure SVG so it inherits color and doesn't pull in an icon library.
 */
export function SpinnerInline({ size = 16, className, label }: SpinnerInlineProps) {
  const accessibleLabel = label ?? 'Yükleniyor';
  return (
    <span role="status" className={cn('inline-flex items-center justify-center', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="animate-spin-slow"
        role="img"
        aria-labelledby="spinnerinline-title"
      >
        <title id="spinnerinline-title">{accessibleLabel}</title>
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2.5"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
