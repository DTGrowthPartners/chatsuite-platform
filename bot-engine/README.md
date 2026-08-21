# chatsuite-bot — el motor

Un solo código para todos los bots de clientes. El cliente entra por **datos**,
no por código: un `perfil.json`, unos archivos en `data/` y listo.

Salió de `tubodega-bot`, que funciona pero es de un solo cliente. Acá lo
específico de Tu Bodega quedó como perfil y lo demás como motor.

Vive en `bot-engine/` dentro del repo de la plataforma, junto al panel que lo
configura: los dos cambian a la vez.

```
bot-engine/
  motor/          el motor: webhook, canal, humanizador, cerebro, API
  modulos/        qué sabe hacer el bot: comun, tienda (+ los que vengan)
  perfiles/       perfiles de ejemplo (los reales viven en /srv/chatsuite/<slug>/bot)
  ejecutar.py     arranque
```

## Arrancar el bot de un cliente

```bash
CHATSUITE_BOT_PERFIL=/srv/chatsuite/<slug>/bot PORT=3210 \
  /home/ubuntu/chatsuite-platform/bot-engine/venv/bin/python /home/ubuntu/chatsuite-platform/bot-engine/ejecutar.py
```

Un proceso por cliente (pm2 `bot-<slug>`). Son ~80 MB contra los 1.1 GB del
Chatsuite del mismo cliente, así que no mueve la aguja, y aísla: si un bot se
cae, se cae uno solo.

## El perfil del cliente

```
/srv/chatsuite/<slug>/bot/
  perfil.json           TODO lo configurable. Lo escribe el panel.
  .env                  SOLO secretos (tokens). Cambiarlo sí exige reiniciar.
  prompts/system.md     opcional, solo en modo experto
  data/
    negocio.md          la fuente de verdad del negocio
    catalogo.json       [{id, nombre, precio, imagen, ...atributos libres}]
    catalogo-fotos/     las imágenes de los productos (la tool solo existe si hay archivos)
    fotos.json          [{clave, archivo, titulo, cuando}] · fotos FIJAS del negocio
    fotos/              los archivos de fotos.json (flyer, mapa, fachada…)
    domicilios.json     [{zona, precio}]   · precio 0 = gratis, null = por confirmar
    respuestas.json     [{id, titulo, contenido, uso: datos|referencia}]
    equipo.json         [{nombre, telefono, rol, agente_id, nivel, temas, avisos}]
                        agente_id = su usuario en Chatsuite; sin el no se le puede
                        asignar una conversacion al escalar
    pedidos.json        lo escribe el bot
```

**El perfil se relee solo al cambiar el mtime.** Cambiar el catálogo, el tono,
una respuesta rápida o el horario aplica al instante, sin reiniciar. Esa es la
diferencia con el bot anterior, donde la configuración vivía en cinco sitios con
cinco comportamientos distintos.

Hay un perfil completo de ejemplo en `perfiles/ejemplo-tienda/` (una tienda de
computadores, a propósito: demuestra que el módulo `tienda` no sabe de ropa).

## Ciclo de vida

`perfil.estado` decide a quién le contesta el bot:

| Estado | Qué hace |
|---|---|
| `borrador` | no contesta. Se configura tranquilo. |
| `prueba` | contesta **solo al equipo** (`equipo.json`). Sirve para afinarlo con el número ya conectado sin que un cliente reciba nada. |
| `produccion` | contesta a clientes reales. |

Se mueve con `POST /bot/admin/estado {"estado": "prueba"}`, y **se guarda en
perfil.json**. En el bot anterior este interruptor vivía en un archivo de
runtime que el proceso pisaba, y el modo observación se perdió solo en un
reinicio sin que nadie lo notara durante semanas.

## El simulador

La pantalla más importante del panel. Corre el motor con el perfil real y las
tools de verdad, **sin mandar nada a nadie**:

```bash
curl -s -X POST :3210/bot/simular -H 'Content-Type: application/json' \
  -d '{"mensajes":[{"role":"user","content":"tienen portátiles gamer?"}]}'
```

Devuelve los mensajes que saldrían (ya partidos), qué tools se llamaron, **qué
habría hecho cada una** y si escalaría. `GET /bot/simular/prompt` muestra el
system prompt tal como lo recibe el modelo.

Sin esto no se puede dejar un bot listo antes de entregarlo: se configura a
ciegas y se descubre en producción. Además destapa problemas de datos —si a un
producto le falta el archivo de la foto, el simulador lo dice; en producción la
foto simplemente no sale y nadie se entera.

## Los dos canales

