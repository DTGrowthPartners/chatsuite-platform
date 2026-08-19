# Chatsuite Platform

Panel para dar de alta clientes completos —su Chatwoot con marca propia, su bot
de IA y su canal de WhatsApp— desde un formulario, en `https://dtgp.ai`.

Antes, cada cliente nuevo eran ~10 pasos manuales y una imagen Docker propia de
4 GB que tardaba media hora en construirse. Y el bot se armaba a mano, por
cliente. Ahora los tres se dan de alta desde el panel.

| Capa | Qué hace |
|---|---|
| **Chatsuite** | El Chatwoot del cliente con su marca, en `cliente.dtgp.ai` |
| **Bot** | Asistente de IA configurable, con simulador para afinarlo antes de entregarlo |
| **WhatsApp** | Evolution propio por cliente, con el QR en el panel |

El diseño completo y las decisiones están en
[`PLATAFORMA-BOTS.md`](PLATAFORMA-BOTS.md); el estado actual, en
[`ESTADO.md`](ESTADO.md).

> **El motor de los bots vive en `bot-engine/`**, en este mismo repo: es un solo
> código para todos los clientes y el cliente entra por datos (su `perfil.json`).
> Está junto al panel a propósito — cambian juntos, y versionarlos aparte solo
> produce desincronización. Su documentación es
> [`bot-engine/README.md`](bot-engine/README.md).

---

## Qué cambió respecto al proceso anterior

El cuello de botella era que el color de marca y los logos quedaban **compilados
dentro de la imagen**: el hex terminaba en 253 lugares del CSS de Vite, así que
cambiarlo obligaba a un `docker build` por cliente.

`chatsuite:base` rompe eso. El color sale de una variable CSS y los logos son
estáticos de `public/`, así que la identidad de un cliente entra por un
**bind-mount de un solo directorio**:

    /srv/chatsuite/<slug>/brand  ->  /app/public/brand-assets  (:ro)

Una sola imagen para todos los clientes. Sin build por alta.

---

## Piezas

| Ruta | Qué es |
|---|---|
| `base-build/` | Dockerfile de `chatsuite:base` (imagen única, marca en runtime) |
| `server/src/` | Panel: API, motor de pasos, ciclo de vida, estado |
| `server/templates/` | `.env`, `docker-compose.yaml`, sitio nginx y `bootstrap.rb` |
| `server/bin/generar-marca.py` | Logo del cliente -> los 10 assets de marca |
| `server/panel/` | Panel en React + shadcn/ui (Base UI) + Tailwind v4 + motion |
| `server/public/` | **Salida del build.** Se borra en cada `npm run panel:build` |
| `bot-engine/` | **El motor de los bots**: un código, un perfil por cliente |
| `server/src/bots.js` | Alta y configuración del bot del cliente |
| `server/src/evolution.js` | Canal de WhatsApp: Evolution por cliente y QR |
| `server/src/externos.js` | Lo que ya vive en el VPS: se lista y se reserva |
| `instalacion/` | sudoers acotado y la clave del panel (la clave NO se versiona) |
| `/srv/chatsuite/<slug>/` | Un directorio por cliente |
| `/srv/chatsuite/tenants.json` | Estado (modo 600: contiene secretos) |

## Los 8 pasos de un alta

1. **marca** — genera los assets desde el logo del cliente
2. **config** — escribe `.env`, `docker-compose.yaml` y `bootstrap.rb`
3. **basedatos** — `db:chatwoot_prepare` (el entrypoint de Chatwoot NO lo hace)
4. **arrancar** — `docker compose up -d`
5. **migrar** — espera a que Rails escuche
6. **bootstrap** — cuenta, admin, super admin, marca, cierra el onboarding
7. **nginx** — publica el sitio, valida y recarga
8. **ssl** — `certbot --nginx`

Cada paso es idempotente y se marca en el estado. **Reintentar** retoma desde el
que falló, sin rehacer los anteriores.

Si en el alta se pidió bot, se crea **después** de marcar el cliente activo: si
falla, el Chatsuite queda bueno igual y se reintenta desde su tarjeta. En el alta
se elige si **vende** (`tienda`) o **agenda** (`citas`): eso decide sus
herramientas, las pestañas del configurador y el catálogo de etiquetas que se
crea en Chatsuite —que es cerrado, así que «pedido» y «domicilio» no le sirven a
una clínica—. Se puede cambiar después, en Operación.

