import { cn } from '@/lib/utils';

/**
 * Isotipo del panel: el monograma DT sobre el degradado de marca.
 *
 * Antes era un cuadrado de color a secas. El mismo archivo alimenta el favicon
 * (`public/icono.png`), asi que la pestaña del navegador y la cabecera muestran
 * exactamente la misma pieza, que es de lo que vive el reconocimiento.
 */
export function Marca({ className }: { className?: string }) {
  return (
    <img
      src="/icono.png"
      alt=""
      aria-hidden
      className={cn('inline-block rounded-[0.62rem] object-contain', className)}
    />
  );
}

/**
 * El lockup completo, blanco sobre transparente. Va en cabeceras, donde hay
 * sitio a lo ancho y el nombre de la empresa aporta mas que el simbolo solo.
 */
export function LockupDTGP({ className }: { className?: string }) {
  return (
    <img
      src="/dt-logo.png"
      alt="DT Growth Partners"
      width={2000}
      height={564}
      className={cn('lockup-dtgp w-auto object-contain', className)}
    />
  );
}
