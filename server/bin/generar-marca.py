#!/usr/bin/env python3
"""Genera los assets de marca de un tenant a partir del logo del cliente.

Reemplaza al generar-assets.py de CompuXtreme, que estaba escrito a la medida de
ese cliente (el corte COMPU/XTREME y el azul iban hardcodeados). Aqui todo entra
por parametros, que es lo que permite dar de alta un cliente sin tocar codigo.

    generar-marca.py --logo iso.png --nombre "CompuXtreme" --color "#0080B0" \
                     --salida /srv/chatsuite/compuxtreme/brand

Escribe los 10 archivos que esperan el layout y los .vue de chatsuite:base:

    brand.css           --brand-rgb, la paleta de Tailwind
    sidebar-logo.png    lockup del sidebar (sirve en tema claro y oscuro)
    watermark.png       marca de agua del panel de conversacion vacio
    logo.svg            login, tema claro
    logo_dark.svg       login, tema oscuro
    logo_thumbnail.svg  favicon de 512 e icono de la pestaña
    favicon-{16,32,96,512}.png

Modo aparte para el wizard, que sugiere el color antes de generar nada:

    generar-marca.py --logo iso.png --solo-color     -> imprime {"color": "#0080B0"}
"""
import argparse
import base64
import colorsys
import io
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FUENTE = '/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Black.ttf'

# Gris oscuro del tema claro de Chatwoot. El texto del lockup claro va en este
# tono y no en negro puro, que sobre el blanco roto del login se ve duro.
OSCURO = (32, 34, 40)
BLANCO = (245, 246, 248)

# Escala a la que se dibuja el texto antes de reducirlo. Dibujar directo al
# tamaño final deja los bordes dentados; 4x y reduce es lo que da el borde limpio.
SUPERMUESTREO = 4


def leer_logo(ruta, quitar_fondo):
    """Abre el logo del cliente y lo deja en RGBA recortado a su contenido.

    quitar_fondo aplica luma keying: sirve cuando el cliente manda un JPG con el
    isotipo sobre fondo plano (el caso mas comun, y el que hubo con CompuXtreme).
    Un PNG que ya trae alfa no lo necesita y pasarlo lo estropea, por eso es
    opcional y no automatico.
    """
    img = Image.open(ruta).convert('RGBA')

    if quitar_fondo:
        # Se muestrea la esquina superior izquierda como color de fondo en vez de
        # asumir negro o blanco: hay logos sobre fondo de marca.
        fondo = img.getpixel((0, 0))[:3]
        oscuro_el_fondo = sum(fondo) / 3 < 128
        pixeles = img.load()
        ancho, alto = img.size
        for y in range(alto):
            for x in range(ancho):
                r, g, b, a = pixeles[x, y]
                luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255
                # Sobre fondo oscuro, el alfa sigue a la luminosidad; sobre fondo
                # claro, a su inverso. Asi el antialias del borde se conserva en
                # vez de quedar recortado en escalera.
                alfa = luma if oscuro_el_fondo else 1 - luma
                pixeles[x, y] = (r, g, b, int(max(0, min(1, alfa * 1.15)) * 255))

    caja = img.getbbox()
    return img.crop(caja) if caja else img


def color_dominante(img):
    """Color mas saturado del logo, para proponerlo como color de marca.

    Se descartan los pixeles casi transparentes, los muy oscuros y los muy
    claros: el negro del contorno y el blanco del fondo son casi siempre los
    dominantes por conteo, y ninguno de los dos sirve como color de marca.
    """
    chico = img.convert('RGBA').resize((80, 80))
    pixeles = chico.load()
    mejor, mejor_puntaje = None, -1.0
    for r, g, b, a in (pixeles[x, y] for y in range(80) for x in range(80)):
        if a < 200:
            continue
        h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
        if l < 0.12 or l > 0.92 or s < 0.15:
            continue
        # Se premia la saturacion y se castiga alejarse de una luminosidad media:
        # un color de marca util tiene que contrastar contra blanco Y contra el
        # gris oscuro del modo noche.
        puntaje = s * (1 - abs(l - 0.5))
        if puntaje > mejor_puntaje:
            mejor, mejor_puntaje = (r, g, b), puntaje

    if mejor is None:
        return '#007FFC'  # el azul de Chatsuite, si el logo no aporta color
    return '#%02X%02X%02X' % mejor


