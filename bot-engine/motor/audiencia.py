"""A quién atiende el bot, a quién avisa y a quién le pasa el chat.

No todos los bots atienden clientes. En un bot de ventas el equipo está
FILTRADO (si un asesor escribe, el bot no lo trata como cliente); en uno
administrativo interno la regla es la inversa. Eso es `perfil.audiencia`.

El padrón del equipo vive en data/equipo.json y se lee en cada consulta a
propósito: sumar a alguien al equipo alcanza para que empiece a recibir avisos,
sin reiniciar el bot.

Cada fila puede traer, además del nombre y el teléfono:

  agente_id  su usuario en Chatsuite. Es lo que permite ASIGNARLE el chat al
             escalar; sin él la conversación cae en la cola general y con
             varios asesores eso significa que no la mira nadie.
  nivel      orden de la cascada: 1 atiende primero, los de arriba son el
             respaldo.
  temas      de qué se ocupa. Vacío = de todo, que es lo correcto en un equipo
             chico: filtrar con dos asesores solo consigue que algunas
             conversaciones no le toquen a nadie.
  avisos     todo | escalada | ninguno. Con cinco asesores, `todo` para todos
             es la forma más rápida de que nadie vuelva a mirar los avisos.

Las filas viejas no traen nada de esto y siguen funcionando igual: sin
`agente_id` no se asigna, y sin `avisos` se asume `todo`, que es como se
comportaba antes.
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


def telefonos_equipo(tipo: str = "") -> list[str]:
    """Números reales del equipo, para los avisos.

    `tipo` es el de la alerta (ver alertas.ETIQUETAS). Se usa para respetar la
    preferencia de cada uno: quien está en `escalada` no recibe cada dato que
    el bot no supo, solo los chats que pidieron un humano.

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
            if not quiere_aviso(m, tipo):
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


# --- quién recibe qué --------------------------------------------------------

# Lo que de verdad interrumpe: un cliente esperando a una persona, o el bot
# caído. El resto —una pregunta de precio, un pedido registrado— queda en la
# nota privada de la conversación, que es donde se mira sin que suene el
# teléfono.
URGENTES = {"escalada", "fallo_ia", "rate_limit", "sin_acuses", "reconexion"}


def quiere_aviso(miembro: dict, tipo: str) -> bool:
    """¿Este aviso es para esta persona?

    Sin `avisos` en la ficha se responde que sí a todo, que es como se portaba
    el bot antes de que las fichas tuvieran preferencia: una ficha vieja no
    puede quedarse sin enterarse de nada.
    """
    preferencia = (miembro.get("avisos") or "todo").lower()
    if preferencia == "ninguno":
        return False
    if preferencia == "escalada":
        return not tipo or tipo in URGENTES
    return True


def asesores() -> list[dict]:
    """El equipo que puede recibir conversaciones: los que tienen usuario."""
    return [m for m in _equipo() if m.get("agente_id")]


def banca(tema: str = "") -> list[dict]:
    """Quiénes pueden recibir un chat escalado, ya filtrados.

    Se filtra por NIVEL (el 1 atiende, los de arriba son el respaldo) y, dentro
    del nivel, por especialidad. Devuelve una LISTA y no una persona a
    propósito: entre los que quedan hay que elegir por carga, y eso exige
    preguntarle a Chatsuite cuántas conversaciones abiertas tiene cada uno.
    Esa parte vive en `chatwoot.asignar_al_menos_cargado`, que es quien puede
    hacer la llamada de red.

    Lista vacía = nadie tiene usuario en Chatsuite. Entonces la conversación
    cae en la cola general, que es lo que pasaba antes de que hubiera asesores.
    """
    candidatos = asesores()
    if not candidatos:
        return []

    def nivel(m):
        try:
            return int(m.get("nivel") or 1)
        except (TypeError, ValueError):
            return 1

    piso = min(nivel(m) for m in candidatos)
    elegidos = [m for m in candidatos if nivel(m) == piso]

    if tema:
        # Un asesor sin temas se ocupa de todo, así que siempre es candidato.
        # Los especialistas le ganan al generalista cuando el tema coincide.
        expertos = [m for m in elegidos
                    if tema.lower() in [str(t).lower() for t in (m.get("temas") or [])]]
        if expertos:
            elegidos = expertos

    return elegidos
