"""La API del bot: webhook del AgentBot, administración y simulador.

Flujo (Chatsuite al centro):
  Chatsuite POSTea aquí los `message_created` de conversaciones `pending`
  → se responde 200 de una y se procesa en background
  → el historial se lee de la API de Chatsuite (Chatsuite es la memoria)
  → Claude vía Darío decide: responder o escalar
  → la respuesta sale por la API de Chatsuite, o handoff nativo (pending → open)

⚠️ Para que esto funcione, el inbox necesita `enable_auto_assignment = false`.
Con la asignación automática encendida la conversación nace `open` y asignada,
y el bot NUNCA la ve.
"""
import asyncio
import json
import logging
import random
import re
import time
from collections import OrderedDict

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse

import modulos

from . import (alertas, audiencia, brain, canal, chatwoot, estado, eventos,
               historial, humanizador, perfil as perfil_mod, plantillas)
from .config import DATA, secretos

log = logging.getLogger("chatsuite-bot")

app = FastAPI()

# Dedupe: Chatsuite reintenta los webhooks si tardamos en responder.
_vistos: OrderedDict[int, None] = OrderedDict()
_VISTOS_MAX = 5000

# Conversaciones con una respuesta ya en camino: los webhooks que lleguen
# durante la espera se absorben — la corrida en curso lee el historial DESPUÉS
# de esperar, así que esos mensajes entran en la misma respuesta en vez de
# generar una respuesta por mensaje.
_en_proceso: set[int] = set()

# Fuera de horario se avisa una sola vez por conversación por día.
_avisados_horario: dict[int, str] = {}

_barriendo = False

RUTA_REENG = DATA / "reenganches.json"
_REENG_VENTANA = 7 * 86400

_PIDE_HUMANO = re.compile(
    r"\b(asesor|asesora|humano|una persona|persona real|alguien real|"
    r"atenci[oó]n al cliente|hablar con alguien)\b",
    re.I,
)


# ── Identidad del cliente ───────────────────────────────────────────────────

def _identidad(ev: dict) -> str:
    """Con qué se identifica a quien escribió.

    Con Evolution siempre viene `phone_number`. Con Cloud API desde el webhook
    v26 Meta manda identidades SIN teléfono (`source_id` = "CO.1595292012248084"),
    y exigir teléfono acá descarta el 100% del tráfico en silencio.

    Sirve igual como clave: `estado.normalizar()` se queda con los dígitos, y
    ese identificador es estable y único por contacto.
    """
    sender = ev.get("sender") or {}
    conv = ev.get("conversation") or {}
    origen = (
        sender.get("phone_number")
        or (conv.get("contact_inbox") or {}).get("source_id")
        or sender.get("identifier")
        or ""
    )
    if origen.endswith("@g.us") or origen.startswith("status@"):
        return ""  # grupos y difusiones
    return origen


def _es_telefono(valor: str) -> bool:
    """Distingue un teléfono real de una identidad sin número. Los `user_id` de
    v26 y los LID quedan en 14+ dígitos, y a esos no se les puede mandar una
    plantilla: Meta necesita un número."""
    return 10 <= len(estado.normalizar(valor)) <= 13


# ── Arranque ────────────────────────────────────────────────────────────────

@app.on_event("startup")
async def _arrancar():
    p = perfil_mod.actual()
    log.info(
        "bot de %s arrancando · estado=%s · canal=%s · audiencia=%s · modulos=%s",
        p.negocio, p.estado, p.canal, p.audiencia, ",".join(p.modulos) or "-",
    )
    asyncio.create_task(canal.vigilar(_barrido_pendientes, alertas.avisar_sin_conversacion))


@app.get("/bot/health")
async def health():
    p = perfil_mod.actual()
    return {"ok": True, "slug": p.slug, "estado": p.estado, "canal": p.canal}


# ── Webhook del AgentBot ────────────────────────────────────────────────────

@app.post("/bot/webhook")
async def webhook(request: Request):
    ev = await request.json()
    if ev.get("event") != "message_created":
        return {"ok": True}
    if ev.get("message_type") != "incoming" or ev.get("private"):
        return {"ok": True}
    conv = ev.get("conversation") or {}
    if conv.get("status") != "pending":
        return {"ok": True}  # ya la tiene un humano, o está resuelta
    if not _identidad(ev):
        return {"ok": True}  # grupos y contactos de sistema

    msg_id = ev.get("id")
    if msg_id in _vistos:
        return {"ok": True}
    _vistos[msg_id] = None
    while len(_vistos) > _VISTOS_MAX:
        _vistos.popitem(last=False)

    asyncio.create_task(_procesar(conv.get("display_id") or conv["id"], ev))
    return {"ok": True}


