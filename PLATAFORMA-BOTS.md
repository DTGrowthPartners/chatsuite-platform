# Plataforma de bots — diseño

**Fecha:** 2026-08-18
**Objetivo:** que dar de alta el bot de un cliente sea *configurar*, no *programar*.
Todo desde el panel, y dejarlo probado antes de entregárselo al cliente.

---

## El principio

**Un motor, muchos perfiles.** El código es uno solo y se actualiza una vez para
todos. El cliente entra por datos.

Esto ya es casi cierto: de las 2.779 líneas de `tubodega-bot`, lo específico de
Tu Bodega son 6 archivos de datos, un prompt y un `.env`. El resto —webhook,
filtros, coalescing, pausas, ventana de 24 h, humanizador, etiquetas,
reenganche, alertas, transcripción de audio— sirve igual para un gimnasio.

---

## Inventario: todo lo que hoy se configura en Tu Bodega

Esto es la lista de pantallas del panel. Sale de leer el código, no de imaginar.

| # | Qué | Hoy vive en | Volumen real |
|---|---|---|---|
| A | Conexión (Chatsuite, tokens, puerto, modelo) | `.env`, 23 llaves | el panel ya conoce 8 de ellas: él creó el tenant |
| B | Persona y comportamiento | `prompts/system.md`, 8 secciones | 7 KB |
| C | Conocimiento del negocio | `data/negocio.md` | 3,6 KB · fuente de verdad · sin reiniciar |
| D | Catálogo | `data/catalogo.json` | 32 productos: id, nombre, precio, imagen, tallas, colores |
| E | Domicilios | `data/domicilios.json` | 230 barrios: precio, lat, lng |
| F | Respuestas rápidas | `data/respuestas.json` | 14: id, título, contenido |
| G | Equipo / filtro de clientes | `data/equipo.json` | 8 entradas (4 reales + 4 LID) |
| H | Etiquetas y vistas | whitelist en código + `CustomFilter` en Chatwoot | 5 y 5 |
| I | Operación | endpoints `/bot/admin/*` + `estado-bot.json` | global, pausas, convalecencia |
| J | Horario y ritmo | `.env` | 8–21, tope 80/h, respuesta 15–40 s |
| K | Alertas | `.env` + `equipo.json` | a quién, por qué tipo, por qué vía |
| L | Plantillas de Meta | `.env` | escalamiento y reenganche |

---

## El problema de fondo: la config está desperdigada

Hoy vive en cinco sitios con cinco comportamientos distintos:

| Dónde | ¿Recarga sin reiniciar? |
|---|---|
| `.env` | ❌ hay que reiniciar pm2 |
| `data/*.json` | ✅ se lee en cada turno |
| `prompts/*.md` | ✅ |
| `estado-bot.json` | ✅ pero lo pisa el proceso |
| Chatwoot (etiquetas, vistas) | otro sistema, otra API |

**Propuesta:** un solo `perfil.json` por cliente, que el panel escribe y el motor
relee al cambiar el mtime. El `.env` queda **solo para secretos** (tokens).
Ninguna decisión de negocio debería exigir un reinicio.

```
/srv/chatsuite/<slug>/bot/
  perfil.json        ← todo lo configurable. Lo escribe el panel.
  .env               ← solo secretos
  prompts/system.md  ← generado desde perfil.json (editable en modo experto)
  data/              ← catálogo, fotos, PDF, adjuntos
```

---

## Módulos

Cada módulo exporta **tres cosas juntas**: sus tools, sus handlers, y el bloque
de prompt que inyecta. Así el prompt deja de tener texto horneado y el modelo
nunca ve tools que no aplican.

| Módulo | Tools | Pantallas que enciende | Cliente ejemplo |
|---|---|---|---|
| `comun` (siempre) | escalar_a_humano, avisar_al_equipo | equipo, alertas | todos |
| `ventas` | registrar_pedido, enviar_fotos, enviar_pdf | catálogo, domicilios, pedidos | Tu Bodega, Tennis Cartagena |
| `citas` | disponibilidad, agendar, cancelar, recordar | agenda, servicios, profesionales | clínicas |
| `socios` | consultar_membresia, registrar_visita, avisar_vencimiento | padrón, planes, vencimientos | ACBfit |
| `tareas` | crear_tarea, consultar_estado, asignar | tablero, responsables | Nanoplush |

`ventas` ya existe y es casi copiar. Los otros tres hay que escribirlos.

---

## Audiencia: no todos los bots atienden clientes

