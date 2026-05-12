import { cn } from '../lib/cn';

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  tone?: 'navy' | 'light';
  className?: string;
}

/**
 * Leylek wordmark with stork-silhouette mark. SVG inline so it inherits
 * `currentColor` — no asset pipeline needed. The "ek" letters get the
 * coral accent to anchor the brand.
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
      <svg
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(sizes.mark, 'shrink-0')}
        aria-hidden="true"
      >
        {/* Stylized stork: long beak + body + standing leg, mark of trust + direction */}
        <rect
          x="1"
          y="1"
          width="30"
          height="30"
          rx="7"
          fill="currentColor"
          className="text-primary"
        />
        <path
          d="M9 22 L9 16 C 9 11 13 8 17 8 L 22 8 L 26 5 L 22 11 L 18 11 C 15 11 13 13 13 16 L 13 22"
          stroke="#FFFFFF"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="22" cy="8" r="1.3" fill="#FF6B5C" />
        <path
          d="M11 22 L 13 26 M 11 22 L 9 26"
          stroke="#FFFFFF"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
      <span className={cn('leading-none tracking-[-0.02em]', sizes.text)}>
        Leyl<span className={accent}>ek</span>
      </span>
    </span>
  );
}
