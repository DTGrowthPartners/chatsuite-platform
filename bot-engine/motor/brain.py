"""El cerebro: Claude vía Darío, con las tools de los módulos activos.

El system prompt y la lista de tools se arman en CADA mensaje desde el perfil,
así que cambiar el catálogo, una respuesta rápida o el tono aplica al instante
sin reiniciar el servicio.
"""
import logging
import time
from dataclasses import dataclass, field

from anthropic import AsyncAnthropic

import modulos
from modulos.base import Contexto

from . import chatwoot, eventos, perfil as perfil_mod, prompt
from .config import secretos

log = logging.getLogger("chatsuite-bot")

claude = AsyncAnthropic(base_url=secretos.dario_url, api_key="dario", max_retries=2)

MENSAJE_DEGRADACION = "dame un momento que estoy con varias cosas, ya te atiende mi compañero"

# Tope de vueltas del bucle de tools. Si el modelo se queda pidiendo tools sin
# producir texto, se corta y se escala en vez de gastar tokens indefinidamente.
MAX_VUELTAS = 5


@dataclass
class Respuesta:
    texto: str
    escalar: bool = False
    motivo: str = ""
    efectos: list = field(default_factory=list)
    tools_usadas: list = field(default_factory=list)
    # Las etiquetas que se pusieron en este turno. Se aplican aquí mismo, pero
    # además salen porque al escalar son la única pista de TEMA que hay para
    # elegir asesor sin volver a preguntarle al modelo.
    etiquetas: list = field(default_factory=list)
    # Texto que el modelo escribió EN EL MISMO turno en que pidió una tool.
    # No se envía (ver el comentario en el bucle), pero el simulador lo muestra:
    # es la explicación de por qué a veces la respuesta final «olvida» algo que
    # el modelo sí había contestado.
    texto_descartado: list = field(default_factory=list)
    # Lo que costó el turno. Lo consume el registro de eventos: con Darío sobre
    # el plan Max el costo marginal es cero hoy, pero tokens por conversación
    # es el número que dice cuándo eso deja de ser viable.
    tokens_in: int = 0
    tokens_out: int = 0
    # El system prompt va con cache_control, así que los tokens cacheados NO
    # aparecen en input_tokens: se reportan aparte. Contar solo input_tokens
    # daría 333 donde el turno realmente movió 8.000 — una métrica de costo que
    # miente es peor que ninguna.
    tokens_cache_lectura: int = 0
    tokens_cache_escritura: int = 0
    ms_modelo: int = 0


# ── Clasificación barata para las vistas del panel ──────────────────────────
# Las etiquetas que salen de tools que el modelo llama explícitamente son
# fiables. Estas se deducen del texto del cliente y son aproximadas a propósito:
# corren ANTES de llamar al modelo, así que no dependen de que el turno termine
# bien ni gastan tokens, y el costo de una etiqueta de más es que alguien la
# quite. Se prefirió esto a una tool de clasificar, que suma un round-trip y
# depende de que el modelo se acuerde de llamarla.

_PISTAS_POR_DEFECTO = {
    "cotizacion": [
        "cuanto vale", "cuánto vale", "cuanto cuesta", "cuánto cuesta", "que precio",
        "qué precio", "precio", "cotiza", "tienen", "disponible", "manejan", "venden",
    ],
    "seguimiento": [
        "lo pienso", "lo voy a pensar", "despues te", "después te", "mas tarde",
        "más tarde", "manana te", "mañana te", "te aviso", "te confirmo", "ahorita no",
        "luego te", "cuando pueda", "lo consulto", "déjame ver", "dejame ver",
    ],
}


def _etiquetas_por_texto(texto: str, p) -> list[str]:
    t = (texto or "").lower().strip()
    if not t:
        return []
    pistas = p.get("clasificacion", _PISTAS_POR_DEFECTO) or _PISTAS_POR_DEFECTO
    return [etq for etq, claves in pistas.items() if any(k in t for k in claves)]