@app.post("/bot/canal/acuse")
async def acuse(request: Request):
    """Lo llama el puente de acuses de Evolution. Sin este cable el freno por
    acuses no puede funcionar (y por eso no congela si nunca vio ninguno)."""
    try:
        ev = await request.json()
    except Exception:
        ev = {}
    evento = ev.get("event")
    if evento == "messages.update":
        d = ev.get("data") or {}
        for item in (d if isinstance(d, list) else [d]):
            if (item or {}).get("status") in ("DELIVERY_ACK", "READ", "PLAYED"):
                canal.registrar_acuse()
                break
    return {"ok": True}


# ── Procesamiento ───────────────────────────────────────────────────────────

async def _procesar(conv_id: int, ev: dict):
    inicio = time.monotonic()
    texto = (ev.get("content") or "").strip()
    telefono = _identidad(ev)
    p = perfil_mod.actual()
    try:
        # 1. Ciclo de vida. En borrador el bot no contesta; en prueba solo le
        #    contesta al equipo, para poder afinarlo con el número conectado sin
        #    que un cliente real reciba nada.
        if p.estado == perfil_mod.BORRADOR:
            log.info("conv %s: perfil en borrador; no responde", conv_id)
            return
        if p.estado == perfil_mod.PRUEBA and not audiencia.es_equipo(telefono):
            log.info("conv %s: perfil en prueba y %s no es del equipo; no responde",
                     conv_id, telefono)
            return

        if canal.congelado():
            # Sin acuses de entrega: enviar sería disparar contra la pared y
            # agravar una posible sanción. Queda en la cola; el barrido la
            # retoma cuando los acuses vuelvan.
            log.warning("conv %s: salientes congelados; queda pendiente", conv_id)
            eventos.registrar("no_respondio", conv_id, motivo="congelado")
            return

        ok, motivo = audiencia.atiende(telefono)
        if not ok:
            log.info("conv %s: %s (%s)", conv_id, motivo, telefono)
            return

        if estado.pausada(telefono):
            log.info("conv %s pausada (%s); no responde", conv_id, telefono)
            return

        if not humanizador.dentro_horario():
            hoy = str(humanizador.ahora_local().date())
            eventos.registrar("no_respondio", conv_id, motivo="fuera_de_horario")
            if _avisados_horario.get(conv_id) != hoy:
                _avisados_horario[conv_id] = hoy
                aviso = p.get("operacion.horario.mensaje_fuera", "")
                if aviso:
                    await asyncio.sleep(random.uniform(4.0, 9.0))
                    await chatwoot.enviar(conv_id, aviso)
            return

        if not humanizador.valvula_abierta():
            log.warning("conv %s: válvula de emergencia; escala sin responder", conv_id)
            await alertas.enviar_alerta(
                "rate_limit", conv_id, telefono,
                f"El bot lleva más de {humanizador.TOPE_DURO_HORA} mensajes en una hora "
                "(posible descontrol). Esta conversación pasó a la cola humana sin respuesta.",
            )
            await chatwoot.a_humano(conv_id)
            return

        if _PIDE_HUMANO.search(texto):
            await humanizador.enviar(
                conv_id, p.get("operacion.mensaje_handoff", "ya te comunico con mi compañero, un momento"),
                time.monotonic() - inicio, telefono,
            )
            await chatwoot.a_humano(conv_id)
            log.info("conv %s escalada por palabra clave", conv_id)
            return

        # Espera grande ANTES de leer el historial: se ve humano y, sobre todo,
        # coalesce — si el cliente manda tres mensajes seguidos sale UNA
        # respuesta que los cubre todos, no tres.
        if conv_id in _en_proceso:
            log.info("conv %s: respuesta ya en camino; este mensaje entra en ella", conv_id)
            return
        _en_proceso.add(conv_id)
        try:
            await asyncio.sleep(random.uniform(
                float(p.get("operacion.ritmo.respuesta_min_seg", 15)),
                float(p.get("operacion.ritmo.respuesta_max_seg", 40)),
            ))
            await _responder(conv_id, texto, telefono, inicio)
        finally:
            _en_proceso.discard(conv_id)
    except Exception as e:
        await _degradar(conv_id, telefono, e)


