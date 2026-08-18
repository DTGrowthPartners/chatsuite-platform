import { cn } from '@/lib/utils';

/** Isotipo del panel: el cuadrado con el degradado de marca. */
export function Marca({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-block rounded-[0.62rem] bg-gradient-to-br from-marca to-marca-2',
        'shadow-[0_0_0_1px_rgb(255_255_255/10%),0_8px_28px_color-mix(in_oklch,var(--color-marca)_38%,transparent)]',
        className,
      )}
      aria-hidden
    />
  );
}
