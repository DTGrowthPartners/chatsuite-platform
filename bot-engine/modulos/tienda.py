"""Módulo `tienda`: cualquier negocio que venda algo.

Genérico a propósito. Salió del bot de Tu Bodega (ropa) pero no sabe nada de
ropa: los atributos de cada producto salen del propio catálogo, así que sirve
igual para computadores (procesador, RAM, garantía) que para camisetas (tallas,
colores). Lo que cambia entre un cliente y otro son los datos, no el código.

Qué trae:
- catálogo con fotos y envío de fotos por tanda
- catálogo completo en UN PDF (opcional)
- tarifas de domicilio por zona (opcional)
- registro de pedidos

Archivos que lee del perfil (todos opcionales salvo el catálogo):
    data/catalogo.json      [{id, nombre, precio, imagen, ...atributos libres}]
    data/catalogo-fotos/    las imágenes referidas por `imagen`
    data/domicilios.json    [{zona, precio}]
    data/pedidos.json       lo escribe el bot
"""
import asyncio
import json
import logging
import random
import secrets
import time
from pathlib import Path

from motor import alertas, chatwoot, estado, eventos, perfil as perfil_mod
from motor.config import DATA

from .base import Contexto, Modulo as Base, Resultado

log = logging.getLogger("chatsuite-bot")

FOTOS = DATA / "catalogo-fotos"
RUTA_CATALOGO = DATA / "catalogo.json"
RUTA_DOMICILIOS = DATA / "domicilios.json"
RUTA_PEDIDOS = DATA / "pedidos.json"

# Campos que el motor entiende; cualquier otra llave del producto se muestra
# tal cual, que es lo que hace al módulo servir para cualquier rubro.
_RESERVADOS = {"id", "nombre", "precio", "imagen"}


def _leer(ruta: Path, por_defecto):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:
        return por_defecto


def _precio(valor, p) -> str:
    """Precio legible. OJO con el cero: `precio: 0` significa GRATIS (un
    domicilio sin costo), no «falta el precio». Distinguirlo de `null` es la
    diferencia entre cobrar un envío gratis y no cobrar uno que sí vale."""
    try:
        n = int(valor)
    except Exception:
        return ""
    if n == 0:
        return "gratis"
    if p.moneda == "COP":
        return "${:,}".format(n).replace(",", ".")
    return "{:,}".format(n)


def _tiene_precio(item: dict) -> bool:
    return item.get("precio") is not None


def _atributos(prod: dict) -> str:
    extra = [f"{k}: {v}" for k, v in prod.items() if k not in _RESERVADOS and v]
    return " · ".join(extra)