def hex_a_rgb(valor):
    valor = valor.strip().lstrip('#')
    if len(valor) == 3:
        valor = ''.join(c * 2 for c in valor)
    if len(valor) != 6:
        sys.exit(f'color invalido: {valor!r} (se espera #RRGGBB)')
    try:
        return tuple(int(valor[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        sys.exit(f'color invalido: {valor!r} (se espera #RRGGBB)')


def aclarar(rgb, factor=0.25):
    """Sube el brillo del color para usarlo sobre fondo oscuro.

    El color de marca muestreado de un logo suele estar pensado para fondo
    blanco; puesto tal cual sobre el gris oscuro del modo noche pierde contraste.
    """
    h, l, s = colorsys.rgb_to_hls(*[c / 255 for c in rgb])
    r, g, b = colorsys.hls_to_rgb(h, min(1.0, l + (1 - l) * factor), s)
    return (int(r * 255), int(g * 255), int(b * 255))


def lockup(iso, nombre, color_texto, alto_objetivo=None):
    """Isotipo + nombre de la marca sobre fondo transparente.

    El isotipo se queda a su resolucion nativa: agrandarlo solo inventa pixeles
    cuando el original es un JPG de baja resolucion, que es lo habitual.
    """
    alto = iso.height
    tam_texto = int(alto * 0.34) * SUPERMUESTREO
    fuente = ImageFont.truetype(FUENTE, tam_texto)

    medidor = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    ancho_texto = int(medidor.textlength(nombre, font=fuente))

    capa = Image.new('RGBA', (ancho_texto + SUPERMUESTREO * 4, tam_texto * 2), (0, 0, 0, 0))
    ImageDraw.Draw(capa).text((0, tam_texto), nombre, font=fuente, fill=color_texto, anchor='lm')
    capa = capa.crop(capa.getbbox())
    capa = capa.resize(
        (capa.width // SUPERMUESTREO, capa.height // SUPERMUESTREO), Image.LANCZOS
    )

    separacion = int(alto * 0.18)
    lienzo = Image.new('RGBA', (iso.width + separacion + capa.width, alto), (0, 0, 0, 0))
    lienzo.alpha_composite(iso, (0, 0))
    lienzo.alpha_composite(capa, (iso.width + separacion, (alto - capa.height) // 2))

    if alto_objetivo and lienzo.height != alto_objetivo:
        escala = alto_objetivo / lienzo.height
        lienzo = lienzo.resize(
            (max(1, int(lienzo.width * escala)), alto_objetivo), Image.LANCZOS
        )
    return lienzo


def svg_con_png(img):
    """Envuelve un PNG en un SVG con la imagen embebida en base64.

    Chatwoot pide .svg para LOGO / LOGO_DARK / LOGO_THUMBNAIL, pero el cliente
    casi nunca manda vectores. El SVG no vuelve vectorial al logo: le da el
    contenedor que el producto espera y lo deja escalar sin recorte.
    """
    buf = io.BytesIO()
    img.save(buf, 'PNG', optimize=True)
    datos = base64.b64encode(buf.getvalue()).decode('ascii')
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="0 0 {img.width} {img.height}" width="{img.width}" height="{img.height}">'
        f'<image width="{img.width}" height="{img.height}" '
        f'xlink:href="data:image/png;base64,{datos}"/></svg>'
    )


def cuadrar(img, lado, margen=0.08):
    """Centra el logo en un lienzo cuadrado transparente, para los favicons."""
    util = int(lado * (1 - margen * 2))
    # min(..., 1.0) evita ampliar: el logo del cliente suele ser un JPG de baja
    # resolucion, y estirarlo a 512 solo inventa pixeles y triplica el peso del
    # archivo. Si el original es chico, se centra a su tamaño nativo.
    escala = min(util / img.width, util / img.height, 1.0)
    reducido = img.resize(
        (max(1, int(img.width * escala)), max(1, int(img.height * escala))), Image.LANCZOS
    )
    lienzo = Image.new('RGBA', (lado, lado), (0, 0, 0, 0))
    lienzo.alpha_composite(
        reducido, ((lado - reducido.width) // 2, (lado - reducido.height) // 2)
    )
    return lienzo


def main():
    p = argparse.ArgumentParser(description='Genera los assets de marca de un tenant.')
    p.add_argument('--logo', required=True, help='PNG o JPG con el logo del cliente')
    p.add_argument('--nombre', help='nombre de la marca, va en el lockup')
    p.add_argument('--color', help='color de marca #RRGGBB (por defecto, el dominante del logo)')
    p.add_argument('--salida', help='directorio destino')
    p.add_argument('--quitar-fondo', action='store_true',
                   help='recorta el fondo plano por luminosidad (para JPG)')
    p.add_argument('--solo-color', action='store_true',
                   help='imprime el color dominante en JSON y termina')
    args = p.parse_args()

    iso = leer_logo(args.logo, args.quitar_fondo)

    if args.solo_color:
        print(json.dumps({'color': color_dominante(iso)}))
        return

    if not args.nombre or not args.salida:
        sys.exit('--nombre y --salida son obligatorios salvo con --solo-color')

    color = args.color or color_dominante(iso)
    rgb = hex_a_rgb(color)
    rgb_claro = aclarar(rgb)

    os.makedirs(args.salida, exist_ok=True)

    def destino(nombre):
        return os.path.join(args.salida, nombre)

    # brand.css — el archivo que le da el color a todo el producto.
    with open(destino('brand.css'), 'w', encoding='utf-8') as fh:
        fh.write(
            f'/* Marca de {args.nombre}. Generado por generar-marca.py, no editar a mano. */\n'
            f'/*\n'
            f' * --brand-rgb    color de marca: botones, enlaces, sidebar activo, foco,\n'
            f' *                y el fondo de las pantallas de sesion.\n'
            f' * --brand-accent segundo tono, solo para los degradados del login.\n'
            f' *\n'
            f' * Canales RGB separados por ESPACIO y sin coma: es lo que exige\n'
            f' * rgb(var(--brand-rgb) / <alpha-value>) en theme/colors.js. Con comas\n'
            f' * Tailwind no puede aplicar opacidad y los hover se ven solidos.\n'
            f' */\n'
            f':root {{\n'
            f'  --brand-rgb: {rgb[0]} {rgb[1]} {rgb[2]}; /* {color.upper()} */\n'
            f'  --brand-accent-rgb: {rgb_claro[0]} {rgb_claro[1]} {rgb_claro[2]};'
            f' /* {"#%02X%02X%02X" % rgb_claro} */\n'
            f'}}\n'
        )

    # Sidebar: un solo archivo para los dos temas. El nombre va en el color de
    # marca, que contrasta contra el blanco del tema claro y contra el gris
    # oscuro del modo noche. En gris oscuro desapareceria de noche.
    lockup(iso, args.nombre, rgb, alto_objetivo=96).save(destino('sidebar-logo.png'), optimize=True)

    # Marca de agua: solo el isotipo, que se muestra al 20-25% de opacidad.
    ancho_marca = min(1000, iso.width * 2)
    escala = ancho_marca / iso.width
    iso.resize((ancho_marca, max(1, int(iso.height * escala))), Image.LANCZOS).save(
        destino('watermark.png'), optimize=True
    )

    # Login: dos variantes, porque Chatwoot distingue LOGO y LOGO_DARK.
    for archivo, color_texto in (
        ('logo.svg', OSCURO),
        ('logo_dark.svg', BLANCO),
    ):
        with open(destino(archivo), 'w', encoding='utf-8') as fh:
            fh.write(svg_con_png(lockup(iso, args.nombre, color_texto, alto_objetivo=160)))

    with open(destino('logo_thumbnail.svg'), 'w', encoding='utf-8') as fh:
        fh.write(svg_con_png(cuadrar(iso, 256)))

    for lado in (16, 32, 96, 512):
        cuadrar(iso, lado).save(destino(f'favicon-{lado}x{lado}.png'), optimize=True)

    print(json.dumps({
        'color': color.upper(),
        'color_claro': '#%02X%02X%02X' % rgb_claro,
        'archivos': sorted(os.listdir(args.salida)),
    }))


if __name__ == '__main__':
    main()