async def _responder(conv_id: int, texto: str, telefono: str, inicio: float):
    p = perfil_mod.actual()
    try:
        crudo = await chatwoot.historial(conv_id)
        if humanizador.humano_activo(crudo):
            estado.pausar(telefono, int(p.get("operacion.pausa_humano_seg", 3600)))
            await chatwoot.a_humano(conv_id)
            eventos.registrar("humano_entro", conv_id)
            log.info("conv %s: humano activo; el bot se aparta", conv_id)
            return

        mensajes = await historial.armar(crudo)
        # El historial debe terminar en turno del cliente (el webhook puede
        # llegar antes de que el mensaje quede persistido en Chatsuite).
        if not mensajes or mensajes[-1]["role"] != "user":
            if not texto:
                return
            mensajes.append({"role": "user", "content": texto})

        r = await brain.responder(mensajes, conv_id, telefono)
        if r.texto:
            await humanizador.enviar(conv_id, r.texto, time.monotonic() - inicio, telefono)
            eventos.registrar(
                "atendido", conv_id,
                tokens_in=r.tokens_in, tokens_out=r.tokens_out, ms=r.ms_modelo,
                cache_lee=r.tokens_cache_lectura, cache_escribe=r.tokens_cache_escritura,
                turnos=len(mensajes), partes=len(humanizador.partir(r.texto)),
            )
        if r.escalar:
            await chatwoot.a_humano(conv_id)
            log.info("conv %s escalada por el modelo: %s", conv_id, r.motivo)
    except Exception as e:
        await _degradar(conv_id, telefono, e)


async def _degradar(conv_id: int, telefono: str, e: Exception):
    log.exception("conv %s: error procesando; escalando a humano", conv_id)
    eventos.registrar("fallo", conv_id, error=f"{type(e).__name__}: {e}"[:200])
    try:
        await alertas.enviar_alerta(
            "fallo_ia", conv_id, telefono,
            f"El bot no pudo responder ({type(e).__name__}: {e}). El cliente quedó en la "
            "cola humana.",
        )
        await chatwoot.enviar(conv_id, brain.MENSAJE_DEGRADACION)
        await chatwoot.a_humano(conv_id)
    except Exception:
        log.exception("conv %s: tampoco se pudo escalar", conv_id)


# ── Simulador: probar el bot sin tocar WhatsApp ─────────────────────────────

@app.post("/bot/simular")
async def simular(request: Request):
    """Corre el motor con el perfil real y las tools de verdad, pero sin mandar
    nada a nadie. Es la pantalla que permite configurar y afinar un bot ANTES
    de entregárselo al cliente.

    Entrada:  {"mensajes": [{"role": "user", "content": "hola"}]}
    Salida:   el texto ya partido en los mensajes que saldrían, qué tools se
              llamaron, qué habría hecho cada una, y si escalaría.
    """
    datos = await request.json()
    mensajes = datos.get("mensajes") or []
    if not mensajes or mensajes[-1].get("role") != "user":
        return {"ok": False, "error": "el último mensaje debe ser del cliente (role: user)"}

    inicio = time.monotonic()
    r = await brain.responder(mensajes, conv_id=0, telefono="", simulacion=True)
    p = perfil_mod.actual()
    return {
        "ok": True,
        "mensajes": humanizador.partir(r.texto) if r.texto else [],
        "escalaria": r.escalar,
        "motivo": r.motivo,
        "tools": r.tools_usadas,
        "efectos": r.efectos,
        "texto_descartado": r.texto_descartado,
        "segundos": round(time.monotonic() - inicio, 2),
        # Sirve al afinar: se ve al instante si un prompt más largo o una tool
        # de más disparan el costo del turno.
        "tokens": {
            "entrada": r.tokens_in, "salida": r.tokens_out,
            "cache_lectura": r.tokens_cache_lectura,
            "cache_escritura": r.tokens_cache_escritura,
            "ms_modelo": r.ms_modelo,
        },
        "perfil": {"slug": p.slug, "estado": p.estado, "modulos": p.modulos},
    }


