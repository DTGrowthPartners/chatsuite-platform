"""Registro de módulos.

`comun` está siempre activo: escalar y avisar al equipo los necesita cualquier
bot, venda computadores o agende citas.
"""
import logging

from . import comun, tienda
from .base import Contexto, Modulo, Resultado  # noqa: F401  (reexport)

log = logging.getLogger("chatsuite-bot")

DISPONIBLES: dict[str, Modulo] = {
    "comun": comun.Modulo(),
    "tienda": tienda.Modulo(),
}

SIEMPRE = ("comun",)


def activos(p) -> list[Modulo]:
    nombres = list(SIEMPRE) + [m for m in p.modulos if m not in SIEMPRE]
    salida = []
    for n in nombres:
        m = DISPONIBLES.get(n)
        if m is None:
            log.warning("el perfil pide el módulo «%s», que no existe; se omite", n)
            continue
        salida.append(m)
    return salida


def etiquetas_posibles(p) -> set[str]:
    fuera: set[str] = set()
    for m in activos(p):
        fuera |= m.etiquetas()
    return fuera
