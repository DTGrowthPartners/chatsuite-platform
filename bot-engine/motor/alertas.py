"""Avisos al equipo.

Canal por defecto: **nota privada en la propia conversación**. Queda al lado
del caso que la motivó, la ve cualquiera del equipo en el panel, y el cliente
nunca la ve. Mandar ruido operativo como saliente es lo que hace que WhatsApp
sancione el número.

Para lo urgente (por defecto solo `escalada`) además se manda un WhatsApp al
equipo, por el canal que corresponda:
- Cloud API → plantilla aprobada, por Graph. Va por plantilla porque un
  escalamiento cae en cualquier momento y casi nunca hay ventana abierta con el
  equipo; y va por Graph y no por Chatsuite para que estos avisos no abran
  conversaciones del equipo dentro del inbox de clientes.
- Evolution → texto directo a cada número.

Anti-spam: una misma alerta (tipo + conversación) no se repite en 6 horas.
Todo es best-effort: una alerta caída jamás debe tumbar la respuesta al cliente.
"""
import asyncio
import logging
import time
from collections import deque

import httpx

from . import audiencia, canal, chatwoot, estado, perfil as perfil_mod, plantillas
from .config import secretos

log = logging.getLogger("chatsuite-bot")

_VENTANA = 6 * 3600
_recientes: dict[str, float] = {}
_ultimas: deque = deque(maxlen=20)

ETIQUETAS = {
    "pregunta": "PREGUNTA DEL BOT",
    "escalada": "CHAT ESCALADO A HUMANO",
    "fallo_ia": "FALLO DE LA IA",
    "rate_limit": "TOPE DE MENSAJES POR HORA",
    "pedido": "PEDIDO NUEVO",
    "cita": "CITA AGENDADA",
    "reconexion": "CANAL RECONECTADO — MODO CONVALECENCIA",
    "sin_acuses": "ENVÍOS SIN ENTREGAR — BOT CONGELADO",
}


def ultimas() -> list[dict]:
    return list(_ultimas)


async def enviar_alerta(tipo: str, conv_id: int, telefono: str, detalle: str) -> bool:
    """True si el aviso quedó registrado. Deduplica por (tipo, conversación)."""
    clave = f"{tipo}:{conv_id}"
    ahora = time.time()
    for k in [k for k, t in _recientes.items() if ahora - t > _VENTANA]:
        _recientes.pop(k, None)
    if clave in _recientes:
        return False
    _recientes[clave] = ahora
    _ultimas.append({"ts": ahora, "tipo": tipo, "conv_id": conv_id,
                     "telefono": telefono, "detalle": detalle})

    p = perfil_mod.actual()
    texto = (
        f"🤖 {ETIQUETAS.get(tipo, tipo.upper())} — {p.negocio}\n\n{detalle}\n\n"
        f"Cliente: {telefono or 'sin teléfono (identificado por user_id)'}"
    )

    ok = True
    if conv_id:
        try:
            await chatwoot.nota_privada(conv_id, texto)
        except Exception:
            log.exception("no se pudo dejar la nota privada %s; queda en el log: %s", tipo, texto)
            ok = False

    if tipo in p.get("alertas.tipos_whatsapp", ["escalada"]):
        motivo = f"{ETIQUETAS.get(tipo, tipo.upper())}. {detalle}"
        asyncio.create_task(_avisar_por_whatsapp(motivo, telefono, tipo))
    return ok


async def avisar_sin_conversacion(tipo: str, detalle: str) -> None:
    """Avisos que no pertenecen a ninguna conversación (reconexión, acuses)."""
    await enviar_alerta(tipo, 0, "", detalle)


async def _avisar_por_whatsapp(motivo: str, cliente: str, tipo: str = "") -> None:
    p = perfil_mod.actual()
    destinos = p.get("alertas.numeros_pregunta", []) if tipo == "pregunta" else []
    destinos = [estado.normalizar(n) for n in destinos] or audiencia.telefonos_equipo()
    if not destinos:
        return

    if canal.es_cloud():
        nombre = p.get("canal.cloud_api.plantilla_alerta", "")
        if not nombre:
            log.debug("sin plantilla de alerta configurada; el aviso queda en la nota privada")
            return
        idioma = p.get("canal.cloud_api.plantilla_alerta_idioma", "es")
        for numero in destinos:
            await plantillas.enviar(numero, nombre, idioma, [motivo, cliente or "sin identificar"])
        return

    # Evolution: texto directo a cada número del equipo.
    url = p.get("canal.evolution.url") or secretos.evolution_url
    instancia = p.get("canal.evolution.instancia", "")
    if not (url and instancia):
        return
    cuerpo = f"🤖 {motivo}\n\nCliente: {cliente or 'sin identificar'}"
    for numero in destinos:
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as c:
                await c.post(
                    f"{url}/message/sendText/{instancia}",
                    headers={"apikey": secretos.evolution_apikey},
                    json={"number": numero, "text": cuerpo},
                )
        except Exception:
            log.exception("no se pudo avisar por Evolution a %s", numero)
