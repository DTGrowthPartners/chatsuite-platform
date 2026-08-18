"""Composición del system prompt a partir del perfil y los módulos activos.

En tubodega-bot el prompt era un archivo de 7 KB escrito a mano, con los
bloques de catálogo y domicilios horneados en el código. Acá el prompt SE
COMPONE: la persona sale de campos estructurados (que el panel puede editar
como formulario) y cada módulo activo aporta su propio bloque.

Modo experto: si el perfil pone `persona.modo_experto: true` y existe
prompts/system.md, ese archivo reemplaza los bloques de persona generados. El
conocimiento del negocio y los bloques de los módulos se siguen agregando: son
datos, no estilo.
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from .config import DATA, PROMPTS

_DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
_MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
          "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

log = logging.getLogger("chatsuite-bot")


def _leer(ruta: Path, por_defecto=""):
    try:
        if ruta.suffix == ".json":
            return json.loads(ruta.read_text(encoding="utf-8"))
        return ruta.read_text(encoding="utf-8")
    except Exception:
        return por_defecto


def _persona(p) -> str:
    nombre = p.get("persona.nombre", "el asistente")
    rol = p.get("persona.rol", "asesor")
    ciudad = p.get("negocio.ciudad", "")
    lineas = [
        f"Eres {nombre}, {rol} de {p.negocio}"
        + (f", en {ciudad}." if ciudad else ".")
        + " Escribes como una persona real atendiendo por WhatsApp, nunca como un bot.",
        "",
        f"Si te preguntan tu nombre, te llamas {nombre} — pero no te presentes por tu "
        "nombre si no te lo preguntan. Si te preguntan directo si eres un bot, no mientas: "
        f"di que eres el asistente de {p.negocio} y que igual les ayudas en lo que necesiten.",
    ]

    contexto = p.get("persona.quien_te_escribe", "")
    if contexto:
        lineas += ["", "## QUIÉN TE ESCRIBE", "", contexto]

    estilo = ["## CÓMO HABLAS", ""]
    if p.get("persona.tuteo", True):
        estilo.append("- Español neutro. Tuteo (tú, tienes, quieres). NUNCA voseo ni regionalismos.")
    else:
        estilo.append("- Español neutro y usted. Trato formal pero cercano, nunca acartonado.")
    estilo += [
        "- Nunca frases de oficina: «Estimado cliente», «Quedo atento», «cordial saludo».",
        f"- Mensajes de {p.get('persona.max_lineas', 3)} líneas como máximo.",
        f"- Emojis: {p.get('persona.emojis', 'pocos')} (máximo 1-2 por mensaje).",
        "- Para mandar dos mensajes seguidos, separa las partes con una línea en blanco "
        "(se envían como mensajes independientes). Máximo dos.",
        # WhatsApp NO entiende Markdown: **así** se ve literal, con los asteriscos.
        "- Formato de WhatsApp, no Markdown: *negrita* con UN asterisco, _cursiva_ con "
        "guión bajo. NUNCA uses ** dobles ni ## títulos: al cliente le llegan tal cual.",
    ]
    formato_precio = p.get("persona.formato_precio", "")
    if formato_precio:
        estilo.append(f"- Precios así: {formato_precio}. Nunca con formato contable.")
    lineas += ["", *estilo]

    reglas = p.get("persona.reglas", [])
    if reglas:
        lineas += ["", "## REGLAS DE ORO", ""]
        lineas += [f"{i}. {r}" for i, r in enumerate(reglas, 1)]

    flujo = p.get("persona.flujo", "")
    if flujo:
        lineas += ["", "## FLUJO QUE SIGUES", "", flujo]

    nunca = p.get("persona.nunca", [])
    if nunca:
        lineas += ["", "## LO QUE NUNCA HACES", ""]
        lineas += [f"- {n}" for n in nunca]

    return "\n".join(lineas)


def _escalamiento(p) -> str:
    motivos = p.get("persona.cuando_escalar", [])
    if not motivos:
        return ""
    return "\n".join([
        "## CUÁNDO ESCALAR A UN HUMANO", "",
        "Usa la herramienta escalar_a_humano cuando:", "",
        *[f"- {m}" for m in motivos],
    ])


def fecha_hoy(p) -> str:
    """La fecha de hoy en la zona del cliente, en texto natural.

    Sin esto el modelo NO puede resolver «mañana a las 3» y se inventa la fecha:
    es obligatorio para agendar, y útil para todos («llega hoy mismo»).

    Va la FECHA, no la hora exacta, a propósito: el system prompt se manda con
    `cache_control`, y un timestamp al minuto invalidaría el caché en cada
    turno. Con la fecha, el caché sobrevive el día entero. La hora concreta la
    entrega la herramienta de disponibilidad, que devuelve horarios reales.
    """
    ahora = datetime.now(ZoneInfo(p.tz))
    return f"{_DIAS[ahora.weekday()]} {ahora.day} de {_MESES[ahora.month - 1]} de {ahora.year}"


def construir(p, modulos) -> str:
    """El system prompt completo para este perfil y estos módulos."""
    partes: list[str] = []

    if p.get("persona.modo_experto", False):
        crudo = _leer(PROMPTS / "system.md", "")
        partes.append(crudo if crudo else _persona(p))
    else:
        partes.append(_persona(p))

    esc = _escalamiento(p)
    if esc:
        partes.append(esc)

    negocio = _leer(DATA / "negocio.md", "")
    if negocio:
        partes.append(
            f"# Información de {p.negocio}\n\n"
            "Esta es la fuente de verdad del negocio. Si algo que te preguntan no está "
            "acá, no lo inventes.\n\n" + negocio
        )

    respuestas = _leer(DATA / "respuestas.json", [])
    if respuestas:
        datos = [r for r in respuestas if (r.get("uso") or "referencia") == "datos"]
        refer = [r for r in respuestas if (r.get("uso") or "referencia") != "datos"]
        bloque = ["# Respuestas rápidas oficiales", ""]
        if datos:
            bloque += [
                "Estas puedes enviarlas TAL CUAL, solas y sin párrafos tuyos alrededor, "
                "cuando toque pedir o dar esa información:", "",
                *[f"### {r['titulo']}\n{r['contenido']}" for r in datos], "",
            ]
        if refer:
            bloque += [
                "Estas son solo REFERENCIA de información: su contenido lo entregas "
                "siguiendo tu flujo, con tus palabras, nunca como bloque completo.", "",
                *[f"### {r['titulo']}\n{r['contenido']}" for r in refer],
            ]
        partes.append("\n".join(bloque))

    for m in modulos:
        for b in m.bloques_prompt(p):
            if b:
                partes.append(b)

    partes.append(
        f"# Fecha\n\nHoy es {fecha_hoy(p)}. Úsala para entender «hoy», «mañana», "
        "«el lunes» o «la otra semana». No supongas otra fecha."
    )
    return "\n\n".join(partes)
