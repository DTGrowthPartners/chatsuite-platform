"""Estado de runtime: pausas por chat y convalecencia.

OJO con lo que NO está acá: el interruptor de "el bot responde o no" ya no vive
en este archivo, vive en `perfil.estado`. En tubodega-bot era `{"global": true}`
con default True, y el modo observación de agosto se perdió solo en algún
reinicio sin que nadie lo notara durante semanas. Un interruptor que el proceso
puede pisar no es un interruptor.

Una pausa nunca se acorta sola: pausar por 1 hora un chat que estaba pausado
indefinidamente lo deja indefinido.
"""
import json
import re
import time
from pathlib import Path

from .config import DATA

RUTA = DATA / "estado-bot.json"

INDEFINIDA = -1.0

_estado = {"pausas": {}, "convalecencia_hasta": 0.0}


def _cargar() -> None:
    global _estado
    try:
        datos = json.loads(RUTA.read_text(encoding="utf-8"))
        _estado = {
            "pausas": dict(datos.get("pausas", {})),
            "convalecencia_hasta": float(datos.get("convalecencia_hasta", 0) or 0),
        }
    except Exception:
        pass


def _guardar() -> None:
    tmp = RUTA.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(_estado, indent=2), encoding="utf-8")
    tmp.replace(RUTA)


def normalizar(telefono: str) -> str:
    return re.sub(r"\D", "", telefono or "")


def _limpiar() -> None:
    ahora = time.time()
    vencidas = [t for t, fin in _estado["pausas"].items() if fin != INDEFINIDA and fin < ahora]
    for t in vencidas:
        _estado["pausas"].pop(t, None)
    if vencidas:
        _guardar()


def pausar(telefono: str, segundos: float | None) -> None:
    """segundos=None → pausa indefinida. Nunca acorta una pausa existente."""
    tel = normalizar(telefono)
    if not tel:
        return
    actual = _estado["pausas"].get(tel)
    nueva = INDEFINIDA if segundos is None else time.time() + segundos
    if actual == INDEFINIDA or (actual is not None and nueva != INDEFINIDA and actual >= nueva):
        return
    _estado["pausas"][tel] = nueva
    _guardar()


def reactivar(telefono: str) -> None:
    if _estado["pausas"].pop(normalizar(telefono), None) is not None:
        _guardar()


def pausada(telefono: str) -> bool:
    _limpiar()
    return normalizar(telefono) in _estado["pausas"]


def pausas_activas() -> dict:
    _limpiar()
    return dict(_estado["pausas"])


# ── Convalecencia: ritmo reducido tras una reconexión (post-sanción) ─────────
# La activa la vigilancia del canal al detectar caída → open. Mientras dura, se
# baja el tope por hora, se acortan las tandas de fotos y no hay reenganches.

def iniciar_convalecencia(horas: float = 48) -> None:
    _estado["convalecencia_hasta"] = time.time() + horas * 3600
    _guardar()


def convalecencia() -> bool:
    return time.time() < float(_estado.get("convalecencia_hasta", 0) or 0)


_cargar()
