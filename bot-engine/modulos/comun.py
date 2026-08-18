"""Módulo común: escalar a un humano y avisar al equipo.

Siempre activo. Son las dos cosas que cualquier bot necesita hacer sin importar
a qué se dedique el negocio.
"""
import logging

from motor import alertas, eventos, perfil as perfil_mod

from .base import Contexto, Modulo as Base, Resultado

log = logging.getLogger("chatsuite-bot")

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

    def tools(self, p) -> list[dict]:
        return [
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
        return None
