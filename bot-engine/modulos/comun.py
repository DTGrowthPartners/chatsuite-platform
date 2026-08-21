"""Módulo común: escalar a un humano, avisar al equipo y mandar las fotos fijas.

Siempre activo. Son las cosas que cualquier bot necesita hacer sin importar a
qué se dedique el negocio.

Las FOTOS FIJAS son las del negocio, no las de un producto: el flyer de un
evento, el mapa del local, la fachada, la lista de precios en imagen. Van acá y
no en `tienda` porque no cuelgan de nada que se venda —todo el mundo quiere ver
el sitio, compre lo que compre— y porque un bot de citas también las necesita.

    data/fotos.json   [{clave, archivo, titulo, cuando}]
    data/fotos/       los archivos referidos por `archivo`
"""
import json
import logging
import time
from pathlib import Path

from motor import alertas, chatwoot, eventos, perfil as perfil_mod
from motor.config import DATA

from .base import Contexto, Modulo as Base, Resultado

log = logging.getLogger("chatsuite-bot")

FOTOS = DATA / "fotos"
RUTA_FOTOS = DATA / "fotos.json"

# Una misma foto NO se manda dos veces en la misma conversación. El prompt ya lo
# pide, pero el modelo no puede verificarlo: en el historial un adjunto propio se
# ve como «[enviaste una imagen]», sin decir cuál. Y repetir la misma imagen al
# mismo contacto es justo el patrón que WhatsApp lee como spam.
_VENTANA_FOTO = 12 * 3600
_enviadas: dict[str, float] = {}


def _ya_enviada(conv_id: int, clave: str) -> bool:
    ahora = time.time()
    for k, t in [(k, t) for k, t in _enviadas.items() if ahora - t > _VENTANA_FOTO]:
        _enviadas.pop(k, None)
    return f"{conv_id}:{clave}" in _enviadas


def _definidas() -> list[dict]:
    try:
        datos = json.loads(RUTA_FOTOS.read_text(encoding="utf-8"))
    except Exception:
        return []
    return [f for f in datos if isinstance(f, dict) and f.get("clave")]


def _disponibles() -> list[dict]:
    """Solo las que TIENEN el archivo en disco.

    Una foto declarada sin archivo no se le ofrece al modelo: prometerla y no
    mandarla es peor que no tenerla, y en producción no lo ve nadie porque el
    envío falla mudo.
    """
    return [f for f in _definidas()
            if f.get("archivo") and (FOTOS / str(f["archivo"])).exists()]

# Un reclamo necesita otra atención que una duda que el bot no supo resolver,
# así que se separa por el motivo que dio el propio modelo.
_PISTAS_RECLAMO = (
    "reclam", "queja", "molest", "mal estado", "vencid", "roto", "dañad",
    "devoluc", "no lleg", "equivocad", "estafa", "cobr de m",
)


