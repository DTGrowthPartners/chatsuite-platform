// Conectar el WhatsApp del cliente: Evolution y el QR.
//
// El QR lo escanea el CLIENTE con su celular, así que esta pantalla se hace
// para mostrarse en una llamada o mandarse por captura. Se repregunta solo,
// porque Evolution lo rota cada ~40 segundos.
import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Link2, Loader2, QrCode, RefreshCw, Unplug } from 'lucide-react';
import { toast } from 'sonner';

import { api, type EstadoWhatsapp, type Qr, type Tenant } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

const TEXTO_CONEXION: Record<string, string> = {
  open: 'conectado',
  connecting: 'esperando el escaneo',
  close: 'desconectado',
};

export function DialogoWhatsapp({
  tenant, alCerrar, alJob,
}: { tenant: Tenant | null; alCerrar: () => void; alJob: (id: string, titulo: string) => void }) {
  const [estado, setEstado] = useState<EstadoWhatsapp | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [cargando, setCargando] = useState(false);
  const temporizador = useRef<number | null>(null);

  const slug = tenant?.slug;
  const conectado = estado?.conexion === 'open';

  const refrescar = useCallback(async () => {
    if (!slug) return;
    try {
      const e = await api.whatsapp.estado(slug);
      setEstado(e);
      // Ya conectado no hay QR que pedir, y pedirlo reabriría el pareo.
      if (e.sinWhatsapp || e.conexion === 'open') { setQr(null); return; }
      setQr(await api.whatsapp.qr(slug));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, [slug]);

  useEffect(() => {
    if (!slug) { setEstado(null); setQr(null); return undefined; }
    void refrescar();
    // Mientras no esté conectado se repregunta: el QR caduca solo.
    temporizador.current = window.setInterval(() => { void refrescar(); }, 20000);
    return () => { if (temporizador.current) window.clearInterval(temporizador.current); };
  }, [slug, refrescar]);

  async function accion(nombre: string, titulo: string) {
    if (!slug) return;
    setCargando(true);
    try {
      const { job } = await api.whatsapp.accion(slug, nombre);
      alJob(job, titulo);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setCargando(false);
    }
  }

  return (
    <Dialog open={!!tenant} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="size-5" /> WhatsApp de {tenant?.nombre}
          </DialogTitle>
          <DialogDescription>
            El QR lo escanea el cliente desde su celular: WhatsApp → Dispositivos vinculados.
          </DialogDescription>
        </DialogHeader>

        {!estado ? (
          <p className="py-10 text-center text-sm text-muted-foreground">cargando…</p>
        ) : estado.sinWhatsapp ? (
          <div className="grid justify-items-center gap-3 py-8 text-center">
            <p className="text-sm text-muted-foreground">
              Este cliente todavía no tiene canal. Se levanta su Evolution, se crea la
              instancia y se enlaza con su Chatsuite. Tarda un par de minutos.
            </p>
            <p className="text-xs text-muted-foreground">
              Ocupa unos 190&nbsp;MB de RAM. Es propio del cliente, no compartido.
            </p>
            <Button
              disabled={cargando}
              onClick={async () => {
                if (!slug) return;
                setCargando(true);
                try {
                  const { job } = await api.whatsapp.preparar(slug);
                  alJob(job, `WhatsApp de ${tenant?.nombre}`);
                  alCerrar();
                } catch (err) { toast.error((err as Error).message); }
                finally { setCargando(false); }
              }}
            >
              {cargando && <Loader2 className="animate-spin" />} Conectar WhatsApp
            </Button>
          </div>
        ) : (
          <div className="grid gap-4">
            <div className="flex items-center justify-between gap-3">
              <Badge
                variant="outline"
                className={conectado
                  ? 'border-emerald-500/30 bg-emerald-500/12 text-emerald-400'
                  : 'border-amber-500/30 bg-amber-500/12 text-amber-400'}
              >
                {TEXTO_CONEXION[estado.conexion || ''] || estado.conexion || 'sin estado'}
              </Badge>
              <Button variant="ghost" size="sm" onClick={() => void refrescar()}>
                <RefreshCw className="size-3.5" /> Actualizar
              </Button>
            </div>

            {conectado ? (
              <div className="grid justify-items-center gap-3 rounded-lg border p-6 text-center">
                <CheckCircle2 className="size-10 text-emerald-400" />
                <p className="text-sm">El número está conectado y espejando a Chatsuite.</p>
                <p className="text-xs text-muted-foreground">
                  Falta un paso: enlazar el inbox con el bot y apagar la asignación
                  automática. Sin eso la conversación nace asignada y el bot no la ve nunca.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button
                    disabled={cargando}
                    onClick={() => void accion('enlazar', `Enlazando el bot de ${tenant?.nombre}`)}
                  >
                    <Link2 className="size-4" /> Enlazar el bot al inbox
                  </Button>
                  <Button
                    variant="outline"
                    disabled={cargando}
                    onClick={() => void accion('desconectar', `Desconectando ${tenant?.nombre}`)}
                  >
                    <Unplug className="size-4" /> Desconectar
                  </Button>
                </div>
              </div>
            ) : qr?.base64 ? (
              <div className="grid justify-items-center gap-3">
                <img
                  src={qr.base64}
                  alt="Código QR de WhatsApp"
                  className="size-64 rounded-lg bg-white p-2"
                />
                <p className="text-xs text-muted-foreground">
                  Se renueva solo cada pocos segundos. No cierres esta ventana mientras escanean.
                </p>
                {qr.pairing ? (
                  <p className="text-sm">
                    ¿No pueden escanear? Código de vinculación:{' '}
                    <code className="rounded bg-muted px-1.5 py-0.5">{qr.pairing}</code>
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="grid justify-items-center gap-3 rounded-lg border border-dashed p-8 text-center">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {qr?.error || 'Generando el código…'}
                </p>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              El historial de 90 días solo se importa <strong>al conectar</strong>. Si hace
              falta y ya se escaneó, hay que desconectar y volver a escanear.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
