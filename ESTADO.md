# Estado del proyecto — Chatsuite Provisioner

**Última actualización:** 2026-08-19
**Objetivo:** dar de alta Chatwoots de clientes (`cliente.dtgp.ai`) con su marca,
desde un panel, sin instalación manual.

---

## Resumen en una línea

Panel funcionando en `https://dtgp.ai`. Alta de cliente probada de punta a punta,
y el wildcard DNS ya está puesto. **No queda nada bloqueando el primer cliente
real.**

---

## Estado por hito

| | Hito | Estado |
|---|---|---|
| M0 | Imagen `chatsuite:base` con marca en runtime | ✅ Hecho y verificado |
| M1 | `default_server` catch-all en nginx | ✅ Hecho |
| M2 | Motor de provisioning (8 pasos, idempotente) | ✅ Hecho y probado |
| M3 | Panel web en `dtgp.ai` | ✅ En producción |
| M4 | Login propio + UI con shadcn/ui | ✅ Hecho (2026-08-18) |
| — | Wildcard `*.dtgp.ai` en Namecheap | ✅ Hecho (verificado 2026-08-19) |
| — | Lo que ya vive aquí: listado y reservado | ✅ Hecho (2026-08-19) |
| — | sudoers acotado | ⬜ Opcional, ver abajo |
| F2 | Conexión WhatsApp automática (whapi / Evolution) | ⬜ Fuera del alcance actual |

---

## Lo que hay que hacer ahora

### CompuXtreme, primer cliente de la plataforma

Va en `compuxtreme.dtgp.ai`, dado de alta **desde el panel**, y reemplaza al
Chatsuite que hoy vive en `compuxtreme.dtgrowthpartners.com`. El viejo se queda
corriendo hasta que el nuevo esté andando.

**Los Chatsuites nuevos ya mandan correo.** Salen como `noreply@dtgp.ai` por el
servidor del propio VPS, firmados con el DKIM de dtgp.ai. Las credenciales viven
en `instalacion/panel.env` (modo 600, fuera del repo) y las carga `config.js` al
arrancar — no con `--env-file`, para que dé igual cómo se lance el proceso.

Falta **publicar tres registros en Namecheap** para que el correo no caiga en
spam: el TXT del DKIM (`mail._domainkey`), añadir `ip4:149.56.133.201` al SPF
que ya existe —editándolo, dos SPF se invalidan entre sí— y un DMARC en
`_dmarc` con `p=none`. Los MX no se tocan: son del reenvío de Namecheap y el VPS
solo envía. Sin esos registros el correo sale igual, pero sin verificar.

### Antes: primer cliente real

El wildcard `*.dtgp.ai -> 149.56.133.201` ya está en Namecheap: un nombre
cualquiera resuelve, así que el paso 8 (SSL) ya no muere con `NXDOMAIN`. Los
registros explícitos le ganan al wildcard, así que `dairo`, `tubodega`,
`cantinabot` y `www` no corren ningún riesgo.

Con el wildcard puesto: entrar al panel → **+ Nuevo cliente** → nombre,
subdominio, correo del admin, logo. El color se sugiere solo desde el logo.
Tarda ~3 minutos y se ve el avance en vivo.

---

## Cómo entrar

| | |
|---|---|
| Panel | `https://dtgp.ai` |
| Usuario | `dtgp` |
| Clave | `/home/ubuntu/chatsuite-platform/instalacion/clave-panel.txt` (modo 600) |

Ya no es el popup de `auth_basic`: hay pantalla de acceso propia, sesión por
cookie firmada (12 h), clave con scrypt, freno tras 8 intentos y botón de salir.

**La UI ahora se compila.** Tras tocar `server/panel/`, corre `npm run panel`
desde `server/` — `public/` es salida de build y se borra en cada compilación.

Las credenciales de cada cliente (usuario y clave del admin de su Chatsuite)
salen en el botón **Detalle** de su tarjeta.

---

## Qué se probó de verdad

Se dio de alta un cliente ficticio con color naranja `#E2571E` — elegido a
propósito para que cualquier resto del azul de DTGP saltara a la vista.

Verificado sobre la instancia corriendo:

- `brand.css` sirve el color del cliente
- Los 4 favicons, los 3 logos SVG, el lockup del sidebar y la marca de agua
  salen del directorio del tenant
- `theme-color` y `TileColor` con el color del cliente
- El **md5 del logo servido coincide con el generado para ese tenant**, lo que
  prueba que se sirve el bind-mount y no los assets de la imagen
- El build de la imagen falla a propósito si el color vuelve a quedar horneado

Después se borró desde el propio panel: cero contenedores, volúmenes o sitios de
nginx huérfanos, y el respaldo previo quedó guardado.

---

## Bugs encontrados durante la construcción

Los tres primeros habrían roto **cualquier** alta. Reaparecerán al actualizar
Chatwoot, así que conviene tenerlos a mano.

1. **El entrypoint de Chatwoot no crea el esquema.** Faltaba
   `db:chatwoot_prepare`. Sin él, rails y sidekiq entran en bucle con
   `PG::UndefinedTable: relation "installation_configs" does not exist` — y
   `docker compose up -d` devuelve 0 igual, así que falla en silencio.