@app.get("/bot/admin/esquema")
async def admin_esquema():
    """Qué necesita este bot que exista en Chatsuite: sus etiquetas y sus
    atributos. Lo consume el panel para crearlos; así agregar un módulo no
    obliga a tocar el panel."""
    p = perfil_mod.actual()
    activos = modulos.activos(p)
    atributos, vistos = [], set()
    for m in activos:
        for a in m.atributos(p):
            if a.get("clave") and a["clave"] not in vistos:
                vistos.add(a["clave"])
                atributos.append(a)
    return {
        "etiquetas": [e for e in p.get("etiquetas", []) if e.get("nombre")],
        "atributos": atributos,
        "modulos": [m.nombre for m in activos],
    }


@app.get("/bot/simular/prompt")
async def ver_prompt():
    """El system prompt tal como lo recibe el modelo con el perfil de ahora.
    Sirve para entender por qué contestó lo que contestó."""
    from . import prompt as prompt_mod
    p = perfil_mod.actual()
    activos = modulos.activos(p)
    return {
        "prompt": prompt_mod.construir(p, activos),
        "tools": [t["name"] for m in activos for t in m.tools(p)],
        "etiquetas": sorted(p.etiquetas_validas),
        # La persona tal como saldría de los formularios. El panel la usa para
        # sembrar el modo experto: quien lo enciende parte de lo que ya tenía en
        # vez de una hoja en blanco, que es lo que hace que nadie lo use.
        "persona_generada": prompt_mod.persona_generada(p),
        "modo_experto": bool(p.get("persona.modo_experto", False)),
    }


# ── Administración ──────────────────────────────────────────────────────────

@app.get("/bot/admin/estado")
async def admin_estado():
    p = perfil_mod.actual()
    return {
        "slug": p.slug,
        "estado": p.estado,
        "audiencia": p.audiencia,
        "modulos": p.modulos,
        "pausas": estado.pausas_activas(),
        "convalecencia": estado.convalecencia(),
        "canal": canal.diagnostico(),
        "salientes_ultima_hora": humanizador.salientes_hora(),
        # Cuando el proceso leyo el perfil que esta usando AHORA. Pedir este
        # estado ya fuerza la relectura por mtime, asi que el panel puede
        # preguntar despues de guardar y confirmar que el cambio entro, en vez
        # de prometerlo. Sin esto, guardar y no ver nada se siente igual que
        # guardar y que falle.
        "perfil_leido_en": perfil_mod.leido_en(),
        "alertas_recientes": alertas.ultimas()[-5:],
    }


@app.post("/bot/admin/estado")
async def admin_set_estado(request: Request):
    """Mueve el ciclo de vida: borrador → prueba → produccion.

    Escribe en perfil.json a propósito. En el bot anterior este interruptor
    vivía en un archivo de runtime, el proceso lo pisaba, y el modo observación
    se perdió solo en un reinicio sin que nadie lo notara.
    """
    datos = await request.json()
    nuevo = datos.get("estado")
    if nuevo not in (perfil_mod.BORRADOR, perfil_mod.PRUEBA, perfil_mod.PRODUCCION):
        return {"ok": False, "error": "estado inválido (borrador | prueba | produccion)"}
    actual = perfil_mod.actual().como_dict()
    actual["estado"] = nuevo
    perfil_mod.escribir(actual)
    log.warning("ciclo de vida del bot: %s", nuevo)
    return {"ok": True, "estado": perfil_mod.actual().estado}


@app.get("/bot/admin/metricas")
async def admin_metricas(request: Request):
    """Lo que hizo el bot. Es interno: al cliente no se le muestra nada de esto,
    él solo ve su Chatsuite."""
    dias = int(request.query_params.get("dias") or 30)
    return {
        **eventos.resumen(max(1, min(dias, 400))),
        # Las preguntas que no supo responder van aparte porque no son una
        # métrica: son la lista de trabajo para mejorarlo.
        "sin_datos": eventos.sin_datos(),
    }


@app.get("/bot/admin/perfil")
async def admin_ver_perfil():
    return perfil_mod.actual().como_dict()


@app.put("/bot/admin/perfil")
async def admin_guardar_perfil(request: Request):
    """Lo usa el panel. El motor lo relee solo al cambiar el mtime: no hace
    falta reiniciar para que aplique."""
    datos = await request.json()
    if not isinstance(datos, dict) or "slug" not in datos:
        return {"ok": False, "error": "el perfil debe ser un objeto con al menos `slug`"}
    perfil_mod.escribir(datos)
    p = perfil_mod.actual()
    return {"ok": True, "slug": p.slug, "estado": p.estado, "modulos": p.modulos}