def _registrar_pedido(**datos) -> dict:
    pedidos = _leer(RUTA_PEDIDOS, [])
    p = {
        "id": secrets.token_hex(3),
        "ts": time.time(),
        "estado": "nuevo",
        "notas": "",
        **datos,
    }
    pedidos.append(p)
    tmp = RUTA_PEDIDOS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(pedidos, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(RUTA_PEDIDOS)
    return p


class Modulo(Base):
    nombre = "tienda"

    # ── Configuración ──────────────────────────────────────────────────────
    def _cfg(self, p) -> dict:
        return p.modulo("tienda")

    def _domicilios_activos(self, p) -> bool:
        return bool(self._cfg(p).get("domicilios", {}).get("activo")) and bool(
            _leer(RUTA_DOMICILIOS, [])
        )

    def _pdf_activo(self, p) -> bool:
        return bool(self._cfg(p).get("pdf", {}).get("activo"))

    def etiquetas(self) -> set[str]:
        return {"pedido", "cotizacion", "domicilio", "seguimiento"}

    # ── Tools ──────────────────────────────────────────────────────────────
    def tools(self, p) -> list[dict]:
        cfg = self._cfg(p)
        propiedades = {
            "detalle": {"type": "string", "description": "Qué pidió: productos, cantidades y variantes"},
            "nombre": {"type": "string", "description": "Nombre de quien recibe"},
            "ciudad": {"type": "string", "description": "Ciudad de entrega"},
            "direccion": {"type": "string", "description": "Dirección de entrega"},
            "medio_pago": {"type": "string", "description": "Cómo paga"},
            "total": {"type": "integer", "description": "Total acordado; 0 si no está claro"},
        }
        if self._domicilios_activos(p):
            propiedades["zona"] = {
                "type": "string",
                "description": f"{cfg.get('domicilios', {}).get('etiqueta', 'Zona')} de entrega",
            }

        tools = [{
            "name": "registrar_pedido",
            "description": (
                "Registra el pedido cuando el cliente CONFIRMA la compra y ya te dio sus "
                "datos de entrega. El equipo lo ve en el panel y coordina el despacho. No lo "
                "uses para cotizaciones ni intenciones: solo pedidos confirmados. Después de "
                "registrarlo dile al cliente que su pedido quedó tomado y usa escalar_a_humano: "
                "la venta la cierra una persona del equipo, no tú."
            ),
            "input_schema": {"type": "object", "properties": propiedades, "required": ["detalle"]},
        }]

        if _leer(RUTA_CATALOGO, []):
            tope = int(cfg.get("catalogo", {}).get("fotos_por_tanda", 4))
            tools.append({
                "name": "enviar_fotos_catalogo",
                "description": (
                    "Envía al cliente las fotos de productos del catálogo. Úsala cuando pidan "
                    "ver mercancía, fotos, o pregunten por un producto concreto que esté en el "
                    f"catálogo. Máximo {tope} fotos por envío: elige las más relevantes a lo que "
                    "pidió el cliente, no mandes todo."
                ),
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "ids": {
                            "type": "array", "items": {"type": "string"},
                            "description": f"Los id de los productos a enviar (máx {tope})",
                        }
                    },
                    "required": ["ids"],
                },
            })

        if self._pdf_activo(p):
            tools.append({
                "name": "enviar_catalogo_pdf",
                "description": (
                    "Envía el catálogo COMPLETO como UN solo PDF. Úsala cuando el cliente pida "
                    "el catálogo entero, «todo lo que tienen», o quiera ver todas las opciones "
                    "de una vez. Para productos puntuales sigue usando enviar_fotos_catalogo."
                ),
                "input_schema": {"type": "object", "properties": {}},
            })
        return tools

    # ── Bloques de prompt ──────────────────────────────────────────────────
    def bloques_prompt(self, p) -> list[str]:
        bloques = []

        productos = _leer(RUTA_CATALOGO, [])
        if productos:
            lineas = []
            for prod in productos:
                precio = (
                    _precio(prod.get("precio"), p) if _tiene_precio(prod)
                    else "precio pendiente (confírmalo antes de afirmarlo)"
                )
                linea = f"- id {prod.get('id')}: {prod.get('nombre')} — {precio}"
                attrs = _atributos(prod)
                if attrs:
                    linea += f" · {attrs}"
                lineas.append(linea)
            bloques.append(
                "# Catálogo\n\n"
                "Estos son los productos disponibles. NO inventes productos que no estén en "
                "esta lista, ni precios donde diga pendiente."
                + (" Usa enviar_fotos_catalogo con los id cuando el cliente quiera ver."
                   if FOTOS.exists() else "")
                + "\n\n" + "\n".join(lineas)
            )

        if self._domicilios_activos(p):
            cfg = self._cfg(p).get("domicilios", {})
            etiqueta = cfg.get("etiqueta", "zona")
            zonas = _leer(RUTA_DOMICILIOS, [])
            lineas = [
                f"- {z.get('zona')}: "
                + (_precio(z.get("precio"), p) if _tiene_precio(z)
                   else "por confirmar (usa avisar_al_equipo)")
                for z in zonas
            ]
            bloques.append(
                f"# Tarifas de domicilio por {etiqueta}"
                + (f" ({cfg['ciudad']})" if cfg.get("ciudad") else "")
                + "\n\n"
                f"Cuando el cliente diga su {etiqueta}, cruza con esta tabla y cobra ese valor "
                f"exacto. Si su {etiqueta} no aparece, NO inventes la tarifa: usa "
                "avisar_al_equipo y dile que confirmas el valor y le avisas.\n\n"
                + "\n".join(lineas)
            )
        return bloques

    # ── Handlers ───────────────────────────────────────────────────────────
    async def ejecutar(self, tool: str, entrada: dict, ctx: Contexto) -> Resultado | None:
        if tool == "registrar_pedido":
            return await self._pedido(entrada or {}, ctx)
        if tool == "enviar_fotos_catalogo":
            return await self._fotos(entrada or {}, ctx)
        if tool == "enviar_catalogo_pdf":
            return await self._pdf(ctx)
        return None

    async def _pedido(self, datos: dict, ctx: Contexto) -> Resultado:
        p = ctx.perfil
        try:
            pedido = dict(
                telefono=ctx.telefono, conv_id=ctx.conv_id,
                detalle=str(datos.get("detalle", "")).strip(),
                nombre=str(datos.get("nombre", "")).strip(),
                ciudad=str(datos.get("ciudad", "")).strip(),
                zona=str(datos.get("zona", "")).strip(),
                direccion=str(datos.get("direccion", "")).strip(),
                medio_pago=str(datos.get("medio_pago", "")).strip(),
                total=int(datos.get("total") or 0),
            )
            resumen = pedido["detalle"]
            for campo, prefijo in (("nombre", "recibe "), ("zona", ""), ("ciudad", ""),
                                   ("medio_pago", "paga con ")):
                if pedido[campo]:
                    resumen += f" · {prefijo}{pedido[campo]}"

            if ctx.simulacion:
                ctx.registrar(f"registraría el pedido: {resumen}")
                codigo = "SIMULADO"
            else:
                guardado = _registrar_pedido(**pedido)
                codigo = guardado["id"]
                eventos.registrar("pedido", ctx.conv_id, id=codigo,
                                  total=pedido["total"], zona=pedido["zona"])
                await alertas.enviar_alerta(
                    "pedido", ctx.conv_id, ctx.telefono, f"Pedido #{codigo}: {resumen}"
                )

            etiquetas = ["pedido"]
            if pedido["direccion"] or pedido["zona"]:
                etiquetas.append("domicilio")
            return Resultado(
                texto=f"Pedido registrado con código {codigo}. El equipo ya fue avisado.",
                etiquetas=etiquetas,
            )
        except Exception as e:
            log.exception("conv %s: fallo registrando pedido", ctx.conv_id)
            return Resultado(texto=f"No se pudo registrar el pedido: {e}. Escala a un humano.")

    async def _fotos(self, datos: dict, ctx: Contexto) -> Resultado:
        """Con pausa entre foto y foto: soltar una tanda en el mismo segundo es
        el patrón de ráfaga que WhatsApp castiga."""
        p = ctx.perfil
        ids = datos.get("ids", []) or []
        productos = {str(x.get("id")): x for x in _leer(RUTA_CATALOGO, [])}

        # En convalecencia (48 h tras una reconexión) la tanda se corta: veinte
        # fotos seguidas a un desconocido es la ráfaga que castiga WhatsApp,
        # justo cuando el número está bajo la lupa.
        tope_normal = int(self._cfg(p).get("catalogo", {}).get("fotos_por_tanda", 4))
        tope = min(tope_normal, 8) if estado.convalecencia() else tope_normal
        recortadas = len(ids) > tope

        enviadas = []
        for pid in [str(i) for i in ids][:tope]:
            prod = productos.get(pid)
            if not prod:
                continue
            foto = FOTOS / str(prod.get("imagen") or "")
            falta = not prod.get("imagen") or not foto.exists()
            if falta and not ctx.simulacion:
                # Se registra: una foto que el bot quiso mandar y no existe es
                # un producto mal cargado, y en producción no lo ve nadie.
                eventos.registrar("foto_faltante", ctx.conv_id, producto=pid,
                                  archivo=str(prod.get("imagen") or ""))
                continue
            caption = prod.get("nombre", "")
            if _tiene_precio(prod):
                caption += f" — {_precio(prod['precio'], p)}"
            attrs = _atributos(prod)
            if attrs:
                caption += f"\n{attrs}"
            if ctx.simulacion:
                # Que falte el archivo es justo lo que el simulador tiene que
                # sacar a la luz: en producción la foto no sale y nadie se entera.
                aviso = f"  ⚠️ FALTA el archivo {prod.get('imagen') or '(sin imagen)'}" if falta else ""
                ctx.registrar(f"enviaría la foto de «{prod.get('nombre')}»{aviso}")
            else:
                if enviadas:
                    await asyncio.sleep(random.uniform(1.5, 2.5))
                await chatwoot.enviar_imagen(ctx.conv_id, foto, caption)
            enviadas.append(prod.get("nombre"))

        if not enviadas:
            return Resultado(
                texto="No se pudo enviar ninguna foto (ids inexistentes o sin archivo).",
            )
        nota = ""
        if recortadas:
            nota = (
                " OJO: la tanda se recortó. NO vuelvas a llamar enviar_fotos_catalogo en este "
                "turno: cierra tu respuesta diciéndole al cliente que le muestras más apenas "
                "te diga qué le gustó."
            )
        return Resultado(
            texto=(f"Fotos enviadas: {', '.join(enviadas)}. No repitas los precios en texto, "
                   f"ya van en el caption.{nota}"),
            etiquetas=["cotizacion"],
        )

    async def _pdf(self, ctx: Contexto) -> Resultado:
        from . import tienda_pdf
        p = ctx.perfil
        try:
            if ctx.simulacion:
                ctx.registrar("enviaría el catálogo completo en PDF")
            else:
                # Leer y componer 30+ fotos bloquea: va a un hilo para no frenar
                # las otras conversaciones.
                ruta = await asyncio.to_thread(tienda_pdf.asegurar, p)
                titulo = self._cfg(p).get("pdf", {}).get("titulo") or f"Catálogo {p.negocio}"
                await chatwoot.enviar_documento(ctx.conv_id, ruta, titulo)
            return Resultado(
                texto=("Catálogo PDF enviado en un solo mensaje. Los precios van dentro; no los "
                       "repitas en texto, y pregunta qué le llamó la atención."),
                etiquetas=["cotizacion"],
            )
        except Exception as e:
            log.exception("conv %s: fallo enviando catálogo PDF", ctx.conv_id)
            return Resultado(texto=(
                f"No se pudo enviar el PDF: {e}. Ofrece ver fotos sueltas con "
                "enviar_fotos_catalogo."
            ))