def _ultimo_texto_cliente(mensajes: list[dict]) -> str:
    for m in reversed(mensajes or []):
        if m.get("role") != "user":
            continue
        c = m.get("content")
        if isinstance(c, str):
            return c
        if isinstance(c, list):
            partes = [b.get("text", "") for b in c
                      if isinstance(b, dict) and b.get("type") == "text"]
            if partes:
                return " ".join(partes)
    return ""


async def responder(
    mensajes: list[dict], conv_id: int, telefono: str = "", simulacion: bool = False
) -> Respuesta:
    p = perfil_mod.actual()
    activos = modulos.activos(p)
    system = prompt.construir(p, activos)
    tools = [t for m in activos for t in m.tools(p)]

    ctx = Contexto(conv_id=conv_id, telefono=telefono, perfil=p, simulacion=simulacion)

    if not simulacion:
        try:
            etiquetas = _etiquetas_por_texto(_ultimo_texto_cliente(mensajes), p)
            if etiquetas:
                await chatwoot.etiquetar(conv_id, etiquetas)
        except Exception:
            log.exception("conv %s: no se pudo etiquetar por texto", conv_id)

    usadas: list[str] = []
    descartados: list[str] = []
    tokens_in = tokens_out = ms_modelo = 0
    cache_lee = cache_escribe = 0

    for _ in range(MAX_VUELTAS):
        arranque = time.monotonic()
        resp = await claude.messages.create(
            model=p.get("modelo.nombre", "claude-sonnet-4-6"),
            max_tokens=int(p.get("modelo.max_tokens", 1000)),
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            tools=tools,
            messages=mensajes,
        )
        ms_modelo += int((time.monotonic() - arranque) * 1000)
        uso = getattr(resp, "usage", None)
        tokens_in += getattr(uso, "input_tokens", 0) or 0
        tokens_out += getattr(uso, "output_tokens", 0) or 0
        cache_lee += getattr(uso, "cache_read_input_tokens", 0) or 0
        cache_escribe += getattr(uso, "cache_creation_input_tokens", 0) or 0

        textos = [b.text for b in resp.content if b.type == "text"]
        pedidas = [b for b in resp.content if b.type == "tool_use"]

        if resp.stop_reason != "tool_use" or not pedidas:
            partes = (descartados + textos) if p.get("modelo.texto_junto_a_tools", True) else textos
            return Respuesta(texto="\n\n".join(t for t in partes if t.strip()).strip(),
                             efectos=ctx.efectos, tools_usadas=usadas,
                             texto_descartado=descartados, tokens_in=tokens_in,
                             tokens_out=tokens_out, ms_modelo=ms_modelo,
                             tokens_cache_lectura=cache_lee, tokens_cache_escritura=cache_escribe)

        # El modelo puede pedir VARIAS tools en un mismo turno (p. ej. al
        # cerrar: registrar_pedido + escalar_a_humano). La API exige un
        # tool_result por CADA tool_use, así que se ejecutan todas y, si alguna
        # fue escalar, se honra al final.
        # El texto que el modelo escribe JUNTO a una tool sí va al cliente.
        #
        # En el bot anterior se descartaba, y era una pérdida silenciosa: ante
        # «mándame las fotos y cuánto vale el domicilio», el modelo respondía el
        # precio del domicilio en el mismo turno de la tool y el cliente nunca
        # lo recibía. Incluirlo NO duplica: el turno siguiente se genera con
        # este texto ya en el contexto como propio, así que el modelo continúa
        # en vez de repetirse (verificado en el simulador).
        descartados += [t for t in textos if t.strip()]

        resultados, escalar, motivo, etiquetas = [], False, "", []
        attrs_conv: dict = {}
        attrs_contacto: dict = {}
        for tu in pedidas:
            usadas.append(tu.name)
            if not simulacion:
                eventos.registrar("tool", conv_id, nombre=tu.name)
            salida = None
            for m in activos:
                salida = await m.ejecutar(tu.name, tu.input or {}, ctx)
                if salida is not None:
                    break
            if salida is None:
                salida = type("R", (), {"texto": "Esa herramienta no está disponible.",
                                        "escalar": False, "motivo": "", "etiquetas": []})()
            if salida.escalar:
                escalar, motivo = True, salida.motivo
            etiquetas += list(salida.etiquetas or [])
            attrs_conv.update(getattr(salida, "atributos", None) or {})
            attrs_contacto.update(getattr(salida, "atributos_contacto", None) or {})
            resultados.append({"type": "tool_result", "tool_use_id": tu.id,
                               "content": salida.texto})

        if not simulacion:
            if etiquetas:
                try:
                    await chatwoot.etiquetar(conv_id, etiquetas)
                except Exception:
                    log.exception("conv %s: no se pudieron poner las etiquetas %s", conv_id, etiquetas)
            # Los atributos son lo que hace que el equipo pueda FILTRAR después
            # ("pedidos de hoy sin despachar"); que fallen no debe tumbar la
            # respuesta al cliente.
            for valores, escribir, que in (
                (attrs_conv, chatwoot.atributos_conversacion, "de la conversación"),
                (attrs_contacto, chatwoot.atributos_contacto, "del contacto"),
            ):
                if not valores:
                    continue
                try:
                    await escribir(conv_id, valores)
                except Exception:
                    log.exception("conv %s: no se pudieron escribir los atributos %s", conv_id, que)

        if escalar:
            # `descartados` YA incluye los `textos` de este turno (se acumulan
            # unas líneas más arriba): sumarlos otra vez duplicaba el mensaje.
            partes = descartados if p.get("modelo.texto_junto_a_tools", True) else textos
            texto = ("\n\n".join(t for t in partes if t.strip()).strip()
                     or "ya te comunico con mi compañero, un momento")
            return Respuesta(texto=texto, escalar=True, motivo=motivo,
                             etiquetas=list(etiquetas),
                             efectos=ctx.efectos, tools_usadas=usadas,
                             texto_descartado=descartados, tokens_in=tokens_in,
                             tokens_out=tokens_out, ms_modelo=ms_modelo,
                             tokens_cache_lectura=cache_lee, tokens_cache_escritura=cache_escribe)

        mensajes = mensajes + [
            {"role": "assistant", "content": [b.model_dump() for b in resp.content]},
            {"role": "user", "content": resultados},
        ]

    return Respuesta(texto=MENSAJE_DEGRADACION, escalar=True, motivo="loop de tools sin salida",
                     efectos=ctx.efectos, tools_usadas=usadas, texto_descartado=descartados,
                     tokens_in=tokens_in, tokens_out=tokens_out, ms_modelo=ms_modelo,
                     tokens_cache_lectura=cache_lee, tokens_cache_escritura=cache_escribe)


async def reenganche(mensajes: list[dict]) -> str:
    """Un solo mensaje corto para retomar una conversación que se enfrió. El
    historial de una fría termina en turno nuestro, así que la tarea entra como
    turno de usuario sintético."""
    p = perfil_mod.actual()
    system = prompt.construir(p, modulos.activos(p)) + (
        "\n\n# Tarea puntual (modo reenganche)\n"
        "El cliente dejó de responder hace horas. Escribe UN solo mensaje corto y natural "
        "para retomar la conversación exactamente donde quedó. Sin presión, sin emojis, "
        "máximo 2 líneas, y sin sonar a plantilla. Responde SOLO con el mensaje para el "
        "cliente, nada más."
    )
    resp = await claude.messages.create(
        model=p.get("modelo.nombre", "claude-sonnet-4-6"),
        max_tokens=200,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=mensajes + [{
            "role": "user",
            "content": "[el cliente lleva horas sin responder; escribe el mensaje de reenganche]",
        }],
    )
    return "\n".join(b.text for b in resp.content if b.type == "text").strip()