`canal.tipo` es `evolution` o `cloud_api`. Es lo único que hay que cambiar.

|  | Evolution | Cloud API |
|---|---|---|
| "escribiendo…" | sí | no existe |
| acuses de entrega | los vemos, y frenan envíos | los recibe Chatwoot |
| reconexión / QR | hay sesión que se cae | no hay sesión |
| ventana de 24 h | no aplica | aplica, con plantillas |
| grupos | sí | no, y no hay parche |

Funciona así porque **el bot nunca le habla al canal**: le habla a Chatsuite y
Chatsuite despacha por el inbox. Las dos únicas excepciones son las plantillas y
los avisos al equipo, que van a Graph.

⚠️ **El freno por acuses.** Si el canal es `evolution` pero nadie nos reenvía
los acuses (`POST /bot/canal/acuse`), el freno se dispararía a los 8 minutos y
dejaría el bot mudo sin que nada pareciera roto. Acá eso no puede pasar: sin
haber visto **ningún** acuse en toda la vida del proceso, no congela — avisa en
el log y sigue.

## Módulos

Un módulo agrupa tres cosas que siempre van juntas: sus tools, sus handlers y el
bloque de prompt que las explica. Un cliente de citas no ve una palabra sobre
domicilios y el modelo no puede llamar una tool que no existe para ese negocio.

| Módulo | Tools | Para |
|---|---|---|
| `comun` (siempre) | escalar_a_humano, avisar_al_equipo | todos |
| `tienda` | registrar_pedido, enviar_fotos_catalogo, enviar_catalogo_pdf | cualquiera que venda |

`tienda` es genérico: los atributos de cada producto salen del propio catálogo,
así que sirve para computadores (procesador, RAM, garantía) igual que para ropa
(tallas, colores). Lo que cambia entre clientes son los datos.

Para agregar uno nuevo (`citas`, `socios`, `tareas`): heredar de
`modulos.base.Modulo`, implementar `tools()`, `bloques_prompt()`, `etiquetas()`
y `ejecutar()`, y registrarlo en `modulos/__init__.py`.

**Todo handler debe respetar `ctx.simulacion`**: en simulación no ejecuta nada
real, llama a `ctx.registrar("lo que haría")`. Si no, el simulador manda cosas
de verdad.

## API

| Ruta | Para |
|---|---|
| `POST /bot/webhook` | el AgentBot de Chatsuite |
| `POST /bot/canal/acuse` | acuses de Evolution (alimenta el freno) |
| `POST /bot/simular` · `GET /bot/simular/prompt` | el simulador |
| `GET/POST /bot/admin/estado` | ciclo de vida y diagnóstico |
| `GET/PUT /bot/admin/perfil` | lo que edita el panel |
| `POST /bot/admin/pausa` | pausar/reactivar un chat |
| `GET /bot/admin/frias` · `POST /bot/admin/reenganchar` | conversaciones frías |
| `POST /bot/admin/barrer` | responder en goteo lo que quedó esperando |
| `GET /bot/catalogo.pdf` | el catálogo vigente en URL pública |

`/bot/admin/*` no se expone por nginx: se llama por `127.0.0.1`.

## Al montar un cliente, lo que no avisa al fallar

Todo esto costó horas de encontrar en Tu Bodega y ninguna falla hace ruido:

1. **`enable_auto_assignment = false` en el inbox.** Con la asignación
   automática encendida la conversación nace `open` y asignada, y el bot NUNCA
   la ve (solo atiende `pending`).
2. **Hacen falta DOS tokens.** El del Agent Bot manda mensajes; el de un usuario
   agente (`CHATWOOT_READ_TOKEN`) hace falta para leer el historial **y para
   escribir etiquetas**. Con el del bot los dos dan 401 en silencio: el bot
   responde igual y solo faltan las etiquetas.
3. **Las etiquetas del perfil tienen que existir en Chatsuite**, junto con sus
   vistas guardadas. El motor filtra contra el catálogo del perfil, pero
   Chatwoot crea al vuelo cualquier etiqueta que reciba.
4. **Con Cloud API el contacto no trae teléfono** (webhook v26): la identidad
   sale de `contact_inbox.source_id`. Exigir teléfono descarta el 100% del
   tráfico sin un solo error en el log.
5. **Crear el DNS ANTES de levantar Evolution**, o el contenedor cachea el
   NXDOMAIN en el proceso y no espeja nada a Chatsuite. Un `wget` desde adentro
   da falso OK; se arregla con `docker compose restart api`.
6. **Los parámetros de plantilla no admiten saltos de línea ni tabs** — Meta
   responde `132000` y no manda nada.
