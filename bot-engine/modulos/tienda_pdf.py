"""Catálogo completo en UN PDF.

Mandar 30 productos como fotos son 30 mensajes —y una ráfaga que WhatsApp
castiga—; el PDF es un solo mensaje de documento. Se regenera solo cuando el
catálogo o las fotos cambiaron, así que nunca sale desactualizado y no se paga
el costo de armarlo si no hubo cambios.

Genérico: los atributos de cada producto salen del propio catalogo.json, así
que sirve para computadores igual que para ropa.
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from fpdf import FPDF
from PIL import Image

from motor.config import DATA

log = logging.getLogger("chatsuite-bot")

FOTOS = DATA / "catalogo-fotos"
CATALOGO = DATA / "catalogo.json"
SALIDA = DATA / "catalogo.pdf"
THUMBS = DATA / ".pdf-thumbs"

MARGEN = 12
ANCHO = 210
COL = (ANCHO - MARGEN * 2 - 8) / 2
ALTO_FILA = 62
FILAS = 3

TINTA = (18, 18, 28)
GRIS = (110, 113, 138)


def _hex_a_rgb(valor: str, por_defecto=(15, 118, 214)):
    v = (valor or "").lstrip("#")
    if len(v) != 6:
        return por_defecto
    try:
        return tuple(int(v[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        return por_defecto


def _desactualizado() -> bool:
    if not SALIDA.exists():
        return True
    pdf = SALIDA.stat().st_mtime
    if CATALOGO.exists() and CATALOGO.stat().st_mtime > pdf:
        return True
    if FOTOS.exists():
        return any(f.stat().st_mtime > pdf for f in FOTOS.iterdir() if f.is_file())
    return False


def _thumb(origen: Path, lado: int = 520) -> Path | None:
    """Miniatura cuadrada. Sin esto un catálogo de 30 fotos de cámara pesa
    decenas de MB y WhatsApp rechaza el documento."""
    THUMBS.mkdir(exist_ok=True)
    destino = THUMBS / (origen.stem + ".jpg")
    try:
        if destino.exists() and destino.stat().st_mtime >= origen.stat().st_mtime:
            return destino
        with Image.open(origen) as im:
            im = im.convert("RGB")
            im.thumbnail((lado, lado))
            lienzo = Image.new("RGB", (lado, lado), "white")
            lienzo.paste(im, ((lado - im.width) // 2, (lado - im.height) // 2))
            lienzo.save(destino, "JPEG", quality=82, optimize=True)
        return destino
    except Exception:
        log.warning("no se pudo preparar la miniatura de %s", origen.name)
        return None


def _precio(valor, moneda: str) -> str:
    """`0` es gratis, no «sin precio» (ver el mismo caso en tienda.py)."""
    try:
        n = int(valor)
    except Exception:
        return ""
    if n == 0:
        return "gratis"
    return "${:,}".format(n).replace(",", ".") if moneda == "COP" else "{:,}".format(n)


def _asciificar(texto: str) -> str:
    """FPDF con fuentes core solo maneja latin-1: un emoji en el nombre de un
    producto reventaba la generación entera."""
    return (texto or "").encode("latin-1", "replace").decode("latin-1")


def generar(p) -> Path:
    productos = json.loads(CATALOGO.read_text(encoding="utf-8"))
    acento = _hex_a_rgb(p.get("negocio.color", ""))
    moneda = p.moneda

    pdf = FPDF(orientation="P", unit="mm", format="A4")
    pdf.set_auto_page_break(False)
    pdf.set_title(_asciificar(f"Catálogo {p.negocio}"))

    logo = next((DATA / n for n in ("logo.png", "logo.jpg") if (DATA / n).exists()), None)
    por_pagina = FILAS * 2

    for i, prod in enumerate(productos):
        if i % por_pagina == 0:
            pdf.add_page()
            pdf.set_fill_color(*acento)
            pdf.rect(0, 0, ANCHO, 22, style="F")
            x_texto = MARGEN
            if logo:
                try:
                    pdf.image(str(logo), x=MARGEN, y=4, h=14)
                    x_texto = MARGEN + 18
                except Exception:
                    pass
            pdf.set_xy(x_texto, 6)
            pdf.set_font("Helvetica", "B", 15)
            pdf.set_text_color(255, 255, 255)
            pdf.cell(0, 10, _asciificar(p.negocio), align="L")
            pdf.set_xy(MARGEN, 24)

        pos = i % por_pagina
        x = MARGEN + (pos % 2) * (COL + 8)
        y = 30 + (pos // 2) * ALTO_FILA

        foto = FOTOS / str(prod.get("imagen") or "")
        if prod.get("imagen") and foto.exists():
            thumb = _thumb(foto)
            if thumb:
                try:
                    pdf.image(str(thumb), x=x, y=y, w=COL, h=COL * 0.72)
                except Exception:
                    pass

        pdf.set_xy(x, y + COL * 0.72 + 2)
        pdf.set_font("Helvetica", "B", 9)
        pdf.set_text_color(*TINTA)
        pdf.multi_cell(COL, 4, _asciificar(str(prod.get("nombre", "")))[:70], align="L")

        if prod.get("precio") is not None:
            pdf.set_x(x)
            pdf.set_font("Helvetica", "B", 11)
            pdf.set_text_color(*acento)
            pdf.cell(COL, 5, _asciificar(_precio(prod["precio"], moneda)), align="L")
            pdf.ln(5)

        extra = " · ".join(
            f"{k}: {v}" for k, v in prod.items()
            if k not in {"id", "nombre", "precio", "imagen"} and v
        )
        if extra:
            pdf.set_x(x)
            pdf.set_font("Helvetica", "", 7)
            pdf.set_text_color(*GRIS)
            pdf.multi_cell(COL, 3, _asciificar(extra)[:120], align="L")

    contacto = p.get("negocio.contacto", "")
    if pdf.page_no():
        pdf.set_xy(MARGEN, 285)
        pdf.set_font("Helvetica", "", 7)
        pdf.set_text_color(*GRIS)
        fecha = datetime.now(ZoneInfo(p.tz)).strftime("%d/%m/%Y")
        pdf.cell(0, 4, _asciificar(f"{contacto}   ·   Precios sujetos a cambio. Actualizado {fecha}"))

    tmp = SALIDA.with_suffix(".pdf.tmp")
    pdf.output(str(tmp))
    tmp.replace(SALIDA)
    log.info("catálogo PDF regenerado: %s productos", len(productos))
    return SALIDA


def asegurar(p) -> Path:
    """El PDF vigente, regenerándolo solo si hace falta."""
    if _desactualizado():
        return generar(p)
    return SALIDA