Detalle que cambia el diseño. Hoy `equipo.json` significa *"a esta gente el bot
NO la atiende"*. Para un bot administrativo interno la regla es la **inversa**:
solo atiende al equipo.

Va como `audiencia: clientes | equipo | ambos` en el perfil:

- **Tu Bodega, Tennis Cartagena** → `clientes` (el equipo queda filtrado)
- **Nanoplush administrativo** → `equipo` (solo responde a los de adentro)
- **ACBfit** → probablemente `ambos`: el socio consulta su membresía y el
  entrenador consulta el padrón. Con permisos distintos por audiencia.

---

## Ciclo de vida: borrador → prueba → producción

Esto sale directo de *"dejarlo listo antes de entregárselo al cliente"*, y es
lo que separa un panel de configuración de un producto.

1. **Borrador** — se configura todo. El bot ni siquiera corre.
2. **Prueba** — corre contra un **simulador**: un chat dentro del panel que
   ejecuta el motor con el perfil real, con las tools de verdad, pero **sin
   tocar WhatsApp**. Aquí se afina el prompt, se ve qué etiqueta pone y qué
   tools llama. Es la pantalla más importante de todas.
3. **Producción** — se enciende el canal. Ahí escribe a gente real.

⚠️ **El interruptor tiene que ser explícito y persistente.** En Tu Bodega el
"modo observación" se perdió solo en algún reinicio, porque el default de
`estado.py` es `global: True` y nadie lo notó durante semanas. El estado de
producción debe vivir en `perfil.json`, no en un archivo que el proceso pisa.

---

## El canal

`canal: evolution | cloud_api | whapi` en el perfil. Controla solo dos cosas: si
aplica la ventana de 24 h con plantillas, y si hay acuses/presencia.

**Decisión tomada: arrancar con Evolution y migrar a Cloud API después.** El
motor debe traer el flag desde el día uno, para que esa migración sea un cambio
de configuración y no un proyecto — a Tu Bodega le costó cuatro cambios de
código.

⚠️ **El freno por acuses es la trampa peligrosa.** Exige `_ultimo_estado ==
"open"` y acuses recientes. Con el flag mal puesto (Evolution activo pero sin
acuses llegando), a los ~8 minutos **congela todos los salientes** y apaga el
bot sin que nada parezca roto. El motor tiene que tratar eso como estado del
canal, no como constante.

Nota de riesgo, ya conversada: Evolution le costó a Tu Bodega dos baneos en
tres días. La decisión de arrancar por ahí está tomada; queda registrada para
que la migración a Cloud API no se posponga indefinidamente.

---

## Las pantallas del panel

Por orden de importancia real, no de vistosidad:

1. **Simulador / chat de prueba** — sin esto no se puede "dejar listo" nada.
2. **Persona** — campos estructurados (nombre, tono, reglas, qué nunca hace,
   cuándo escala) que *componen* el system.md. Con "modo experto" para editar
   el prompt crudo. Un textarea de 7 KB no es configurar.
3. **Conocimiento del negocio** — editor de texto libre. Es la fuente de verdad.
4. **Catálogo** — tabla con fotos, carga masiva por CSV. 32 productos a mano
   está bien; 500 no.
5. **Respuestas rápidas** — con el campo `uso: datos | referencia`, que hoy está
   explicado en prosa dentro del prompt y debería ser un campo.
6. **Etiquetas y vistas** — **crear las dos a la vez**. Hoy son dos sistemas
   separados (whitelist en el bot, `CustomFilter` en Chatwoot) y por eso ya
   tenemos etiquetas huérfanas en Laura/Sandra.
7. **Equipo y filtros** — con el filtro de LID resuelto de fábrica: en
   `equipo.json` cada persona figura dos veces y un LID no es un número.
8. **Operación** — interruptor, pausas, horario, tope por hora, reenganche.
9. **Alertas** — a quién, por qué tipo, por qué vía.

---

## Orden de construcción

| Fase | Qué | Estado |
|---|---|---|
| 1 | Motor con módulos + `perfil.json` + simulador | ✅ **Hecho 2026-08-18** — `bot-engine/` (en este repo), probado punta a punta |
| 2 | Pantallas del panel sobre el motor | ✅ **Hecho 2026-08-18** — simulador, persona, negocio, catálogo, respuestas, domicilios, equipo y operación |
| 3 | Estrenarlo con un cliente de `tienda` | ⬜ Tu Bodega no se toca: está vivo |
| 4 | Alta de Evolution + QR desde el panel | ✅ **Hecho 2026-08-18** — un Evolution por cliente, QR en el panel, enlace del bot al inbox |
| 5 | Migrar Tu Bodega al motor | ⬜ un solo código |
| 6 | Módulos `citas`, `socios`, `tareas` | ⬜ según qué cliente entre primero |

