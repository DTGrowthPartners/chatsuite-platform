"""Mensajes de Chatsuite → formato de la API de Claude.

Chatsuite es la memoria del bot: no se guarda historial aparte. Acá se
convierten los mensajes a turnos alternados, se transcriben las notas de voz y
se adjuntan las imágenes del último mensaje del cliente.
"""
import logging

from . import media, perfil as perfil_mod

log = logging.getLogger("chatsuite-bot")

_ETIQUETAS_ADJUNTO = {
    "image": "una imagen",
    "audio": "un audio",
    "video": "un video",
    "file": "un archivo",
    "location": "una ubicación",
    "contact": "un contacto",
}


async def _texto_de(msg: dict, presupuesto_audio: list) -> str:
    """Contenido del mensaje más sus adjuntos. Las notas de voz entrantes se
    transcriben (con cache; máximo 3 nuevas por pasada para acotar latencia)."""
    partes = [(msg.get("content") or "").strip()]
    entrante = msg.get("message_type") == 0
    for adj in msg.get("attachments") or []:
        tipo = adj.get("file_type")
        if tipo == "audio" and entrante:
            texto_audio = None
            if presupuesto_audio[0] > 0:
                nuevo = not media.ya_transcrito(adj)
                texto_audio = await media.transcribir_audio(adj)
                if nuevo and texto_audio:
                    presupuesto_audio[0] -= 1
            partes.append(
                f'[nota de voz del cliente]: "{texto_audio}"' if texto_audio
                else "[el cliente envió un audio que no se pudo transcribir]"
            )
            continue
        etiqueta = _ETIQUETAS_ADJUNTO.get(tipo, "un adjunto")
        partes.append(f"[el cliente envió {etiqueta}]" if entrante else f"[enviaste {etiqueta}]")
    return "\n".join(p for p in partes if p)


async def armar(mensajes_cw: list[dict]) -> list[dict]:
    """Turnos alternados empezando por `user`.

    OJO: se recorta por TURNOS al final, nunca por mensajes. Una tanda de 24
    fotos del catálogo son 24 mensajes pero UN turno; recortar por mensajes
    expulsaba los textos del cliente de la ventana de contexto.
    """
    p = perfil_mod.actual()
    turnos: list[dict] = []
    presupuesto_audio = [3]
    imagenes_ultimo: list[dict] = []

    for m in mensajes_cw:
        if m.get("private") or m.get("message_type") not in (0, 1):
            continue
        texto = await _texto_de(m, presupuesto_audio)
        if not texto:
            continue
        if m["message_type"] == 0:
            imagenes_ultimo = [a for a in m.get("attachments") or []
                               if a.get("file_type") == "image"]
        rol = "user" if m["message_type"] == 0 else "assistant"
        if turnos and turnos[-1]["role"] == rol:
            turnos[-1]["content"] += "\n" + texto
        else:
            turnos.append({"role": rol, "content": texto})

    turnos = turnos[-int(p.get("modelo.max_historial", 30)):]
    while turnos and turnos[0]["role"] != "user":
        turnos.pop(0)

    if turnos and turnos[-1]["role"] == "user" and imagenes_ultimo:
        bloques = []
        for adj in imagenes_ultimo[:2]:
            b = await media.imagen_a_bloque(adj)
            if b:
                bloques.append(b)
        if bloques:
            turnos[-1] = {
                "role": "user",
                "content": bloques + [{"type": "text", "text": turnos[-1]["content"]}],
            }
    return turnos