class Modulo(Base):
    nombre = "comun"

    def etiquetas(self) -> set[str]:
        return {"reclamo"}

    def bloques_prompt(self, p) -> list[str]:
        fotos = _disponibles()
        if not fotos:
            return []
        lineas = [
            f"- clave `{f['clave']}`: {f.get('titulo') or f['clave']}"
            + (f" — mándala {f['cuando']}" if f.get("cuando") else "")
            for f in fotos
        ]
        return ["# Fotos que puedes mandar\n\n"
                "Estas imágenes las envías con enviar_foto, UNA por llamada. No describas "
                "una foto que no mandaste, y no repitas en el mismo chat una que ya enviaste."
                "\n\n" + "\n".join(lineas)]

    def tools(self, p) -> list[dict]:
        tools = [
            {
                "name": "escalar_a_humano",
                "description": (
                    f"Pasa la conversación a una persona del equipo de {p.negocio}. Úsala "
                    "cuando el cliente pida hablar con alguien, esté molesto o inconforme, "
                    "quiera negociar condiciones fuera de tu alcance, pida algo que no puedes "
                    "hacer (confirmar un pago, despachar), o te falte información para "
                    "responder con seguridad."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "motivo": {"type": "string", "description": "Por qué se escala"}
                    },
                    "required": ["motivo"],
                },
            },
            {
                "name": "avisar_al_equipo",
                "description": (
                    f"Manda una pregunta al equipo de {p.negocio} SIN pasarle la conversación "
                    "a un humano: tú sigues atendiendo. Úsala cuando te falte un dato puntual "
                    "para responder, o cuando la situación sea rara y quieras que el equipo "
                    "esté enterado. Después de usarla dile al cliente, con tus palabras, que "
                    "confirmas el dato y le avisas."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "pregunta": {
                            "type": "string",
                            "description": "Qué necesitas que confirmen, con el contexto necesario",
                        }
                    },
                    "required": ["pregunta"],
                },
            },
        ]

        fotos = _disponibles()
        if fotos:
            claves = [f["clave"] for f in fotos]
            detalle = "; ".join(
                f"{f['clave']}: {f.get('titulo') or ''}"
                + (f" ({f['cuando']})" if f.get("cuando") else "")
                for f in fotos
            )
            tools.append({
                "name": "enviar_foto",
                "description": (
                    "Envía al cliente UNA de las fotos fijas del negocio. Disponibles → "
                    f"{detalle}. Una sola por llamada."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "clave": {"type": "string", "enum": claves,
                                  "description": "Cuál de las fotos mandar"}
                    },
                    "required": ["clave"],
                },
            })
        return tools

    async def ejecutar(self, tool: str, entrada: dict, ctx: Contexto) -> Resultado | None:
        if tool == "escalar_a_humano":
            motivo = (entrada or {}).get("motivo", "")
            etiquetas = ["reclamo"] if any(k in motivo.lower() for k in _PISTAS_RECLAMO) else []
            if ctx.simulacion:
                ctx.registrar(f"escalaría a un humano · motivo: {motivo}")
            else:
                # El motivo lo escribe el propio modelo: agrupados dicen por qué
                # se le escapan las conversaciones.
                eventos.registrar("escalada", ctx.conv_id, motivo=motivo[:300],
                                  reclamo=bool(etiquetas))
                await alertas.enviar_alerta("escalada", ctx.conv_id, ctx.telefono, f"Motivo: {motivo}")
            return Resultado(
                texto="Conversación pasada a la cola humana.",
                escalar=True, motivo=motivo, etiquetas=etiquetas,
            )

        if tool == "avisar_al_equipo":
            pregunta = ((entrada or {}).get("pregunta") or "").strip()
            if not pregunta:
                return Resultado(texto="Falta la pregunta.")
            if ctx.simulacion:
                ctx.registrar(f"avisaría al equipo: {pregunta}")
                salio = True
            else:
                # Acá SÍ se guarda el texto: cada una de estas es un dato que le
                # falta al bot, y agrupadas son la lista de qué arreglar en el
                # catálogo o en la tabla de domicilios.
                eventos.registrar("sin_dato", ctx.conv_id, pregunta=pregunta[:300])
                salio = await alertas.enviar_alerta("pregunta", ctx.conv_id, ctx.telefono, pregunta)
            # El texto importa: el modelo se lo repite al cliente tal cual. Si
            # promete un aviso que no salió, el cliente queda esperando.
            return Resultado(texto=(
                "Aviso enviado al equipo. Dile al cliente que confirmas y le avisas."
                if salio else
                "Ya se había avisado hace poco por lo mismo; no insistas, dile al cliente "
                "que estás confirmando."
            ))

        if tool == "enviar_foto":
            clave = str((entrada or {}).get("clave", "")).strip().lower()
            foto = next((f for f in _definidas() if str(f["clave"]).lower() == clave), None)
            if not foto:
                disponibles = ", ".join(f["clave"] for f in _disponibles()) or "ninguna"
                return Resultado(texto=(
                    f"No existe la foto «{clave}». Las que hay: {disponibles}. "
                    "Sigue con texto y no le prometas ninguna imagen al cliente."
                ))
            ruta = FOTOS / str(foto.get("archivo") or "")
            falta = not foto.get("archivo") or not ruta.exists()
            titulo = foto.get("titulo") or ""
            if ctx.simulacion:
                aviso = f"  ⚠️ FALTA el archivo {foto.get('archivo') or '(sin archivo)'}" if falta else ""
                ctx.registrar(f"enviaría la foto «{foto['clave']}»{aviso}")
                return Resultado(texto="Foto enviada al cliente.")
            if falta:
                eventos.registrar("foto_faltante", ctx.conv_id, clave=foto["clave"],
                                  archivo=str(foto.get("archivo") or ""))
                return Resultado(texto=(
                    "No se pudo enviar la foto: falta el archivo. NO le digas al cliente que "
                    "se la mandaste; sigue la conversación con texto."
                ))
            if _ya_enviada(ctx.conv_id, foto["clave"]):
                return Resultado(texto=(
                    f"La foto «{foto['clave']}» YA se la mandaste en este chat: no se volvió "
                    "a enviar. No la anuncies otra vez, sigue con texto."
                ))
            await chatwoot.enviar_imagen(ctx.conv_id, ruta, titulo)
            _enviadas[f"{ctx.conv_id}:{foto['clave']}"] = time.time()
            return Resultado(texto="Foto enviada al cliente.")

        return None
