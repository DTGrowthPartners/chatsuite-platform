"""Media entrante: notas de voz e imágenes.

- Audios: se bajan de Chatsuite y se transcriben con el faster-whisper del VPS
  (venv aparte, modelo small en CPU). Cache por id de adjunto para no
  retranscribir el historial en cada turno.
- Imágenes: se convierten a bloque base64 para que Claude las vea (comprobantes
  de pago, fotos de un producto). Solo las del último mensaje.
"""
import asyncio
import base64
import json
import logging
import tempfile
from pathlib import Path

import httpx

from .config import DATA

log = logging.getLogger("chatsuite-bot")

CACHE_RUTA = DATA / "transcripciones.json"

WHISPER_PY = "/home/ubuntu/whisper-env/bin/python"
WHISPER_SCRIPT = "/home/ubuntu/whisper_transcribe.py"

_MAX_CACHE = 500
_MAX_IMG = 5 * 1024 * 1024

try:
    _cache: dict = json.loads(CACHE_RUTA.read_text(encoding="utf-8"))
except Exception:
    _cache = {}


def _guardar_cache() -> None:
    while len(_cache) > _MAX_CACHE:
        _cache.pop(next(iter(_cache)))
    tmp = CACHE_RUTA.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(_cache, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(CACHE_RUTA)


async def _descargar(url: str) -> bytes | None:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0), follow_redirects=True) as c:
            r = await c.get(url)
            r.raise_for_status()
            return r.content
    except Exception:
        log.warning("no se pudo descargar el adjunto: %s", (url or "")[:120])
        return None


def ya_transcrito(adj: dict) -> bool:
    return str(adj.get("id") or "") in _cache


async def transcribir_audio(adj: dict) -> str | None:
    aid = str(adj.get("id") or "")
    if not aid:
        return None
    if aid in _cache:
        return _cache[aid] or None
    datos = await _descargar(adj.get("data_url") or "")
    if not datos:
        return None

    with tempfile.NamedTemporaryFile(suffix=".oga", delete=False) as f:
        f.write(datos)
        ruta = f.name
    try:
        proc = await asyncio.create_subprocess_exec(
            WHISPER_PY, WHISPER_SCRIPT, ruta, "es",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        out, err = await asyncio.wait_for(proc.communicate(), timeout=120)
        texto = out.decode(errors="ignore").strip() if proc.returncode == 0 else ""
        if proc.returncode != 0:
            log.warning("whisper falló: %s", err.decode(errors="ignore")[-200:])
    except Exception:
        log.exception("error transcribiendo audio %s", aid)
        texto = ""
    finally:
        Path(ruta).unlink(missing_ok=True)

    _cache[aid] = texto
    _guardar_cache()
    return texto or None


def _tipo_imagen(datos: bytes) -> str | None:
    """Tipo real por los bytes mágicos: la extensión de la URL miente (WhatsApp
    reempaqueta y un .jpg puede traer un PNG adentro — la API lo rechaza)."""
    if datos[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if datos[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if datos[:4] == b"RIFF" and datos[8:12] == b"WEBP":
        return "image/webp"
    if datos[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


async def imagen_a_bloque(adj: dict) -> dict | None:
    datos = await _descargar(adj.get("data_url") or "")
    if not datos or len(datos) > _MAX_IMG:
        return None
    media = _tipo_imagen(datos)
    if not media:
        log.warning("imagen con formato desconocido; se omite del contexto")
        return None
    return {
        "type": "image",
        "source": {"type": "base64", "media_type": media, "data": base64.b64encode(datos).decode()},
    }