## Después del alta

Desde la tarjeta del cliente:

- **Bot: configurar y probar** — crea el AgentBot, publica el webhook y levanta
  el proceso. Se configura por pestañas y se prueba en el **simulador**, que
  corre el bot de verdad sin mandar nada a WhatsApp. Arranca en borrador.
- **WhatsApp: conectar el número** — levanta el Evolution del cliente, crea la
  instancia enlazada a su Chatsuite y muestra el QR. Al conectar hay que pulsar
  **Enlazar el bot al inbox**: apaga `enable_auto_assignment`, sin lo cual la
  conversación nace asignada y el bot no la ve nunca.

## Primera instalación

```bash
npm --prefix server/panel install    # el panel no versiona node_modules
npm --prefix server run panel:build  # genera server/public/

python3 -m venv bot-engine/venv      # el motor tiene su propio entorno
bot-engine/venv/bin/pip install -r bot-engine/requirements.txt
```

El venv **no se versiona** y no se puede copiar de otra máquina: lleva rutas
absolutas horneadas en `pyvenv.cfg` y en los shebang, así que moverlo lo rompe.

---

## Operación

```bash
pm2 logs chatsuite-panel          # ver qué hace el panel
pm2 restart chatsuite-panel       # tras tocar server/src/
cat /srv/chatsuite/tenants.json   # estado de todos los clientes
ls /srv/chatsuite/_logs/          # log de cada alta, borrado o respaldo
ls /srv/chatsuite/_backups/       # dumps de postgres
```

Tras tocar la interfaz hay que compilarla — `public/` es salida de build, no
fuente:

```bash
cd /home/ubuntu/chatsuite-platform/server
npm run panel        # compila el panel y reinicia el servicio
npm run panel:dev    # Vite con recarga en caliente, /api va al panel real
```

Reconstruir la imagen base (tras actualizar Chatwoot o tocar el branding):

```bash
docker build -t chatsuite:base /home/ubuntu/chatsuite-platform/base-build
```

El build **falla a propósito** si el color de marca vuelve a quedar horneado en
el CSS, en vez de publicar una imagen que ignora `brand.css`.

---

## Cosas que hay que saber

**El wildcard DNS es obligatorio** — y ya está puesto: `*.dtgp.ai ->
149.56.133.201` en Namecheap. Sin él, el paso 8 muere con `NXDOMAIN` y el
cliente queda sin HTTPS. Los registros explícitos (`dairo`, `tubodega`,
`cantinabot`, `www`) le ganan al wildcard.

**Los nombres ya tomados están reservados.** `dairo.dtgp.ai` (el bot, `:8011`),
`tubodega.dtgp.ai` (el Chatsuite de Tu Bodega) y `cantinabot.dtgp.ai` son sitios
de nginx que ya existen: un alta con ese slug los sobrescribiría y los tumbaría,
sin avisar —gana el último sitio escrito—. El validador rechaza 44 nombres.

**El techo es la RAM, no los puertos.** ~1.1 GB por cliente. El panel muestra el
cupo estimado; cuando baje de 3, toca segundo nodo.

**Borrar es destructivo.** `docker compose down -v` elimina los volúmenes. El
panel exige escribir el slug y toma un respaldo antes — salvo si el cliente
nunca llegó a estar activo, porque entonces no hay datos y exigirlo dejaría un
alta fallida imposible de limpiar.

**El panel usa Base UI, no Radix.** Este shadcn se apoya en `@base-ui/react`,
así que el equivalente de `asChild` es la prop `render`, y `Progress` es
Root › Track › Indicator (apuntar con `> div` pinta la PISTA, no el relleno).

**Las instancias viejas no se tocan.** `chatwoot_dairo`, `chatwoot_equilibrio`,
`chatwoot_ceenford`, `chatsuite_tubodegactg` y `chatsuite_compuxtreme` siguen con
sus imágenes y compose propios. El catálogo está en `server/src/externos.js`: el
panel las lista al pie —con su enlace y un punto de vida— pero no las
administra, y **de esa misma lista salen los slugs reservados**, para que no
pueda pasar que se agregue una instancia y se olvide reservar su nombre.