@app.post("/bot/admin/pausa")
async def admin_pausa(request: Request):
    datos = await request.json()
    telefono = datos.get("telefono") or ""
    modo = datos.get("modo")
    if not estado.normalizar(telefono):
        return {"ok": False, "error": "falta el teléfono"}
    if modo == "1h":
        estado.pausar(telefono, 3600)
    elif modo == "indefinida":
        estado.pausar(telefono, None)
    elif modo == "quitar":
        estado.reactivar(telefono)
    else:
        return {"ok": False, "error": "modo inválido (1h | indefinida | quitar)"}
    return {"ok": True, "pausas": estado.pausas_activas()}


@app.get("/bot/catalogo.pdf")
async def catalogo_publico():
    """El catálogo vigente en URL pública, para compartirlo por fuera del chat.
    Siempre la versión actual: si cambió, se regenera acá mismo."""
    p = perfil_mod.actual()
    if "tienda" not in p.modulos:
        return {"ok": False, "error": "este bot no tiene el módulo tienda"}
    from modulos import tienda_pdf
    ruta = await asyncio.to_thread(tienda_pdf.asegurar, p)
    return FileResponse(ruta, media_type="application/pdf",
                        filename=f"catalogo-{p.slug}.pdf",
                        headers={"Cache-Control": "no-cache"})


# ── Reenganche de conversaciones frías ──────────────────────────────────────

def _reenganches() -> dict:
    try:
        return json.loads(RUTA_REENG.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _marcar_reenganche(telefono: str) -> None:
    datos = _reenganches()
    datos[estado.normalizar(telefono)] = time.time()
    ahora = time.time()
    datos = {t: ts for t, ts in datos.items() if ahora - ts < 30 * 86400}
    tmp = RUTA_REENG.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(datos, indent=2), encoding="utf-8")
    tmp.replace(RUTA_REENG)


@app.get("/bot/admin/frias")
async def admin_frias():
    """Pendientes donde el bot respondió y el cliente calló (12 h a 7 días)."""
    ahora = time.time()
    reeng = _reenganches()
    frias = []
    for conv in await chatwoot.conversaciones_pendientes():
        remitente = ((conv.get("meta") or {}).get("sender") or {})
        telefono = remitente.get("phone_number") or ""
        if not telefono or audiencia.es_equipo(telefono):
            continue
        ultimo = conv.get("last_non_activity_message") or {}
        if ultimo.get("message_type") != 1:
            continue  # el último debe ser nuestro: el cliente fue quien calló
        horas = (ahora - (conv.get("last_activity_at") or 0)) / 3600
        if not (12 <= horas <= 24 * 7):
            continue
        frias.append({
            "conv_id": conv.get("id"),
            "telefono": telefono,
            "nombre": remitente.get("name") or "",
            "horas": int(horas),
            "ultimo": (ultimo.get("content") or "")[:90],
            "reenganchado": ahora - reeng.get(estado.normalizar(telefono), 0) < _REENG_VENTANA,
        })
    return {"frias": frias}


async def _proactivo_bloqueado(conv_id: int, telefono: str) -> bool:
    """True si NO se debe mandar texto libre (y ya se gestionó acá)."""
    try:
        h = await chatwoot.historial(conv_id)
    except Exception:
        log.exception("conv %s: sin historial; no se arriesga un envío", conv_id)
        return True

    bloqueado, explicacion = await canal.bloquea_proactivo(conv_id, telefono, h)
    if bloqueado and explicacion:
        # La plantilla sale por Graph, así que no queda registrada en la
        # conversación: sin esta nota, en el panel parece que no se hizo nada.
        try:
            await chatwoot.nota_privada(conv_id, f"🤖 {explicacion}")
        except Exception:
            log.exception("conv %s: no se pudo dejar la nota de la plantilla", conv_id)
    return bloqueado