El motor ya soporta los dos canales (`canal.tipo`), el ciclo de vida
borrador→prueba→producción y el simulador. Ver `bot-engine/README.md`.

## Cómo se le da bot a un cliente (desde el panel)

En la tarjeta del cliente → **Bot: configurar y probar**. Solo aparece con el
Chatsuite en `activo`, porque el alta del bot necesita su API.

«Crear el bot» hace, en un solo job: crea el **AgentBot** en Chatsuite y saca
los **dos tokens** (el del bot para escribir y el de un usuario agente para leer
el historial y las etiquetas — con uno solo las etiquetas fallan en silencio),
escribe `.env` y `perfil.json`, publica `/bot/` en nginx con `/bot/admin/`
cerrado, levanta el proceso pm2 `bot-<slug>` y crea las etiquetas con sus vistas.

Queda en **borrador**: no le escribe a nadie. Lo que sigue es configurarlo por
las pestañas, probarlo en el simulador, pasarlo a **prueba** (contesta solo al
equipo, con el número ya conectado) y recién ahí a **producción**.

El webhook queda apuntando a `https://<dominio>/bot/webhook`, pero no llega
nada hasta que exista el inbox de WhatsApp y el AgentBot esté asignado a él —
eso es la fase 4. Mientras tanto el simulador funciona igual, que es justo la
idea: **se configura y se afina sin canal**.

---

## Trampas heredadas que el motor debe traer resueltas

Todas costaron horas de encontrar en Tu Bodega y ninguna avisa al fallar:

- **Etiquetas:** `POST /labels` **reemplaza** la lista entera, no agrega. Hay que
  leer y mandar la unión.
- **Etiquetas:** el token del Agent Bot da **401** al escribirlas; hace falta el
  del usuario agente. Falla en silencio.
- **Etiquetas:** Chatwoot **crea al vuelo** cualquier etiqueta que reciba. Sin
  catálogo cerrado, un modelo creativo llena la cuenta de inventadas.
- **AgentBot:** con `enable_auto_assignment = true` la conversación nace `open` y
  el bot **nunca la ve** (solo atiende `pending`).
- **Webhook v26:** ningún contacto trae teléfono. Hay que caer a
  `contact_inbox.source_id` → `identifier`.
- **Plantillas de Meta:** los parámetros **no admiten saltos de línea ni tabs** —
  responde `132000` y no manda nada.
- **Ventana de 24 h:** usar 23 h, no 24. El reloj que cuenta es el de Meta.
- **Proactivo:** decidir **antes** de enviar. El rechazo llega por webhook
  minutos después, cuando ya no hay nada que salvar.


---

## Fase 4: el canal de WhatsApp (2026-08-18)

En la tarjeta del cliente → **WhatsApp: conectar el número**. Levanta su
Evolution, crea la instancia enlazada a su Chatsuite y muestra el QR, que se
renueva solo cada 20 segundos mientras la ventana está abierta.

### Un Evolution por cliente, no uno compartido

Cuesta ~190 MB (api 137 + postgres 47 + redis 5), y baja el cupo de ~10 a ~8
clientes por nodo. Se eligió igual por dos razones:

1. **`CHATWOOT_IMPORT_DATABASE_CONNECTION_URI` es global por Evolution**, no por
   instancia. Uno compartido solo podría importar el historial de un cliente.
2. **Aislamiento.** Una sanción o una caída en el número de un cliente no toca a
   los demás. Es la misma decisión que ya se había tomado para CompuXtreme.

### El paso que nadie recuerda

Conectar el número **no alcanza**. Falta enlazar el inbox con el AgentBot y
apagar `enable_auto_assignment`. Con la asignación automática encendida la
conversación nace `open` y asignada, y el bot —que solo atiende `pending`— no la
ve nunca: todo parece bien y simplemente no contesta.

Por eso el botón **Enlazar el bot al inbox** aparece apenas el número queda
conectado, y hace las dos cosas juntas. También le escribe al bot su canal en el
perfil y la apikey de Evolution en su `.env` (eso sí reinicia el proceso: el
`.env` solo se lee al arrancar).

### Orden que importa

- El dominio tiene que responder por **HTTPS** antes de crear la instancia: el
  enlace apunta a la URL pública y si no responde queda a medias.
