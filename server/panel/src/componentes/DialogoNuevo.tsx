import { useRef, useState } from 'react';
import { ChevronDown, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';

import { api, leerArchivo } from '@/api';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

type Props = {
  abierto: boolean;
  dominioBase: string;
  alCerrar: () => void;
  alCreado: (job: { id: string; slug: string; titulo: string }) => void;
};

const HORAS = Array.from({ length: 25 }, (_, i) => i);

const SELECT = 'h-9 w-full cursor-pointer rounded-md border bg-transparent px-3 text-sm '
  + 'outline-none focus:border-ring';

export function DialogoNuevo({ abierto, dominioBase, alCerrar, alCreado }: Props) {
  const [nombre, setNombre] = useState('');
  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [color, setColor] = useState('#007FFC');
  // El hex se escribe aparte del selector: lo que teclea el usuario puede estar
  // a medias ("#00") y no debe pintar la marca hasta estar completo.
  const [hex, setHex] = useState('#007FFC');
  const [quitarFondo, setQuitarFondo] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [nombreLogo, setNombreLogo] = useState('');
  const [pistaColor, setPistaColor] = useState('Se sugiere solo al subir el logo.');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Opciones que casi siempre sirven por defecto. Van plegadas para que el alta
  // normal siga siendo cuatro campos y un logo.
  const [avanzado, setAvanzado] = useState(false);
  const [marca, setMarca] = useState('');
  const [sitio, setSitio] = useState('');
  const [ciudad, setCiudad] = useState('');
  const [idioma, setIdioma] = useState('es');
  const [zona, setZona] = useState('America/Bogota');
  const [conBot, setConBot] = useState(false);
  const [asistente, setAsistente] = useState('');
  // Que sabe hacer el bot. Se elige aqui y no despues porque decide las
  // etiquetas que se crean en Chatsuite y las pestañas del configurador. Son
  // casillas y no opciones excluyentes: el motor combina los modulos, y una
  // barberia que ademas vende productos quiere los dos.
  const [modulosBot, setModulosBot] = useState<string[]>(['tienda']);
  // Sin esto el cliente carga sus zonas en la pestaña Domicilios y el bot no
  // ofrece ninguna: el modulo mira este interruptor, no si hay zonas.
  const [domicilios, setDomicilios] = useState(false);
  // A quien avisa el bot cuando alguien pide un humano. Si esto queda vacio, la
  // nota se escribe en Chatsuite y NADIE recibe el aviso por WhatsApp.
  const [telefonoAvisos, setTelefonoAvisos] = useState('');
  const [horaInicio, setHoraInicio] = useState(8);
  const [horaFin, setHoraFin] = useState(20);
  // Deja Evolution levantado y la instancia creada, con el QR esperando en la
  // tarjeta. Escanear es lo unico que no puede hacer el panel.
  const [conWhatsapp, setConWhatsapp] = useState(false);
  // El historial se importa SOLO al escanear: si no se pide aqui, recuperarlo
  // despues obliga a desconectar el numero y volver a escanear.
  const [importarHistorial, setImportarHistorial] = useState(false);

  // Si el usuario ya eligio color a mano, subir otro logo no se lo pisa.
  const colorManual = useRef(false);

  function limpiar() {
    setNombre(''); setSlug(''); setEmail(''); setColor('#007FFC'); setHex('#007FFC');
    setQuitarFondo(false); setLogo(null); setNombreLogo('');
    setPistaColor('Se sugiere solo al subir el logo.'); setError(null);
    setAvanzado(false); setMarca(''); setSitio(''); setCiudad('');
    setIdioma('es'); setZona('America/Bogota'); setConBot(false); setAsistente('');
    setModulosBot(['tienda']); setDomicilios(false); setTelefonoAvisos('');
    setHoraInicio(8); setHoraFin(20);
    setConWhatsapp(false); setImportarHistorial(false);
    colorManual.current = false;
  }

  // El slug se propone desde el nombre mientras no se toque a mano.
  const slugTocado = useRef(false);
  function cambiarNombre(v: string) {
    setNombre(v);
    if (slugTocado.current) return;
    setSlug(
      v.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32),
    );
  }

  // El color de marca casi siempre lo manda el cliente como hex, y el selector
  // nativo no deja pegarlo en todos los navegadores. Se acepta con # o sin el,
  // y solo cuando estan los 6 digitos se pinta: asi se puede borrar y reescribir
  // sin que la marca parpadee a un color a medias.
  function escribirHex(v: string) {
    const t = (v.startsWith('#') ? v : `#${v}`).toUpperCase().slice(0, 7);
    setHex(t);
    if (/^#[0-9A-F]{6}$/.test(t)) {
      colorManual.current = true;
      setColor(t);
      setPistaColor(`Color escrito a mano: ${t}.`);
    }
  }

  async function elegirLogo(archivo: File | undefined) {
    if (!archivo) return;
    setNombreLogo(archivo.name);
    const datos = await leerArchivo(archivo);
    setLogo(datos);
    if (colorManual.current) return;
    setPistaColor('Analizando el logo…');
    try {
      const { color: sugerido } = await api.colorSugerido(datos);
      setColor(sugerido); setHex(sugerido.toUpperCase());
      setPistaColor(`Sugerido del logo: ${sugerido}. Puedes cambiarlo.`);
    } catch (e) {
      setPistaColor(`No pude sugerirlo (${(e as Error).message}). Elígelo a mano.`);
    }
  }

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!logo) return setError('falta el logo del cliente');
    if (conBot && !modulosBot.length) return setError('el bot tiene que vender, agendar o las dos');
    // El motor descarta los numeros que no tengan forma de telefono real (10 a
    // 13 digitos, para poder distinguirlos de un LID), asi que un numero corto
    // se guardaria y no avisaria a nadie, sin error en ningun lado.
    const digitos = telefonoAvisos.replace(/[^0-9]/g, '');
    if (conBot && telefonoAvisos.trim() && (digitos.length < 10 || digitos.length > 13)) {
      return setError('el número de avisos va con indicativo y sin signos (ej. 573001234567)');
    }
    if (conBot && horaFin <= horaInicio) return setError('la hora de cierre va después de la de apertura');
    setEnviando(true);
    try {
      const r = await api.crear({
        slug, nombre, color, emailAdmin: email, quitarFondo, logo,
        marca: marca.trim(), sitio: sitio.trim(), ciudad: ciudad.trim(),
        locale: idioma, zonaHoraria: zona,
        bot: conBot ? {
          crear: true,
          asistente: asistente.trim(),
          modulos: modulosBot,
          domicilios: modulosBot.includes('tienda') && domicilios,
          telefonoAvisos: digitos,
          nombreAvisos: nombre.trim(),
          horario: { inicio: horaInicio, fin: horaFin },
        } : null,
        whatsapp: conWhatsapp ? { crear: true, importarHistorial } : null,
      });
      toast.success(`${nombre} en marcha`, { description: `Aprovisionando ${r.dominio}` });
      alCreado({ id: r.job, slug: r.slug, titulo: `Aprovisionando ${r.dominio}` });
      limpiar();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    // disablePointerDismissal: un clic afuera NO cierra. Es un formulario largo
    // y cerrarlo por accidente borra todo lo escrito. Sigue cerrando con la X,
    // con Cancelar y con Esc.
    <Dialog
      open={abierto}
      disablePointerDismissal
      onOpenChange={(a) => { if (!a) { limpiar(); alCerrar(); } }}
    >
      {/* Cabecera y pie fijos, y UNA sola zona scrolleable en el medio. Con
          overflow en el contenedor entero aparecian dos barras y el boton de
          crear quedaba abajo del todo, fuera de la vista. */}
      <DialogContent className="flex max-h-[94vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
          <DialogDescription>
            Sube el logo y elige el subdominio. El resto es automático: tarda unos 3 minutos.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={enviar} className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto pr-1">
          <div className="grid items-start gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="nombre">Nombre del cliente</Label>
              <Input
                id="nombre" required autoFocus placeholder="CompuXtreme"
                value={nombre} onChange={(e) => cambiarNombre(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="slug">Subdominio</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="slug" required placeholder="compuxtreme"
                  pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]"
                  value={slug}
                  onChange={(e) => { slugTocado.current = true; setSlug(e.target.value.toLowerCase()); }}
                />
                <span className="shrink-0 text-sm text-muted-foreground">.{dominioBase}</span>
              </div>
              <p className="min-h-4 text-xs text-muted-foreground">Minúsculas, números y guiones.</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="email">Correo del administrador</Label>
              <Input
                id="email" type="email" required placeholder="admin@cliente.com"
                value={email} onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="color">Color de marca</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="color" type="color" value={color}
                  onChange={(e) => {
                    colorManual.current = true;
                    setColor(e.target.value); setHex(e.target.value.toUpperCase());
                  }}
                  className="h-9 w-14 cursor-pointer p-1"
                />
                <div
                  className="h-9 flex-1 rounded-lg ring-1 ring-white/15 transition-colors"
                  style={{ background: color }}
                  aria-hidden
                />
                <Input
                  id="hex" aria-label="Color en hexadecimal" spellCheck={false}
                  value={hex} maxLength={7} placeholder="#0080B0"
                  onChange={(e) => escribirHex(e.target.value)}
                  onBlur={() => setHex(color.toUpperCase())}
                  className="h-9 w-24 shrink-0 text-center font-mono text-xs uppercase tabular-nums"
                />
              </div>
              <p className="min-h-4 text-xs text-muted-foreground">{pistaColor}</p>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="logo">Logo del cliente</Label>
              <label
                htmlFor="logo"
                className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-dashed px-3.5 py-3 text-sm transition-colors hover:border-marca/60 hover:bg-accent/40"
              >
                {logo
                  ? <img src={logo} alt="" className="size-8 shrink-0 object-contain" />
                  : <Upload className="size-4 shrink-0 text-muted-foreground" />}
                <span className="truncate text-muted-foreground">
                  {nombreLogo || 'PNG, JPG o WEBP — clic para elegir'}
                </span>
              </label>
              <Input
                id="logo" type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
                onChange={(e) => elegirLogo(e.target.files?.[0])}
              />
            </div>

            <div className="flex items-center gap-2.5 pt-7">
              <Checkbox
                id="fondo" checked={quitarFondo}
                onCheckedChange={(v) => setQuitarFondo(v === true)}
              />
              <Label htmlFor="fondo" className="font-normal text-muted-foreground">
                Recortar el fondo del logo (para JPG con fondo plano)
              </Label>
            </div>
          </div>

          <div className="rounded-lg border">
            <button
              type="button"
              onClick={() => setAvanzado(!avanzado)}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-sm transition-colors hover:bg-accent/40"
            >
              <span>Más opciones</span>
              <ChevronDown className={`size-4 transition-transform ${avanzado ? 'rotate-180' : ''}`} />
            </button>

            {avanzado && (
              <div className="grid items-start gap-4 border-t p-3.5 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="marca">Marca comercial</Label>
                  <Input
                    id="marca" placeholder={nombre || 'igual al nombre del cliente'}
                    value={marca} onChange={(e) => setMarca(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Lo que ve el cliente, si la razón social no es el nombre comercial.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="sitio">Sitio web del cliente</Label>
                  <Input
                    id="sitio" type="url" placeholder="https://cliente.com"
                    value={sitio} onChange={(e) => setSitio(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Va a la marca y a los enlaces de términos y privacidad.
                  </p>
                </div>

                {/* Los tres cortos en una fila: asi el bloque entero entra sin
                    scroll en una pantalla de portatil normal. */}
                <div className="grid items-start gap-4 sm:col-span-2 sm:grid-cols-3">
                <div className="grid gap-2">
                  <Label htmlFor="idioma">Idioma del dashboard</Label>
                  <select
                    id="idioma" className={SELECT}
                    value={idioma} onChange={(e) => setIdioma(e.target.value)}
                  >
                    <option value="es">Español</option>
                    <option value="en">English</option>
                    <option value="pt_BR">Português (BR)</option>
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="zona">Zona horaria</Label>
                  <select
                    id="zona" className={SELECT}
                    value={zona} onChange={(e) => setZona(e.target.value)}
                  >
                    <option value="America/Bogota">Bogotá (COT)</option>
                    <option value="America/Mexico_City">Ciudad de México</option>
                    <option value="America/Lima">Lima</option>
                    <option value="America/Santiago">Santiago</option>
                    <option value="America/Argentina/Buenos_Aires">Buenos Aires</option>
                    <option value="America/Caracas">Caracas</option>
                    <option value="America/Panama">Panamá</option>
                    <option value="America/New_York">Nueva York</option>
                    <option value="Europe/Madrid">Madrid</option>
                  </select>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="ciudad">Ciudad donde opera</Label>
                  <Input
                    id="ciudad" placeholder="Cartagena"
                    value={ciudad} onChange={(e) => setCiudad(e.target.value)}
                  />
                  <p className="min-h-4 text-xs text-muted-foreground">El bot deja de preguntarla.</p>
                </div>
                </div>

                <div className="grid gap-2.5 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2 sm:items-start">
                  <div className="grid gap-1.5">
                    <div className="flex items-center gap-2.5">
                      <Checkbox id="bot" checked={conBot} onCheckedChange={(v) => setConBot(v === true)} />
                      <Label htmlFor="bot" className="font-normal">
                        Crear también el bot del cliente
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Queda en borrador: no le escribe a nadie hasta que lo pases a
                      producción. Se configura y se prueba desde la tarjeta del cliente.
                    </p>
                  </div>
                  {conBot && (
                    <div className="grid gap-3">
                      <div className="grid gap-2">
                        <Label htmlFor="asistente">Cómo se llama el asistente</Label>
                        <Input
                          id="asistente" placeholder="Sofía"
                          value={asistente} onChange={(e) => setAsistente(e.target.value)}
                        />
                      </div>
                      <div className="grid gap-1.5">
                        <Label>Qué hace</Label>
                        <div className="grid gap-1.5">
                          {([
                            ['tienda', 'Vende', 'catálogo, fotos, pedidos y domicilios'],
                            ['citas', 'Agenda', 'servicios, horarios y cancelaciones'],
                          ] as const).map(([id, titulo, detalle]) => (
                            <label
                              key={id}
                              className={cn(
                                'flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm transition-colors',
                                modulosBot.includes(id) ? 'border-primary/50 bg-primary/8' : 'hover:border-white/18',
                              )}
                            >
                              <input
                                type="checkbox" className="mt-0.5" checked={modulosBot.includes(id)}
                                onChange={(e) => setModulosBot(e.target.checked
                                  ? [...modulosBot, id]
                                  : modulosBot.filter((m) => m !== id))}
                              />
                              <span>
                                <span className="font-medium">{titulo}</span>
                                <span className="block text-xs text-muted-foreground">{detalle}</span>
                              </span>
                            </label>
                          ))}
                        </div>

                        {modulosBot.includes('tienda') && (
                          <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm">
                            <input
                              type="checkbox" className="mt-0.5" checked={domicilios}
                              onChange={(e) => setDomicilios(e.target.checked)}
                            />
                            <span>
                              <span className="font-medium">Hace domicilios</span>
                              <span className="block text-xs text-muted-foreground">
                                Pregunta la dirección y cobra por zona. Sin esto, las zonas
                                que cargue el cliente no se usan.
                              </span>
                            </span>
                          </label>
                        )}

                        <div className="grid gap-2">
                          <Label htmlFor="avisos">A qué número avisa</Label>
                          <Input
                            id="avisos" placeholder="573001234567"
                            value={telefonoAvisos}
                            onChange={(e) => setTelefonoAvisos(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            Con indicativo. Es a quien le escribe cuando un cliente pide un
                            humano. Si se deja vacío, el aviso solo queda como nota en el chat.
                          </p>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="grid gap-2">
                            <Label htmlFor="desde">Atiende desde</Label>
                            <select
                              id="desde" className={SELECT} value={horaInicio}
                              onChange={(e) => setHoraInicio(Number(e.target.value))}
                            >
                              {HORAS.map((h) => <option key={h} value={h}>{`${h}:00`}</option>)}
                            </select>
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="hasta">Hasta</Label>
                            <select
                              id="hasta" className={SELECT} value={horaFin}
                              onChange={(e) => setHoraFin(Number(e.target.value))}
                            >
                              {HORAS.map((h) => <option key={h} value={h}>{`${h}:00`}</option>)}
                            </select>
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground">
                          Se puede cambiar después, en Operación.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid gap-2.5 rounded-lg border p-3 sm:col-span-2 sm:grid-cols-2 sm:items-start">
                  <div className="grid gap-1.5">
                    <div className="flex items-center gap-2.5">
                      <Checkbox
                        id="wa" checked={conWhatsapp}
                        onCheckedChange={(v) => setConWhatsapp(v === true)}
                      />
                      <Label htmlFor="wa" className="font-normal">
                        Dejar el WhatsApp listo para escanear
                      </Label>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Levanta el WhatsApp del cliente y deja el QR esperando en su
                      tarjeta. En cuanto lo escaneen, el bot se enlaza solo con el
                      buzón; escanear es lo único que no podemos hacer nosotros.
                    </p>
                  </div>
                  {conWhatsapp && (
                    <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm">
                      <input
                        type="checkbox" className="mt-0.5" checked={importarHistorial}
                        onChange={(e) => setImportarHistorial(e.target.checked)}
                      />
                      <span>
                        <span className="font-medium">Traer los chats de los últimos 90 días</span>
                        <span className="block text-xs text-muted-foreground">
                          Solo ocurre al escanear. Si se olvida, recuperarlos obliga a
                          desconectar el número y volver a escanear. Ojo: con un número
                          de pruebas mete esas conversaciones en el CRM del cliente.
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              </div>
            )}
          </div>

          {error && (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => { limpiar(); alCerrar(); }}>
              Cancelar
            </Button>
            <Button type="submit" disabled={enviando}>
              {enviando && <Loader2 className="animate-spin" />}
              Crear y aprovisionar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
