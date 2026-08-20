import { useState } from 'react';
import { motion } from 'motion/react';
import {
  ExternalLink, MoreVertical, Play, Square, Archive, RotateCw, Trash2, Info, Bot, QrCode, PauseCircle, PlayCircle,
} from 'lucide-react';

import { api, type Tenant } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

// Un color por estado. Van como clases y no como variantes de Badge porque el
// verde y el ambar no existen en la paleta de shadcn.
const COLOR_ESTADO: Record<Tenant['estado'], string> = {
  activo: 'border-emerald-500/30 bg-emerald-500/12 text-emerald-400',
  aprovisionando: 'border-sky-400/30 bg-sky-400/12 text-sky-300',
  error: 'border-destructive/40 bg-destructive/12 text-destructive',
  detenido: 'border-border bg-muted text-muted-foreground',
  suspendido: 'border-amber-500/40 bg-amber-500/12 text-amber-400',
  pendiente: 'border-border bg-muted text-muted-foreground',
};

type Props = {
  tenant: Tenant;
  indice: number;
  alDetalle: (slug: string) => void;
  alBot: (tenant: Tenant) => void;
  alWhatsapp: (tenant: Tenant) => void;
  alAccion: (slug: string, accion: string) => void;
  alBorrar: (tenant: Tenant) => void;
};

export function TarjetaCliente({
  tenant: t, indice, alDetalle, alBot, alWhatsapp, alAccion, alBorrar,
}: Props) {
  const trabajando = t.estado === 'aprovisionando';
  // 'cargando' | 'lockup' | 'icono' | 'sin'
  //
  // Un logo ancho es un lockup: ya lleva el nombre del negocio escrito dentro
  // (el de CompuXtreme es la X mas "COMPUXTREME"). Repetirlo al lado en texto
  // es decir dos veces lo mismo, y ademas obliga a encoger el logo hasta que no
  // se lee. Con la proporcion real de la imagen se decide: ancho manda el logo
  // solo, cuadrado se queda el par icono + nombre.
  const [logo, setLogo] = useState<'cargando' | 'lockup' | 'icono' | 'sin'>('cargando');
  const contenedores = t.contenedores
    ? Object.entries(t.contenedores).map(([k, v]) => `${k}:${v}`).join(' · ')
    : 'sin contenedores';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18 } }}
      transition={{ duration: 0.34, delay: Math.min(indice * 0.045, 0.3), ease: [0.22, 1, 0.36, 1] }}
    >
      <Card className="group h-full gap-3 p-5 transition-colors hover:border-white/18">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            {/* Sin fondo: el logo va directo sobre la tarjeta. Solo cuando NO
                hay archivo queda el cuadro del color de marca, para que el hueco
                no parezca un icono roto. `contain` y no `cover` porque un logo
                recortado deja de ser el logo. */}
            <span
              className={cn(
                'grid shrink-0 place-items-center overflow-hidden rounded-lg',
                logo === 'lockup' ? 'h-9 max-w-44' : 'size-9',
                logo === 'sin' && 'size-9 ring-1 ring-white/15',
              )}
              style={logo === 'sin' ? { background: t.color } : undefined}
            >
              <img
                src={api.urlLogo(t.slug)}
                alt={logo === 'lockup' ? t.nombre : ''}
                aria-hidden={logo !== 'lockup'}
                loading="lazy"
                className={cn(
                  'max-h-full max-w-full object-contain',
                  logo === 'lockup' ? 'py-0.5' : 'size-full',
                  logo === 'cargando' && 'opacity-0',
                )}
                onLoad={(e) => {
                  const img = e.currentTarget;
                  setLogo(img.naturalWidth / img.naturalHeight > 2.2 ? 'lockup' : 'icono');
                }}
                // Sin logo en disco —un alta a medias, o uno viejo— el cuadro se
                // queda como muestra de color en vez de dejar el icono roto.
                onError={(e) => { e.currentTarget.style.display = 'none'; setLogo('sin'); }}
              />
            </span>
            {logo !== 'lockup' && (
              <h3 className="truncate text-base font-semibold">{t.nombre}</h3>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon" className="-mr-1 -mt-1 size-8 shrink-0" />}
            >
              <MoreVertical className="size-4" />
              <span className="sr-only">Acciones de {t.nombre}</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => alDetalle(t.slug)}>
                <Info /> Detalle y credenciales
              </DropdownMenuItem>
              {/* Solo con el Chatsuite listo: el bot necesita su API para
                  crear el AgentBot y sacar los tokens. */}
              {t.estado === 'activo' && (
                <DropdownMenuItem onClick={() => alBot(t)}>
                  <Bot /> Bot: configurar y probar
                </DropdownMenuItem>
              )}
              {t.estado === 'activo' && (
                <DropdownMenuItem onClick={() => alWhatsapp(t)}>
                  <QrCode /> WhatsApp: conectar el número
                </DropdownMenuItem>
              )}
              {t.estado === 'error' && (
                <DropdownMenuItem onClick={() => alAccion(t.slug, 'reintentar')}>
                  <RotateCw /> Reintentar el alta
                </DropdownMenuItem>
              )}
              {t.estado === 'detenido' ? (
                <DropdownMenuItem onClick={() => alAccion(t.slug, 'arrancar')}>
                  <Play /> Arrancar
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => alAccion(t.slug, 'detener')}>
                  <Square /> Detener
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => alAccion(t.slug, 'respaldar')}>
                <Archive /> Respaldar ahora
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Corta el servicio sin borrar nada: apaga el bot, el WhatsApp y
                  el Chatsuite, y publica una página que lo explica. */}
              {t.estado === 'suspendido' ? (
                <DropdownMenuItem onClick={() => alAccion(t.slug, 'reanudar')}>
                  <PlayCircle /> Reanudar el servicio
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={() => alAccion(t.slug, 'suspender')}>
                  <PauseCircle /> Suspender el servicio
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => alBorrar(t)}>
                <Trash2 /> Borrar
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <a
          href={`https://${t.dominio}`}
          target="_blank"
          rel="noopener"
          className="inline-flex w-fit items-center gap-1.5 text-sm text-marca-2 hover:underline"
        >
          {t.dominio}
          <ExternalLink className="size-3.5" />
        </a>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn('gap-1.5 font-medium', COLOR_ESTADO[t.estado])}>
            <span
              className={cn(
                'size-1.5 rounded-full bg-current',
                // El punto late solo mientras hay trabajo en curso; dejarlo
                // siempre animado convierte el panel en un arbol de navidad.
                trabajando && 'animate-pulse',
              )}
            />
            {t.estado}
          </Badge>
          <span className="text-xs text-muted-foreground tabular-nums">puerto {t.puerto}</span>
        </div>

        {t.error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {t.error}
          </p>
        )}

        <p className="mt-auto truncate pt-1 text-xs text-muted-foreground">{contenedores}</p>
      </Card>
    </motion.div>
  );
}
