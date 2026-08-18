"""Módulo `citas`: agendar, consultar y cancelar.

Sirve para clínicas, salones, consultorios, talleres — cualquiera que trabaje
con turnos. Los servicios, el horario y los profesionales salen del perfil, así
que el módulo no sabe si vende cortes de cabello o consultas médicas.

`citas.agenda` decide de dónde sale la disponibilidad:
  propia    → agenda.py (por defecto; el mismo patrón que el catálogo)
  calcom    → pendiente
  agendapro → pendiente

⚠️ El modelo NUNCA calcula horarios: se le entregan turnos concretos y elige de
esa lista. Pedirle que calcule disponibilidad produce horas que no existen.
"""
import logging
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from motor import alertas, chatwoot, eventos, perfil as perfil_mod

from . import agenda
from .base import Contexto, Modulo as Base, Resultado

log = logging.getLogger("chatsuite-bot")


def _precio(valor, p) -> str:
    try:
        n = int(valor)
    except Exception:
        return ""
    if n == 0:
        return "gratis"
    return "${:,}".format(n).replace(",", ".") if p.moneda == "COP" else "{:,}".format(n)


class Modulo(Base):
    nombre = "citas"

    def _cfg(self, p) -> dict:
        return p.modulo("citas")

    def etiquetas(self) -> set[str]:
        return {"cita", "cancelacion", "seguimiento"}

    def atributos(self, p) -> list[dict]:
        return [
            {"clave": "cita_id", "titulo": "Cita", "tipo": "text", "modelo": "conversacion"},
            {"clave": "cita_fecha", "titulo": "Fecha y hora", "tipo": "date", "modelo": "conversacion"},
            {"clave": "cita_servicio", "titulo": "Servicio", "tipo": "text", "modelo": "conversacion"},
            {"clave": "cita_profesional", "titulo": "Atiende", "tipo": "text", "modelo": "conversacion"},
            {"clave": "cita_estado", "titulo": "Estado de la cita", "tipo": "list",
             "modelo": "conversacion",
             "valores": ["agendada", "confirmada", "cancelada", "cumplida", "no asistió"]},
        ]

    # ── Tools ──────────────────────────────────────────────────────────────
    def tools(self, p) -> list[dict]:
        servicios = agenda.servicios(p)
        if not servicios:
            # Sin servicios cargados el módulo no puede hacer nada útil, y darle
            # las tools al modelo solo lo haría prometer citas que no puede tomar.
            return []
        nombres = ", ".join(s["nombre"] for s in servicios)
        profesionales = agenda.profesionales(p)

        propiedades_agendar = {
            "inicio": {
                "type": "string",
                "description": ("El horario EXACTO que devolvió consultar_disponibilidad, "
                                "copiado tal cual (formato ISO). No lo inventes ni lo modifiques."),
            },
            "servicio": {"type": "string", "description": f"Uno de: {nombres}"},
            "nombre": {"type": "string", "description": "Nombre de quien va a asistir"},
            "nota": {"type": "string", "description": "Algo que el equipo deba saber (opcional)"},
        }
        propiedades_consulta = {
            "servicio": {"type": "string", "description": f"Uno de: {nombres}"},
            "preferencia": {
                "type": "string",
                "description": ("Cuándo lo quiere, si lo dijo: una fecha YYYY-MM-DD, o "
                                "'hoy' / 'mañana'. Vacío = lo más pronto posible."),
            },
        }
        if profesionales:
            texto_prof = f"Con quién: {', '.join(profesionales)}. Vacío = cualquiera."
            propiedades_agendar["profesional"] = {"type": "string", "description": texto_prof}
            propiedades_consulta["profesional"] = {"type": "string", "description": texto_prof}

        return [
            {
                "name": "consultar_disponibilidad",
                "description": (
                    "Devuelve los horarios REALES que están libres. Úsala SIEMPRE antes de "
                    "ofrecer una hora: nunca supongas ni calcules la disponibilidad tú, "
                    "porque el horario y las citas ya tomadas cambian. Ofrécele al cliente "
                    "dos o tres opciones de las que devuelva, no la lista entera."
                ),
                "input_schema": {"type": "object", "properties": propiedades_consulta,
                                 "required": ["servicio"]},
            },
            {
                "name": "agendar_cita",
                "description": (
                    "Reserva el turno. Úsala solo cuando el cliente YA eligió uno de los "
                    "horarios que le mostraste y te dio su nombre. El `inicio` tiene que ser "
                    "exactamente uno de los que devolvió consultar_disponibilidad."
                ),
                "input_schema": {"type": "object", "properties": propiedades_agendar,
                                 "required": ["inicio", "servicio", "nombre"]},
            },
            {
                "name": "consultar_mi_cita",
                "description": (
                    "Busca las citas que este cliente ya tiene agendadas. Úsala cuando "
                    "pregunte por su cita, quiera cambiarla o cancelarla."
                ),
                "input_schema": {"type": "object", "properties": {}},
            },
            {
                "name": "cancelar_cita",
                "description": (
                    "Cancela una cita ya agendada. Primero usa consultar_mi_cita para saber "
                    "cuál es, y confirma con el cliente antes de cancelar."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "cita_id": {"type": "string", "description": "El código que devolvió consultar_mi_cita"},
                        "motivo": {"type": "string", "description": "Por qué cancela, si lo dijo"},
                    },
                    "required": ["cita_id"],
                },
            },
        ]

    # ── Prompt ─────────────────────────────────────────────────────────────
    def bloques_prompt(self, p) -> list[str]:
        servicios = agenda.servicios(p)
        if not servicios:
            return []
        lineas = []
        for s in servicios:
            linea = f"- {s['nombre']}"
            if s.get("minutos"):
                linea += f" · dura {s['minutos']} min"
            if s.get("precio") is not None:
                linea += f" · {_precio(s['precio'], p)}"
            if s.get("nota"):
                linea += f" · {s['nota']}"
            lineas.append(linea)

        bloque = ["# Servicios y agenda", "", "Servicios disponibles:", "", *lineas, ""]
        profesionales = agenda.profesionales(p)
        if profesionales:
            bloque += [f"Atienden: {', '.join(profesionales)}.", ""]
        bloque += [
            "## Cómo agendas", "",
            "1. Averigua qué servicio quiere (una sola pregunta).",
            "2. Llama a consultar_disponibilidad y ofrécele DOS O TRES horarios de los que "
            "devuelva, con tus palabras. Nunca inventes ni calcules horas tú.",
            "3. Cuando elija uno, pídele el nombre de quien asiste.",
            "4. Llama a agendar_cita con el horario exacto que te dio la herramienta.",
            "5. Confírmale día y hora en palabras, no en formato de máquina.",
            "",
            "Si no hay horarios libres en lo que pidió, dilo y ofrécele lo más cercano que sí "
            "haya. Nunca prometas un horario sin haberlo reservado.",
        ]
        direccion = self._cfg(p).get("direccion")
        if direccion:
            bloque += ["", f"Dirección donde se atiende: {direccion}"]
        return ["\n".join(bloque)]

    # ── Handlers ───────────────────────────────────────────────────────────
    async def ejecutar(self, tool: str, entrada: dict, ctx: Contexto) -> Resultado | None:
        if tool == "consultar_disponibilidad":
            return await self._disponibilidad(entrada or {}, ctx)
        if tool == "agendar_cita":
            return await self._agendar(entrada or {}, ctx)
        if tool == "consultar_mi_cita":
            return await self._mis_citas(ctx)
        if tool == "cancelar_cita":
            return await self._cancelar(entrada or {}, ctx)
        return None

    def _resolver_servicio(self, p, nombre: str):
        s = agenda.servicio_por_nombre(p, nombre)
        if s:
            return s, None
        disponibles = ", ".join(x["nombre"] for x in agenda.servicios(p))
        return None, Resultado(
            texto=f"No existe el servicio «{nombre}». Los que hay son: {disponibles}. "
                  "Pregúntale al cliente cuál quiere.")

    async def _disponibilidad(self, datos: dict, ctx: Contexto) -> Resultado:
        p = ctx.perfil
        servicio, error = self._resolver_servicio(p, datos.get("servicio", ""))
        if error:
            return error

        desde = None
        pref = (datos.get("preferencia") or "").strip().lower()
        tz = ZoneInfo(p.tz)
        ahora = datetime.now(tz)
        if pref in ("mañana", "manana"):
            desde = (ahora + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        elif pref and pref != "hoy":
            try:
                desde = datetime.fromisoformat(pref).replace(tzinfo=tz)
            except Exception:
                desde = None  # el modelo mandó texto libre: se ignora y se busca desde ya

        libres = agenda.disponibilidad(
            p, servicio, desde=desde, profesional=(datos.get("profesional") or "").strip())
        if not libres:
            return Resultado(texto=(
                "No hay horarios libres para eso. Dile al cliente que no hay cupo en esas "
                "fechas y ofrécele buscar en otras, o usa avisar_al_equipo si insiste."))

        # Al modelo se le da el ISO (que debe copiar) y el texto (que debe decir).
        opciones = [f"{agenda.en_texto(p, h['inicio'])}  →  inicio={h['inicio']}" for h in libres[:8]]
        return Resultado(texto=(
            f"Horarios libres para {servicio['nombre']} ({servicio.get('minutos') or ''} min):\n"
            + "\n".join(opciones)
            + "\n\nOfrécele DOS O TRES al cliente con tus palabras (la parte legible, nunca el "
              "formato de máquina). Cuando elija, pasa el `inicio` tal cual a agendar_cita."))

    async def _agendar(self, datos: dict, ctx: Contexto) -> Resultado:
        p = ctx.perfil
        servicio, error = self._resolver_servicio(p, datos.get("servicio", ""))
        if error:
            return error

        if ctx.simulacion:
            cuando = agenda.en_texto(p, datos.get("inicio", ""))
            ctx.registrar(f"agendaría {servicio['nombre']} {cuando} para {datos.get('nombre')}")
            return Resultado(
                texto=f"Cita agendada (simulada) para {cuando}. Confírmasela al cliente.",
                etiquetas=["cita"])

        try:
            cita = agenda.reservar(
                p, servicio=servicio, inicio_iso=datos.get("inicio", ""),
                nombre=datos.get("nombre", ""), telefono=ctx.telefono, conv_id=ctx.conv_id,
                profesional=(datos.get("profesional") or "").strip(),
                nota=datos.get("nota", ""),
            )
        except ValueError as e:
            # Se le dice al modelo qué pasó para que reaccione, en vez de un
            # error genérico que lo haga prometer algo imposible.
            return Resultado(texto=(
                f"No se pudo agendar: {e}. Vuelve a llamar a consultar_disponibilidad y "
                "ofrécele al cliente los horarios que sí estén libres."))
        except Exception as e:
            log.exception("conv %s: fallo agendando", ctx.conv_id)
            return Resultado(texto=f"Error al agendar: {e}. Escala a un humano.")

        cuando = agenda.en_texto(p, cita["inicio"])
        eventos.registrar("cita", ctx.conv_id, id=cita["id"], servicio=cita["servicio"],
                          inicio=cita["inicio"])
        resumen = f"{cita['servicio']} · {cuando} · {cita['nombre']}"
        if cita["profesional"]:
            resumen += f" · con {cita['profesional']}"
        await alertas.enviar_alerta("cita", ctx.conv_id, ctx.telefono,
                                    f"Cita #{cita['id']}: {resumen}")
        return Resultado(
            texto=(f"Cita agendada con código {cita['id']} para {cuando}. Confírmasela al "
                   "cliente con esas palabras y dile que si necesita cambiarla, te escriba."),
            etiquetas=["cita"],
            atributos={
                "cita_id": cita["id"],
                "cita_fecha": cita["inicio"][:10],
                "cita_servicio": cita["servicio"],
                "cita_profesional": cita["profesional"] or None,
                "cita_estado": "agendada",
            },
        )

    async def _mis_citas(self, ctx: Contexto) -> Resultado:
        p = ctx.perfil
        if ctx.simulacion:
            ctx.registrar("buscaría las citas de este cliente")
            return Resultado(texto="(simulación) El cliente no tiene citas registradas.")
        proximas = agenda.proximas_de(ctx.telefono)
        if not proximas:
            return Resultado(texto=(
                "Este cliente no tiene citas próximas. Si dice que sí tiene, usa "
                "avisar_al_equipo: puede estar agendada a otro número."))
        lineas = [f"- {c['servicio']} {agenda.en_texto(p, c['inicio'])}"
                  + (f" con {c['profesional']}" if c["profesional"] else "")
                  + f" · código {c['id']}" for c in proximas]
        return Resultado(texto="Citas de este cliente:\n" + "\n".join(lineas))

    async def _cancelar(self, datos: dict, ctx: Contexto) -> Resultado:
        p = ctx.perfil
        cita_id = (datos.get("cita_id") or "").strip()
        if ctx.simulacion:
            ctx.registrar(f"cancelaría la cita {cita_id}")
            return Resultado(texto="Cita cancelada (simulada).", etiquetas=["cancelacion"])

        cita = agenda.cancelar(cita_id, datos.get("motivo", ""))
        if not cita:
            return Resultado(texto=(
                "No encontré esa cita activa. Usa consultar_mi_cita para ver cuáles tiene."))
        cuando = agenda.en_texto(p, cita["inicio"])
        eventos.registrar("cita_cancelada", ctx.conv_id, id=cita["id"])
        await alertas.enviar_alerta(
            "cita", ctx.conv_id, ctx.telefono,
            f"CANCELADA la cita #{cita['id']} ({cita['servicio']} {cuando})")
        return Resultado(
            texto=(f"Cita cancelada. Confírmaselo al cliente y ofrécele agendar otra si quiere."),
            etiquetas=["cancelacion"],
            atributos={"cita_estado": "cancelada"},
        )