- Si el contenedor de Evolution arrancó antes de que existiera el DNS, se queda
  con el **NXDOMAIN cacheado en el proceso** y no espeja nada, sin error legible.
  El provisioner lo comprueba con `getent` dentro del contenedor y reinicia la
  API si hace falta. Ojo: un `wget` desde adentro da falso OK.
- El **historial de 90 días solo se importa al conectar**. Por defecto va
  apagado (un cliente nuevo no tiene nada que importar); para un número con
  historia hay que activarlo antes de escanear, o desconectar y reescanear.

## Más opciones en el alta (2026-08-18)

El modal de Nuevo cliente tiene ahora un bloque **Más opciones**, plegado para
que el alta normal siga siendo cuatro campos y un logo:

| Opción | Qué cambia de verdad |
|---|---|
| Marca comercial | `INSTALLATION_NAME` y `BRAND_NAME`, y el lockup del logo. Para cuando la razón social no es lo que el cliente muestra |
| Sitio web | `BRAND_URL` y los enlaces de términos y privacidad, que si no apuntan al propio dashboard |
| Idioma | `locale` de la cuenta: es, en, pt_BR |
| Zona horaria | la usa el bot para su horario de atención |
| Ciudad | el bot deja de preguntar la ciudad si ya la sabe |
| Crear el bot | encadena el alta del bot al terminar los 8 pasos, en borrador |

El bot se crea **después** de marcar el Chatsuite activo, no como un paso más:
si falla, el Chatsuite del cliente queda bueno igual y se reintenta desde la
tarjeta sin repetir los 8 pasos.


---

## Qué medimos (2026-08-18)

Todo es **interno**: el cliente solo recibe su plataforma con su marca y su
WhatsApp, para mirar cómo contesta el bot e intervenir de vez en cuando. Lo
financiero vive en DTOS, no acá.

### Dos archivos por cliente

- `data/eventos.jsonl` — una línea por hecho, de solo agregar, ~90 días. Es el
  detalle; permite responder preguntas que hoy no se nos ocurrieron.
- `data/stats.json` — el acumulado por día. Es lo que lee el panel.

**No se guarda el contenido de los mensajes**: ya vive en Chatsuite, y
duplicarlo sería un problema de privacidad sin ganancia. La excepción es
`sin_dato`, donde la pregunta *es* el dato.

### Lo que se registra

| Evento | Para qué |
|---|---|
| `atendido` | tokens, latencia y turnos de cada mensaje respondido |
| `escalada` | con el motivo que escribió el propio modelo |
| `pedido` | total y zona |
| `tool` | qué herramienta y cuántas veces |
| `sin_dato` | **la pregunta que no supo responder** |
| `foto_faltante` | producto cuya foto no existe en disco |
| `no_respondio` | por horario, pausa o freno del canal |
| `fallo` | errores, con el tipo de excepción |
| `humano_entro` | el bot se apartó porque contestó una persona |

### Las cifras que salen de ahí

**Contención** —qué parte cerró el bot sin que entrara un humano— es la que
importa: es la que se traduce en asesores ahorrados. Al lado: pedidos por cada
100 mensajes, latencia del modelo y **tokens por mensaje**.

⚠️ **El costo real incluye el caché.** El system prompt va con `cache_control`,
así que los tokens cacheados NO aparecen en `input_tokens`: se reportan aparte.
Medido en Tu Bodega, un turno reporta 333 tokens de entrada y en realidad mueve
**~15.100 por llamada al modelo** — y un turno con tool son dos llamadas. Contar
solo `input_tokens` daría una métrica de costo que miente por un factor de 40.

De esos ~15.100, el prompt de Tu Bodega pesa ~14.600: **el 19% es la tabla de
230 barrios** y otro 18% el catálogo. Si algún día el costo importa, ahí está
lo que hay que optimizar.

### Lo que no es una métrica pero es lo más útil

La lista de **preguntas que el bot no supo responder**, agrupada por repetición.
Si el mismo barrio aparece 40 veces, no es un incidente: es una fila que falta
en la tabla de domicilios. Convierte «no me gusta cómo contesta» en una lista
concreta de qué arreglar, y es el circuito que hace que el bot mejore solo.

## Suspender el servicio

En la tarjeta del cliente → **Suspender el servicio**. Es distinto de *Detener*:
detener apaga los contenedores y el dominio queda devolviendo **502 Bad
Gateway**, que se lee como avería y no como decisión.

Suspender apaga el bot, el WhatsApp y el Chatsuite, y publica una página que lo
explica, con el color del cliente.

