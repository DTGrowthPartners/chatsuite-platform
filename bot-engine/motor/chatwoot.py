"""Cliente de la API de Chatwoot (Chatsuite). Todo el tráfico sale por acá.

El bot NUNCA le habla al canal directamente: le habla a Chatsuite y Chatsuite
despacha por el inbox, sea Evolution o Cloud API. Es lo que hace que cambiar de
canal sea configuración y no un proyecto. Las dos únicas excepciones son las
plantillas y los avisos al equipo, que van a Graph (ver plantillas.py).
"""
import logging
from pathlib import Path

import httpx

from . import perfil as perfil_mod
from .config import secretos

log = logging.getLogger("chatsuite-bot")

_TIMEOUT = httpx.Timeout(30.0)


def _base() -> str:
    return f"{secretos.chatwoot_url}/api/v1/accounts/{secretos.account_id}"


def _headers() -> dict:
    return {"api_access_token": secretos.bot_token}


def _headers_lectura() -> dict:
    # El token del Agent Bot puede mandar mensajes pero Chatwoot le niega el GET
    # de mensajes y el POST de labels (401 en los dos, sin ruido en la respuesta
    # al cliente). Para eso hace falta el token de un usuario agente.
    return {"api_access_token": secretos.read_token or secretos.bot_token}


async def historial(conv_id: int) -> list[dict]:
    """Últimos mensajes — Chatsuite es la memoria del bot.

    Chatwoot pagina de a ~20 y una tanda de fotos del catálogo puede llenar la
    página entera dejando por fuera los textos del cliente, así que se pagina
    hacia atrás hasta encontrar algún mensaje entrante (con tope)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get(f"{_base()}/conversations/{conv_id}/messages", headers=_headers_lectura())
        r.raise_for_status()
        todo = r.json().get("payload", [])
        paginas = 0
        while (
            todo
            and paginas < 5
            and not any(m.get("message_type") == 0 and not m.get("private") for m in todo)
        ):
            r2 = await c.get(
                f"{_base()}/conversations/{conv_id}/messages",
                headers=_headers_lectura(),
                params={"before": todo[0]["id"]},
            )
            if r2.status_code >= 400:
                break
            anterior = r2.json().get("payload", [])
            if not anterior:
                break
            todo = anterior + todo
            paginas += 1
        return todo


async def enviar(conv_id: int, texto: str) -> None:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.post(
            f"{_base()}/conversations/{conv_id}/messages",
            headers=_headers(),
            json={"content": texto, "message_type": "outgoing"},
        )
        r.raise_for_status()


async def nota_privada(conv_id: int, texto: str) -> None:
    """Aviso para el equipo dentro de la conversación: lo ve el agente, nunca
    el cliente.

    Todo lo operativo va por acá. Mandar errores o checklists como `outgoing`
    es lo que hace que WhatsApp sancione el número — ya nos costó un baneo."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.post(
            f"{_base()}/conversations/{conv_id}/messages",
            headers=_headers(),
            json={"content": texto, "message_type": "outgoing", "private": True},
        )
        r.raise_for_status()


async def _adjuntar(conv_id: int, ruta: Path, caption: str, mime: str, timeout: float) -> None:
    datos = {"message_type": "outgoing"}
    if caption:
        datos["content"] = caption
    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as c:
        r = await c.post(
            f"{_base()}/conversations/{conv_id}/messages",
            headers=_headers(),
            data=datos,
            files=[("attachments[]", (ruta.name, ruta.read_bytes(), mime))],
        )
        r.raise_for_status()


async def enviar_imagen(conv_id: int, ruta: Path, caption: str = "") -> None:
    await _adjuntar(conv_id, ruta, caption, "image/jpeg", 60.0)


async def enviar_documento(conv_id: int, ruta: Path, caption: str = "") -> None:
    """Un PDF va en UN mensaje de documento, en vez de una tanda de fotos."""
    await _adjuntar(conv_id, ruta, caption, "application/pdf", 120.0)


async def _conversaciones_de(telefono: str) -> list[dict]:
    tel = telefono.lstrip("+")
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get(f"{_base()}/contacts/search", headers=_headers_lectura(), params={"q": tel})
        r.raise_for_status()
        contactos = r.json().get("payload", [])
        if not contactos:
            return []
        r = await c.get(
            f"{_base()}/contacts/{contactos[0]['id']}/conversations", headers=_headers_lectura()
        )
        r.raise_for_status()
        return r.json().get("payload", [])


async def conversacion_por_telefono(telefono: str) -> int | None:
    convs = await _conversaciones_de(telefono)
    if not convs:
        return None
    ultima = max(convs, key=lambda x: x.get("last_activity_at") or 0)
    return ultima.get("display_id") or ultima.get("id")


async def conversaciones_ids(telefono: str) -> list[int]:
    return [c.get("display_id") or c.get("id") for c in await _conversaciones_de(telefono)]


