"""Plantillas de WhatsApp por Graph, y la ventana de 24 horas de Cloud API.

Cloud API solo deja mandar texto libre dentro de las 24 h posteriores al último
mensaje DEL CLIENTE. Fuera de esa ventana hace falta una plantilla aprobada por
Meta. Con Evolution esto no existe —se escribe cuando uno quiera— así que es
una regla del canal, no algo configurable.

La ventana se mira ANTES de enviar, nunca se reacciona al fallo: Chatwoot
despacha asincrónicamente y el rechazo de Meta llega por el webhook de
`statuses` varios minutos después, cuando ya no hay nada que salvar.
"""
import logging
import time

import httpx

from .config import secretos

log = logging.getLogger("chatsuite-bot")

# 23 h, no 24: el reloj que cuenta es el de Meta y quedar en el borde es perder
# el mensaje.
VENTANA_SEG = 23 * 3600

GRAPH = "https://graph.facebook.com/v24.0"


def ultimo_entrante(historial: list[dict]) -> float | None:
    """Epoch del último mensaje del cliente. En la API REST `message_type` 0 es
    entrante; las notas privadas no cuentan, no las manda el cliente."""
    tiempos = [
        m.get("created_at")
        for m in (historial or [])
        if m.get("message_type") == 0 and not m.get("private") and m.get("created_at")
    ]
    return max(tiempos) if tiempos else None


def ventana_abierta(historial: list[dict]) -> bool:
    t = ultimo_entrante(historial)
    return bool(t) and (time.time() - float(t)) < VENTANA_SEG


def horas_desde_ultimo(historial: list[dict]) -> float | None:
    t = ultimo_entrante(historial)
    return None if not t else (time.time() - float(t)) / 3600


def _plano(s: str, tope: int) -> str:
    """Los parámetros de plantilla NO admiten saltos de línea ni tabulaciones:
    Meta responde 132000 y no manda nada."""
    s = " ".join((s or "").split())
    return s[: tope - 1] + "…" if len(s) > tope else s


async def enviar(destino: str, nombre: str, idioma: str, params: list[str] | None = None) -> bool:
    """Manda una plantilla por Graph. True si Meta la aceptó.

    Que la acepte no garantiza entrega: devuelve `wamid` y 200 incluso cuando
    después falla; el veredicto real llega por el webhook de `statuses`.

    `destino` tiene que ser un teléfono real. A una identidad sin número (los
    `CO.…` del webhook v26, o un LID de Evolution) no hay forma de escribirle
    fuera de ventana: la plantilla no puede citar ningún mensaje, que es lo
    único que hace que Meta resuelva esas identidades.
    """
    if not (secretos.meta_token and secretos.meta_phone_id):
        log.warning("plantilla %s no enviada: faltan credenciales de Meta", nombre)
        return False

    cuerpo: dict = {
        "messaging_product": "whatsapp",
        "to": destino,
        "type": "template",
        "template": {"name": nombre, "language": {"code": idioma}},
    }
    if params:
        cuerpo["template"]["components"] = [{
            "type": "body",
            "parameters": [{"type": "text", "text": _plano(p, 700)} for p in params],
        }]

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0)) as c:
            r = await c.post(
                f"{GRAPH}/{secretos.meta_phone_id}/messages",
                headers={"Authorization": f"Bearer {secretos.meta_token}"},
                json=cuerpo,
            )
        if r.status_code >= 400:
            log.error("plantilla %s rechazada para %s: %s", nombre, destino, r.text[:300])
            return False
        return True
    except Exception:
        log.exception("no se pudo mandar la plantilla %s a %s", nombre, destino)
        return False


async def salud_numero() -> dict | None:
    """Estado del número en Cloud API. Es la protección equivalente al freno
    por acuses de Evolution: acá no vemos pasar los acuses, pero Meta publica
    la calificación de calidad."""
    if not (secretos.meta_token and secretos.meta_phone_id):
        return None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as c:
            r = await c.get(
                f"{GRAPH}/{secretos.meta_phone_id}",
                headers={"Authorization": f"Bearer {secretos.meta_token}"},
                params={"fields": "verified_name,quality_rating,throughput"},
            )
            return r.json() if r.status_code < 400 else None
    except Exception:
        return None