@app.post("/bot/admin/reenganchar")
async def admin_reenganchar(request: Request):
    """Un mensaje suave para retomar una conversación fría. Frenos anti-spam:
    uno por cliente por semana, más horario, pausas, ciclo de vida y tope."""
    datos = await request.json()
    conv_id = datos.get("conv_id")
    telefono = datos.get("telefono") or ""
    p = perfil_mod.actual()
    if not conv_id or not estado.normalizar(telefono):
        return {"ok": False, "error": "faltan conv_id o teléfono"}
    if not p.en_produccion:
        return {"ok": False, "error": f"el bot está en {p.estado}, no en producción"}
    if not p.get("operacion.reenganche.activo", True):
        return {"ok": False, "error": "el reenganche está desactivado en el perfil"}
    if estado.convalecencia():
        return {"ok": False, "error": "modo convalecencia: sin reenganches por 48 h"}
    if canal.congelado():
        return {"ok": False, "error": "los envíos están congelados (sin acuses)"}
    if estado.pausada(telefono):
        return {"ok": False, "error": "ese chat está pausado"}
    if not humanizador.dentro_horario():
        return {"ok": False, "error": "fuera del horario de atención"}
    if not humanizador.puede_enviar():
        return {"ok": False, "error": "tope de mensajes por hora alcanzado"}
    dias = int(p.get("operacion.reenganche.ventana_dias", 7))
    if time.time() - _reenganches().get(estado.normalizar(telefono), 0) < dias * 86400:
        return {"ok": False, "error": f"a este cliente ya se le escribió en los últimos {dias} días"}

    if await _proactivo_bloqueado(conv_id, telefono):
        return {"ok": True, "via": "plantilla",
                "mensaje": "ventana vencida: se resolvió por plantilla (ver la nota en el chat)"}

    mensajes = await historial.armar(await chatwoot.historial(conv_id))
    if not mensajes:
        return {"ok": False, "error": "sin historial para retomar"}
    texto = await brain.reenganche(mensajes)
    if not texto:
        return {"ok": False, "error": "no se pudo generar el mensaje"}
    await humanizador.enviar(conv_id, texto, 0, telefono)
    _marcar_reenganche(telefono)
    eventos.registrar("reenganche", conv_id)
    return {"ok": True, "mensaje": texto}


@app.post("/bot/admin/barrer")
async def admin_barrer():
    p = perfil_mod.actual()
    if not p.en_produccion:
        return {"ok": False, "error": f"el bot está en {p.estado}"}
    if canal.congelado():
        return {"ok": False, "error": "los envíos están congelados"}
    if _barriendo:
        return {"ok": True, "nota": "ya hay un barrido corriendo"}
    asyncio.create_task(_barrido_pendientes(asentar=False))
    return {"ok": True, "nota": "barrido lanzado: responderá en goteo lo que esté esperando"}


async def _barrido_pendientes(asentar: bool = True):
    """Tras una reconexión, o a demanda: responder en GOTEO lo que quedó
    esperando mientras el canal estuvo caído — una cada 2-5 minutos, nunca en
    ráfaga, que es la firma que sanciona WhatsApp justo cuando más nos vigila.

    Si la reconexión cae de madrugada el barrido NO se cancela: espera a que
    abra el horario. (Cancelarlo por horario dejó pendientes sin respuesta.)
    """
    global _barriendo
    if _barriendo:
        return
    _barriendo = True
    try:
        if asentar:
            await asyncio.sleep(600)  # dejar asentar la sesión
        while not humanizador.dentro_horario():
            await asyncio.sleep(600)
        try:
            convs = await chatwoot.conversaciones_pendientes()
        except Exception:
            log.exception("barrido: no se pudieron listar las pendientes")
            return
        log.info("barrido: %s conversaciones pendientes", len(convs))
        for conv in convs:
            if not perfil_mod.actual().en_produccion or canal.congelado():
                return
            remitente = ((conv.get("meta") or {}).get("sender") or {})
            telefono = remitente.get("phone_number") or ""
            if not telefono or audiencia.es_equipo(telefono) or estado.pausada(telefono):
                continue
            ultimo = conv.get("last_non_activity_message") or {}
            if ultimo.get("message_type") != 0:
                continue  # solo si el cliente habló de último y espera respuesta
            while not humanizador.dentro_horario() or not humanizador.puede_enviar():
                await asyncio.sleep(600)
            conv_id = conv.get("display_id") or conv.get("id")
            if not conv_id or conv_id in _en_proceso:
                continue
            _en_proceso.add(conv_id)
            try:
                if not await _proactivo_bloqueado(conv_id, telefono):
                    await _responder(conv_id, "", telefono, time.monotonic())
            finally:
                _en_proceso.discard(conv_id)
            await asyncio.sleep(random.uniform(120, 300))
    finally:
        _barriendo = False
