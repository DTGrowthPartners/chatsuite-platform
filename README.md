# Chatsuite Provisioner

Panel para dar de alta instancias de Chatwoot ("Chatsuite") con la marca de cada
cliente, en `https://dtgp.ai`.

Antes, cada cliente nuevo eran ~10 pasos manuales y una imagen Docker propia de
4 GB que tardaba media hora en construirse. Ahora es un formulario.

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
| `instalacion/` | sudoers acotado y la clave del panel |
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

**El wildcard DNS es obligatorio.** `*.dtgp.ai -> 149.56.133.201` en Namecheap.
Sin él, el paso 8 muere con `NXDOMAIN` y el cliente queda sin HTTPS. Los
registros explícitos (`dairo`, `www`) le ganan al wildcard.

**`dairo.dtgp.ai` está reservado.** Hace proxy a `:8011` (el bot) y lo maneja
otro sistema. El validador de slugs lo rechaza junto a otros 33 nombres.

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
sus imágenes y compose propios. El panel las lista como informativas pero no las
administra.
