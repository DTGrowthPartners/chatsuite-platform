"""El anti-patrón de IA: lo que el modelo no puede cumplir solo.

Delay antes de responder, ventana horaria, tope de salientes, apartarse cuando
un humano entra al chat, y partir la respuesta en mensajes cortos. Todo esto
vive en código y no en el prompt a propósito: son reglas de comportamiento que
un modelo olvida, y de las que depende que no sancionen el número.
"""
import asyncio
import logging
import random
import time
from collections import deque
from datetime import datetime
from zoneinfo import ZoneInfo

from . import canal, chatwoot, estado, perfil as perfil_mod

log = logging.getLogger("chatsuite-bot")

_enviados: deque[float] = deque()

# Válvula de emergencia del tráfico REACTIVO. Responderle a alguien que escribió
# no se frena por el tope normal (el bot está para atender); este techo existe
# solo para cortar un descontrol real —un loop, un ataque—, no una buena racha.
TOPE_DURO_HORA = 300


def ahora_local() -> datetime:
    return datetime.now(ZoneInfo(perfil_mod.actual().tz))


def dentro_horario() -> bool:
    p = perfil_mod.actual()
    h = ahora_local().hour
    return int(p.get("operacion.horario.inicio", 0)) <= h < int(p.get("operacion.horario.fin", 24))


def salientes_hora() -> int:
    corte = time.monotonic() - 3600
    while _enviados and _enviados[0] < corte:
        _enviados.popleft()
    return len(_enviados)


def puede_enviar() -> bool:
    """Tope del tráfico PROACTIVO (reenganches, barridos): lo que iniciamos
    nosotros sí guarda ritmo de persona."""
    p = perfil_mod.actual()
    normal = int(p.get("operacion.ritmo.max_salientes_hora", 80))
    tope = min(normal, 60) if estado.convalecencia() else normal
    return salientes_hora() < tope


def valvula_abierta() -> bool:
    return salientes_hora() < TOPE_DURO_HORA


def humano_activo(mensajes_cw: list[dict]) -> bool:
    """True si alguien del equipo escribió hace poco desde el celular vinculado
    (llega como saliente de un User, no del AgentBot): el bot se aparta para no
    pisarse con la persona."""
    reciente = time.time() - 600
    for m in mensajes_cw[-10:]:
        if m.get("message_type") != 1 or m.get("private"):
            continue
        if m.get("created_at", 0) < reciente:
            continue
        tipo = ((m.get("sender") or {}).get("type") or "").lower()
        if tipo and tipo != "agent_bot":
            return True
    return False


def partir(texto: str) -> list[str]:
    """Una línea en blanco parte la respuesta en dos mensajes.

    Solo los textos cortos se parten: los largos suelen ser respuestas rápidas
    oficiales, con líneas en blanco internas, y deben llegar enteras."""
    if len(texto) > 280:
        return [texto]
    partes = [p.strip() for p in texto.split("\n\n") if p.strip()]
    if len(partes) > 2:
        partes = [partes[0], "\n".join(partes[1:])]
    return partes or [texto]


async def enviar(conv_id: int, texto: str, transcurrido: float = 0.0, telefono: str = "") -> None:
    """La espera grande ya ocurrió antes de leer el historial; acá queda un
    remate corto proporcional al texto, descontando lo que tardó el modelo.

    Con teléfono a la mano, mientras corre esa espera el cliente ve
    "escribiendo…" (solo con Evolution): un humano nunca suelta párrafos sin
    que aparezca ese aviso."""
    objetivo = min(6.0, max(1.5, len(texto) * 0.03)) + random.uniform(0.3, 1.5)
    espera = max(0.5, objetivo - transcurrido)
    if telefono:
        asyncio.create_task(canal.escribiendo(telefono, espera))
    await asyncio.sleep(espera)

    for i, parte in enumerate(partir(texto)):
        if i:
            pausa = random.uniform(1.5, 3.0)
            if telefono:
                asyncio.create_task(canal.escribiendo(telefono, pausa))
            await asyncio.sleep(pausa)
        await chatwoot.enviar(conv_id, parte)
        _enviados.append(time.monotonic())
        canal.registrar_envio()
