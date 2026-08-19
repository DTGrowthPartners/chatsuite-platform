// El número de WhatsApp del cliente: si sigue conectado y, si no, el QR.
//
// Vive en el configurador y no solo en nuestro panel porque cuando una sesión
// se cae, el que se entera es el cliente —deja de recibir mensajes— y la
// solución es escanear un QR con SU teléfono. Hacerle esperar a que abramos
// nosotros el panel es media mañana sin WhatsApp.
import { useCallback, useEffect, useState } from 'react';
import { QrCode, RefreshCw } from 'lucide-react';

import { api, type EstadoWhatsapp, type Qr } from '@/api';
import { Button } from '@/components/ui/button';

/** 'open' es la única que significa que los mensajes están entrando. */
export const conectado = (e: EstadoWhatsapp | null) => e?.conexion === 'open';

export function Whatsapp({ slug }: { slug: string }) {
  const [estado, setEstado] = useState<EstadoWhatsapp | null>(null);
  const [qr, setQr] = useState<Qr | null>(null);
  const [cargando, setCargando] = useState(false);

  const mirar = useCallback(async () => {
    try { setEstado(await api.whatsapp.estado(slug)); } catch { /* se reintenta solo */ }
  }, [slug]);

  const pedirQr = useCallback(async () => {
    setCargando(true);
    try { setQr(await api.whatsapp.qr(slug)); } catch (e) { setQr({ base64: null, error: (e as Error).message }); }
    setCargando(false);
  }, [slug]);

  useEffect(() => {
    void mirar();
    // Mientras esta pantalla esté abierta se repregunta: así, en cuanto alguien
    // escanea, la pantalla lo confirma sola sin que nadie recargue.
    const t = setInterval(() => void mirar(), 8000);
    return () => clearInterval(t);
  }, [mirar]);

  // Evolution rota el QR cada ~40 s: uno viejo en pantalla es un QR que no
  // funciona y nadie sabe por qué.
  useEffect(() => {
    if (conectado(estado) || estado?.sinWhatsapp) return undefined;
    void pedirQr();
    const t = setInterval(() => void pedirQr(), 30000);
    return () => clearInterval(t);
  }, [estado, pedirQr]);

  if (!estado) return <p className="py-8 text-center text-sm text-muted-foreground">consultando…</p>;

  if (estado.sinWhatsapp) {
    return (
      <div className="grid gap-2 rounded-lg border p-4 text-sm">
        <p className="font-medium">Todavía no hay un número conectado</p>
        <p className="text-muted-foreground">
          El asistente aún no tiene línea de WhatsApp. Escríbenos y lo dejamos conectado
          con el número que uses para atender.
        </p>
      </div>
    );
  }

  if (conectado(estado)) {
    return (
      <div className="grid gap-3">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm">
          <p className="font-medium text-emerald-500">Tu WhatsApp está conectado</p>
          <p className="text-muted-foreground">
            Los mensajes entran a tu bandeja y el asistente responde. No hay nada que hacer aquí.
          </p>
        </div>
        <p className="text-xs text-muted-foreground">
          Si alguna vez cierras la sesión desde el teléfono («Dispositivos vinculados»),
          vuelve a esta pantalla: aparecerá un código para reconectar.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm">
        <p className="font-medium text-amber-500">Tu WhatsApp no está conectado</p>
        <p className="text-muted-foreground">
          Mientras esté así, el asistente no recibe ni responde mensajes. Escanea el código
          con el teléfono del negocio: <strong>WhatsApp → Ajustes → Dispositivos vinculados →
          Vincular un dispositivo</strong>.
        </p>
      </div>

      <div className="grid justify-items-center gap-3 rounded-lg border p-4">
        {qr?.base64 ? (
          <img
            src={qr.base64}
            alt="Código QR para vincular WhatsApp"
            className="size-64 rounded-lg bg-white p-2"
          />
        ) : (
          <div className="grid size-64 place-items-center rounded-lg border border-dashed text-center text-xs text-muted-foreground">
            <span>
              <QrCode className="mx-auto mb-2 size-6 opacity-60" />
              {/* El error de red crudo ("fetch failed") no le dice nada a quien
                  atiende: lo que necesita saber es si reintentar o escribirnos. */}
              {qr?.error ? 'no pude generar el código ahora mismo — reinténtalo o escríbenos' : 'generando el código…'}
            </span>
          </div>
        )}
        {qr?.pairing ? (
          <p className="text-center text-xs text-muted-foreground">
            ¿No puedes escanear? Usa el código de vinculación:{' '}
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{qr.pairing}</code>
          </p>
        ) : null}
        <Button variant="outline" size="sm" onClick={() => void pedirQr()} disabled={cargando}>
          <RefreshCw className={cargando ? 'size-4 animate-spin' : 'size-4'} />
          {cargando ? 'pidiendo…' : 'Generar otro código'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          El código se renueva solo cada 30 segundos. En cuanto escanees, esta pantalla lo confirma.
        </p>
      </div>
    </div>
  );
}
