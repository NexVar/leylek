import { cn } from '../lib/cn';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'navy' | 'light';
  className?: string;
}

/**
 * Leylek wordmark with the generated stork-growth mark. The "ek" letters get
 * the coral accent to anchor the brand.
 */
export function Logo({ size = 'md', tone = 'navy', className }: LogoProps) {
  const sizes = {
    sm: { wrap: 'gap-2', mark: 'w-6 h-6', text: 'text-[20px]' },
    md: { wrap: 'gap-2.5', mark: 'w-8 h-8', text: 'text-[26px]' },
    lg: { wrap: 'gap-3', mark: 'w-12 h-12', text: 'text-[42px]' },
  }[size];

  const baseColor = tone === 'light' ? 'text-primary-foreground' : 'text-primary';
  const accent = 'text-accent';

  return (
    <span
      className={cn(
        'inline-flex items-center font-display font-bold',
        sizes.wrap,
        baseColor,
        className,
      )}
    >
      <span
        className={cn(
          sizes.mark,
          'shrink-0 overflow-hidden rounded-sm',
          tone === 'light' && 'bg-primary-foreground p-0.5',
        )}
        aria-hidden="true"
      >
        <img
          src="/brand/leylek-mark.png"
          alt=""
          className="h-full w-full object-contain"
          draggable={false}
        />
      </span>
      <span className={cn('leading-none tracking-[-0.02em]', sizes.text)}>
        Leyl<span className={accent}>ek</span>
      </span>
    </span>
  );
}