- **No borra nada.** Base, volúmenes y respaldos quedan intactos.
- **No cierra la sesión de WhatsApp**, solo apaga el contenedor: la sesión vive
  en el volumen, así que al reanudar reconecta **sin pedir QR otra vez**.
- **El bot vuelve al estado que tenía**, no a producción por defecto.
- La página va en `/var/www/chatsuite-suspendido/`, **no** en `/srv/chatsuite/`:
  ese directorio es 750 de `ubuntu` y nginx corre como `www-data`.
- El bloque de nginx es una **location regex**, porque el sitio ya tiene un
  `location /` y nginx rechaza duplicados; una regex gana sobre el prefijo sin
  chocar. Se exceptúa `/.well-known/` para que certbot pueda renovar el
  certificado mientras el servicio está suspendido.


---

## Cómo se ven los módulos dentro de Chatsuite (2026-08-18)

**Chatsuite es la ventana, no la base de datos.** La verdad de cada módulo vive
donde le corresponde —el catálogo en el perfil, la agenda en su proveedor, las
tareas en DTOS— y Chatsuite muestra lo que el agente necesita ver sin salirse de
la conversación. Es lo que hace que se cumpla la regla de «nada de panel aparte».

### Las cuatro piezas nativas

| Pieza | Para qué | Filtrable |
|---|---|---|
| Etiquetas + vistas guardadas | las bandejas de la barra lateral | sí |
| Atributos de conversación | los datos del caso, barra lateral derecha | **sí** |
| Atributos de contacto | lo que es de la persona: su plan, su vencimiento | sí |
| Dashboard App | una pestaña embebida dentro de la conversación | — |

### Cómo cae cada módulo

| Módulo | Bandeja | En la conversación | En el contacto | La verdad vive en |
|---|---|---|---|---|
| `tienda` | 📦 Pedidos | pedido, detalle, total, zona, estado | — | `pedidos.json` del perfil |
| `citas` | 📅 Citas | fecha, servicio, profesional, estado | — | agenda propia o Cal.com |
| `socios` | 🏋️ Socios | — | plan, vence, estado | padrón del perfil o su sistema |
| `tareas` | ✅ Tareas | tarea, responsable, estado | — | DTOS |

Ningún módulo necesita una pantalla nueva.

### Cómo se declara

Cada módulo declara sus atributos en `atributos(p)` y los llena devolviéndolos
en el `Resultado`; el motor los escribe. El panel los crea en Chatsuite
preguntándole al propio bot por `GET /bot/admin/esquema`, así que **agregar un
módulo no obliga a tocar el panel**.

- **Sin la definición, el atributo no existe para el usuario**: Chatwoot guarda
  el valor pero no lo muestra en la barra lateral ni deja filtrar por él. Se ve
  como si el bot no hubiera escrito nada.
- ⚠️ **El bucle**: `custom_attributes` está en el `list_of_keys` de
  `Conversation`, así que escribir re-dispara `conversation_updated` → las
  automatizaciones del cliente → posiblemente el bot otra vez. El corte es leer
  primero y escribir **solo si algún valor cambió de verdad**. Es el mismo guard
  que hubo que poner en el puente CAPI de CompuXtreme, donde comparar un campo
  contra la hora actual hacía que nunca cortara.
- Los tipos son un enum de Rails: `text:0, number:1, currency:2, percent:3,
  link:4, date:5, list:6, checkbox:7`. Verificado contra el Chatsuite real.

## Módulo `citas`: agenda propia o externa

`citas.agenda` = `propia | calcom | agendapro`. El módulo es el mismo; cambia de
dónde lee la disponibilidad.

**Agenda propia** (por defecto): mismo patrón que el catálogo y el padrón. En el
perfil van horario de atención, duración del turno, servicios, profesionales y
excepciones; las citas se guardan en `citas.json`. Sirve para un cliente que hoy
no tiene nada, y es más simple que integrar un tercero.

**El costo escondido está en quién más toca la agenda.** Si el equipo también
agenda por teléfono o en mostrador, necesitan ver y mover citas fuera de
WhatsApp, y eso es una vista de calendario en el panel — trabajo real. Si todo
entra por WhatsApp, con el perfil basta.

**Los recordatorios son tráfico proactivo.** «Le recuerdo la cita 24 h antes»
cae fuera de la ventana de 24 h de Cloud API y exige plantilla aprobada. Con
Evolution no hay problema. Como se arranca con Evolution no bloquea, pero hay
que preverlo antes de migrar a Cloud API.
