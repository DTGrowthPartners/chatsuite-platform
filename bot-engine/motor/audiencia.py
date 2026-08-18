"""A quién atiende el bot y a quién avisa.

No todos los bots atienden clientes. En un bot de ventas el equipo está
FILTRADO (si un asesor escribe, el bot no lo trata como cliente); en uno
administrativo interno la regla es la inversa. Eso es `perfil.audiencia`.

El padrón del equipo vive en data/equipo.json y se lee en cada consulta a
propósito: sumar a alguien al equipo alcanza para que empiece a recibir avisos,
sin reiniciar el bot.
"""
import json
import logging

from . import estado, perfil as perfil_mod
from .config import DATA, secretos

log = logging.getLogger("chatsuite-bot")

RUTA_EQUIPO = DATA / "equipo.json"


def _equipo() -> list[dict]:
    try:
        return json.loads(RUTA_EQUIPO.read_text(encoding="utf-8"))
    except Exception:
        return []


def es_equipo(telefono: str) -> bool:
    tel = estado.normalizar(telefono)
    if not tel:
        return False
    return any(estado.normalizar(m.get("telefono", "")) == tel for m in _equipo())


def atiende(telefono: str) -> tuple[bool, str]:
    """¿El bot debe responderle a quien escribió? Devuelve (sí/no, motivo)."""
    aud = perfil_mod.actual().audiencia
    interno = es_equipo(telefono)
    if aud == "ambos":
        return True, ""
    if aud == "equipo":
        return (True, "") if interno else (False, "el bot es interno y este número no es del equipo")
    # audiencia == clientes (el caso normal)
    return (False, "es del equipo; el bot no lo atiende como cliente") if interno else (True, "")


def telefonos_equipo() -> list[str]:
    """Números reales del equipo, para los avisos.

    ⚠️ Filtra las entradas LID. En equipo.json cada persona suele figurar DOS
    veces —su teléfono y su identidad anónima de 14-15 dígitos— y un LID NO es
    un número: mandarle una plantilla falla. Se exige forma de teléfono real
    (10 a 13 dígitos) y se descarta el número del propio bot, que si no se
    avisaría a sí mismo.
    """
    p = perfil_mod.actual()
    numeros: list[str] = []
    if p.get("alertas.usar_equipo", True):
        for m in _equipo():
            if "lid" in (m.get("nombre") or "").lower():
                continue
            tel = estado.normalizar(m.get("telefono") or "")
            if 10 <= len(tel) <= 13:
                numeros.append(tel)
    numeros += [estado.normalizar(n) for n in p.get("alertas.numeros_extra", [])]

    propio = estado.normalizar(secretos.bot_numero)
    vistos, salida = set(), []
    for n in numeros:
        if n and n != propio and n not in vistos:
            vistos.add(n)
            salida.append(n)
    return salida