2. **La llave de Redis del onboarding.** Hay que borrar
   `CHATWOOT_INSTALLATION_ONBOARDING` o **toda** ruta del dashboard responde 302
   a `/installation/onboarding`, aunque la cuenta y la marca ya estén listas.
3. **Contraseñas.** Chatwoot exige mayúscula, minúscula, dígito y carácter
   especial; `base64url` solo a veces produce uno, así que fallaba de forma
   intermitente.
4. **Health check y `FORCE_SSL`.** Rails responde 301, no 200, y `fetch` seguía
   la redirección hacia un dominio que aún no resuelve.
5. **`src` absoluto en `.vue`.** Vue lo convierte en import y Rollup muere; hay
   que usar binding dinámico `:src="'/ruta'"`.
6. **`BRAND_COLOR` no está en `GLOBAL_CONFIG_KEYS`**, así que en el layout hay
   que leerlo con `GlobalConfig.get_value`, no con `@global_config`.

---

## Hallazgo colateral en nginx

Al añadir el `default_server` se destapó que `agente.dtgrowthpartners.com`,
`app.midominio.com` y el HTTPS por IP los atendía **el bloque de `acbfit.com`,
con el certificado de acbfit.com**: cualquier navegador veía un error de
certificado y, detrás, el sitio de otro cliente. Ahora responden 444.

Ningún código llama a esas URLs por HTTPS (se verificó), así que no se rompió
nada. Si quieres que `agente` tenga HTTPS propio es un `certbot` de un minuto.

---

## Pendientes menores

- **sudoers acotado.** El archivo está en
  `instalacion/chatsuite-provisioner.sudoers`, sin instalar. Hoy `ubuntu` ya
  tiene `NOPASSWD` para todo, así que instalarlo no restringe nada mientras esa
  regla amplia siga puesta — solo documenta lo que el panel necesita de verdad.
  Quitar el `NOPASSWD:ALL` es una decisión aparte porque otras cosas dependen de él.
- **Imágenes viejas recuperables.** `chatwoot-rails:development`,
  `chatwoot-vite:development` y `chatwoot:development` suman ~10.5 GB y ningún
  contenedor las usa. Más el stack `chatwoot_dtgp`, caído hace 5 semanas.
- **Fase 2:** crear la instancia en whapi o Evolution, el inbox por API y
  mostrar el QR en el panel. El motor ya tiene el hueco donde engancharlo.

---

## Límite de capacidad

~1.4 GB de RAM por cliente completo (Chatsuite 1,1 + Evolution 190 MB + bot
80 MB). Con lo disponible hoy caben **~7 clientes más** antes de necesitar un
segundo nodo. El panel muestra el cupo estimado en la
cabecera; cuando baje de 3, hay que planear.

El techo no son los puertos: el rango 3210–3299 da 90 espacios.

---

## Operación diaria

```bash
pm2 logs chatsuite-panel          # qué está haciendo el panel
pm2 restart chatsuite-panel       # tras tocar server/src/
cat /srv/chatsuite/tenants.json   # estado de todos los clientes
ls /srv/chatsuite/_logs/          # log de cada alta, borrado o respaldo
ls /srv/chatsuite/_backups/       # dumps de postgres
```

Reconstruir la imagen base (tras actualizar Chatwoot o tocar el branding):

```bash
docker build -t chatsuite:base /home/ubuntu/chatsuite-platform/base-build
```

---

## Lo que NO se toca

Todo esto vive en `server/src/externos.js` y sale al pie del panel, en **También
viven aquí**: nombre, enlace de entrada y un punto que dice si responde. Es solo
lectura —el panel no las administra— y de esa misma lista salen los slugs
reservados, así que agregar una instancia la reserva sola.

| Qué | Dónde se entra | Puerto |
|---|---|---|
| Agente Dairo (bot de DTGP) | `dairo.dtgp.ai/admin/` | 8011 |
| Cantina (bot) | `cantinabot.dtgp.ai/admin/` | 8012 |
| Tu Bodega (Chatsuite) | `tubodega.dtgp.ai` | 3036 |
| CompuXtreme (Chatsuite) — **se reemplaza** | `compuxtreme.dtgrowthpartners.com` | 3037 |
| Ceenford (Chatwoot) | `ceenfordsuite.dtgrowthpartners.com` | 3035 |
| Equilibrio Clinic (Chatwoot) | `equilibriocs.dtgrowthpartners.com` | 3034 |
| Chatsuite DTGP (Chatwoot interno) | `chatsuitetdairo.dtgrowthpartners.com` | 3033 |

**Los bots se abren por `/admin`; los Chatwoots, por la raíz.**

Un alta con uno de esos slugs sobrescribiría su sitio de nginx y lo tumbaría sin
avisar —gana el último sitio escrito—, así que están reservados, más `acbfit`,
`cantina`, `nanoplush` y `tubodegactg`, que son marcas ya en uso. Son 43 nombres.

**`compuxtreme` es la excepción**: lo reemplaza un tenant de la plataforma
(`compuxtreme.dtgp.ai`), así que lleva `migrando: true` en `externos.js` y su
nombre queda libre para poder darlo de alta. Los dos conviven —viven en dominios
distintos, el alta no toca el viejo— hasta que el nuevo esté andando.

Migrar las viejas a `chatsuite:base` es posible pero es otro proyecto, y no
urge.
