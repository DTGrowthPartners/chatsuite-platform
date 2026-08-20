#!/usr/bin/env python3
"""Cambia el logo de DT Growth Partners en el panel.

    bin/logo-dtgp.py ruta/al/logo-nuevo.png
    cd server && npm run panel        # compila y reinicia

Toma UN archivo —el lockup horizontal, blanco sobre transparente— y deja los
tres que usa la interfaz:

    public/dt-logo.png    el lockup: cabecera del panel y acceso al formulario
    public/icono.png      el monograma sobre el degradado de marca (favicon)
    public/icono-180.png  el mismo, para la pantalla de inicio de iOS

El icono se recorta solo: se busca el primer hueco vertical ancho entre la parte
con tinta, que es la separacion natural entre el simbolo y las palabras. Si el
logo nuevo no tiene esa separacion —por ejemplo, un logo de una sola pieza— hay
que pasar --monograma con el simbolo aparte.

El logo DEBE venir en blanco sobre transparente. La interfaz lo invierte por CSS
para el tema claro (`.lockup-dtgp`), asi que uno a color se veria en negativo.
"""
import argparse
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("falta Pillow: pip install Pillow")

LADO = 512
# El mismo redondeo del cuadrado que usaba <Marca>, para que el favicon y la
# interfaz no se vean como dos piezas distintas.
RADIO = int(LADO * 0.22)
MARCA, MARCA_2 = (0x00, 0x7F, 0xFC), (0x26, 0xBD, 0xF0)


def hueco_tras_el_simbolo(im, minimo=12):
    """Primera columna vacia ancha: donde termina el simbolo y empiezan las letras."""
    alfa = im.split()[3]
    conte = [x for x in range(im.width) if alfa.crop((x, 0, x + 1, im.height)).getbbox()]
    if not conte:
        return None
    previo = conte[0]
    for x in conte[1:]:
        if x - previo > minimo:
            return previo + 1
        previo = x
    return None


def degradado(lado):
    grad = Image.new("RGB", (lado, lado))
    d = ImageDraw.Draw(grad)
    for i in range(lado * 2):
        t = i / (lado * 2 - 1)
        d.line([(i, 0), (0, i)], fill=tuple(
            int(MARCA[c] + (MARCA_2[c] - MARCA[c]) * t) for c in range(3)))
    return grad


def mascara(lado, radio):
    # A 4x y reducida: dibujarla al tamaño final deja las esquinas dentadas.
    m = Image.new("L", (lado * 4, lado * 4), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, lado * 4 - 1, lado * 4 - 1], radio * 4, fill=255)
    return m.resize((lado, lado), Image.LANCZOS)


def main():
    p = argparse.ArgumentParser(description="Cambia el logo de DTGP en el panel.")
    p.add_argument("logo", type=Path, help="lockup horizontal, PNG blanco sobre transparente")
    p.add_argument("--monograma", type=Path,
                   help="simbolo suelto para el icono; por defecto se recorta del lockup")
    p.add_argument("--destino", type=Path, default=Path(__file__).resolve().parent.parent / "panel" / "public")
    args = p.parse_args()

    lock = Image.open(args.logo).convert("RGBA")
    if lock.width < lock.height:
        print("aviso: el lockup se espera horizontal; este es mas alto que ancho", file=sys.stderr)

    if args.monograma:
        mono = Image.open(args.monograma).convert("RGBA")
    else:
        corte = hueco_tras_el_simbolo(lock)
        if corte is None:
            sys.exit("no encontre donde termina el simbolo; pasa --monograma con el aparte")
        mono = lock.crop((0, 0, corte, lock.height))
        print(f"monograma recortado en x={corte} de {lock.width}")

    # El logo tal cual, sin tocar.
    args.destino.mkdir(parents=True, exist_ok=True)
    lock.save(args.destino / "dt-logo.png")

    icono = Image.new("RGBA", (LADO, LADO), (0, 0, 0, 0))
    icono.paste(degradado(LADO), (0, 0), mascara(LADO, RADIO))
    ancho = int(LADO * 0.58)
    alto = max(1, int(ancho * mono.height / mono.width))
    mono = mono.resize((ancho, alto), Image.LANCZOS)
    icono.paste(mono, ((LADO - ancho) // 2, (LADO - alto) // 2), mono)

    icono.save(args.destino / "icono.png")
    icono.resize((180, 180), Image.LANCZOS).save(args.destino / "icono-180.png")

    print(f"listos en {args.destino}: dt-logo.png, icono.png, icono-180.png")
    print("ahora: cd server && npm run panel")


if __name__ == "__main__":
    main()
