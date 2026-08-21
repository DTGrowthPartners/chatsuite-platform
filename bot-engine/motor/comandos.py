"""Órdenes de operación que el equipo le manda al bot por WhatsApp.

El motor pone solo el cable. Qué comandos existen y qué hacen depende del
negocio —en Island Vibes, marcar un palco como vendido y tacharlo en el plano—,
así que la lógica vive en `comandos.py` DENTRO del perfil del cliente. Un bot
cuyo perfil no traiga ese archivo simplemente no tiene comandos, y esto es un
no-op.

Contrato del archivo del perfil:

    def manejar(texto: str, autor: str) -> str | dict | None

`autor` es el teléfono de quien escribió, ya verificado contra `equipo.json`.
Devolver `None` significa «esto no era un comando»: el bot sigue su curso normal
(con `audiencia: clientes`, ignorar a esa persona). Devolver texto significa
«lo atendí», y ese texto se le manda de vuelta.

Si la orden cambió algo que se ve —un plano, un catálogo en imagen— el hook
puede devolver `{"texto": ..., "imagen": <ruta>}` y el bot manda la imagen con
ese texto de pie, en un solo mensaje. La ruta tiene que existir; si no, se manda
el texto solo y queda el aviso en el log.

Que el hook decida es deliberado: quien manda la orden es del equipo y sabe lo
que hace, pero un mensaje suelto suyo NO debe disparar nada. Reconocer la orden
—y no adivinarla— es responsabilidad del archivo del perfil.
"""
import importlib.util
import logging
from pathlib import Path

from .config import RAIZ_PERFIL

log = logging.getLogger("chatsuite-bot")

_modulo = None
_mtime = None


def _cargar():
    """Carga (o recarga) el hook del perfil. Se recarga solo si el archivo
    cambió, igual que el perfil: tocar comandos.py no debe obligar a reiniciar
    el bot en medio de la operación."""
    global _modulo, _mtime
    ruta = RAIZ_PERFIL / "comandos.py"
    try:
        mtime = ruta.stat().st_mtime
    except OSError:
        _modulo, _mtime = None, None
        return None
    if _modulo is not None and _mtime == mtime:
        return _modulo
    try:
        spec = importlib.util.spec_from_file_location("perfil_comandos", ruta)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
    except Exception:
        log.exception("no se pudo cargar %s; el bot queda sin comandos", ruta)
        _modulo, _mtime = None, None
        return None
    _modulo, _mtime = mod, mtime
    log.info("comandos del equipo cargados desde %s", ruta)
    return mod


def hay() -> bool:
    return _cargar() is not None


def ejecutar(texto: str, autor: str):
    """Devuelve la respuesta al comando, o None si no era un comando."""
    mod = _cargar()
    if not mod or not hasattr(mod, "manejar"):
        return None
    try:
        return mod.manejar(texto or "", autor or "")
    except Exception:
        log.exception("falló el comando %r de %s", texto, autor)
        return "No pude ejecutar eso, quedó el error en el log. Revisalo a mano."


def desglosar(respuesta):
    """(texto, imagen) a partir de lo que devolvió el hook.

    La imagen solo sale si el archivo existe de verdad: una ruta rota mandaría
    la orden al vacío, y es preferible que llegue el texto solo."""
    if isinstance(respuesta, dict):
        texto = (respuesta.get("texto") or "").strip()
        ruta = respuesta.get("imagen")
        if ruta:
            ruta = Path(ruta)
            if ruta.is_file():
                return texto, ruta
            log.warning("el comando pidió mandar %s pero no existe; va el texto solo", ruta)
        return texto, None
    return (respuesta or "").strip(), None