async def conversaciones_pendientes() -> list[dict]:
    """La cola del bot: `pending` es lo único que atiende."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get(
            f"{_base()}/conversations",
            headers=_headers_lectura(),
            params={"status": "pending", "sort_by": "last_activity_at_desc"},
        )
        r.raise_for_status()
        return (r.json().get("data") or {}).get("payload", [])


async def a_pendiente(conv_id: int) -> None:
    """Devuelve la conversación a la cola del bot. Con el token de lectura: el
    del Agent Bot no puede ponerla en pending."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.post(
            f"{_base()}/conversations/{conv_id}/toggle_status",
            headers=_headers_lectura(),
            json={"status": "pending"},
        )
        r.raise_for_status()


async def a_humano(conv_id: int) -> None:
    """Handoff nativo: `pending` → `open` (cola humana)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.post(
            f"{_base()}/conversations/{conv_id}/toggle_status",
            headers=_headers(),
            json={"status": "open"},
        )
        r.raise_for_status()


async def etiquetar(conv_id: int, etiquetas: list[str]) -> None:
    """Agrega etiquetas SIN pisar las que ya tenga.

    Dos trampas de esta API, las dos silenciosas:
    1. `POST /labels` REEMPLAZA la lista entera, no agrega: mandar ['pedido'] a
       una conversación etiquetada 'reclamo' le borra 'reclamo'. Por eso se lee
       lo actual y se manda la unión.
    2. Chatwoot CREA al vuelo cualquier etiqueta que reciba, así que se filtra
       contra el catálogo cerrado del perfil.
    """
    validas = perfil_mod.actual().etiquetas_validas
    nuevas = {e.strip().lower() for e in etiquetas if e} & validas
    if not nuevas:
        return
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        try:
            r = await c.get(f"{_base()}/conversations/{conv_id}/labels", headers=_headers_lectura())
            actuales = set(r.json().get("payload", [])) if r.status_code < 400 else set()
        except Exception:
            actuales = set()
        if nuevas <= actuales:
            return
        r = await c.post(
            f"{_base()}/conversations/{conv_id}/labels",
            headers=_headers_lectura(),
            json={"labels": sorted(actuales | nuevas)},
        )
        r.raise_for_status()


# ── Atributos: los datos del caso, al lado del chat ─────────────────────────
# Chatwoot los muestra en la barra lateral y —lo importante— se pueden filtrar,
# así que "pedidos de hoy sin despachar" deja de ser imposible. Es lo que hace
# que no haga falta ningún panel aparte.

async def atributos_conversacion(conv_id: int, valores: dict) -> bool:
    """Escribe atributos en la conversación. True si de verdad cambió algo.

    ⚠️ EL BUCLE: `custom_attributes` está en el `list_of_keys` de Conversation,
    así que escribir re-dispara `conversation_updated` → las automatizaciones
    del cliente → posiblemente nosotros otra vez. El corte es leer primero y
    escribir SOLO si algún valor cambió de verdad. Es exactamente el guard que
    hubo que poner en el puente CAPI de CompuXtreme, donde comparar un campo con
    la hora actual hacía que nunca cortara.

    Los valores None se ignoran (no se pisa un dato bueno con vacío).
    """
    limpios = {k: v for k, v in (valores or {}).items() if v not in (None, "")}
    if not limpios:
        return False
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        try:
            r = await c.get(f"{_base()}/conversations/{conv_id}", headers=_headers_lectura())
            actuales = (r.json() or {}).get("custom_attributes") or {} if r.status_code < 400 else {}
        except Exception:
            actuales = {}
        if all(str(actuales.get(k)) == str(v) for k, v in limpios.items()):
            return False  # nada nuevo: no se escribe y no se dispara el evento
        r = await c.post(
            f"{_base()}/conversations/{conv_id}/custom_attributes",
            headers=_headers_lectura(),
            json={"custom_attributes": {**actuales, **limpios}},
        )
        r.raise_for_status()
        return True


async def atributos_contacto(conv_id: int, valores: dict) -> bool:
    """Atributos de la PERSONA, no de la conversación: su plan, su vencimiento.

    Aparecen en todas sus conversaciones, que es lo que se quiere para un socio
    de gimnasio: el entrenador abre cualquier chat suyo y ve si está al día.
    """
    limpios = {k: v for k, v in (valores or {}).items() if v not in (None, "")}
    if not limpios:
        return False
    async with httpx.AsyncClient(timeout=_TIMEOUT) as c:
        r = await c.get(f"{_base()}/conversations/{conv_id}", headers=_headers_lectura())
        if r.status_code >= 400:
            return False
        contacto = ((r.json() or {}).get("meta") or {}).get("sender") or {}
        cid = contacto.get("id")
        if not cid:
            return False
        actuales = contacto.get("custom_attributes") or {}
        if all(str(actuales.get(k)) == str(v) for k, v in limpios.items()):
            return False
        r = await c.put(
            f"{_base()}/contacts/{cid}",
            headers=_headers_lectura(),
            json={"custom_attributes": {**actuales, **limpios}},
        )
        r.raise_for_status()
        return True
