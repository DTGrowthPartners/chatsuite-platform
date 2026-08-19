# Login nuevo de Chatsuite — trabajo a medio camino

Estado al 2026-08-19: **la maqueta está aprobada a falta de tu visto bueno y
NO está horneada en la imagen todavía.** El login que ven hoy los clientes
sigue siendo el de `chatwoot:dtgp`.

## Qué hay aquí

| Archivo | Qué es |
|---|---|
| `maqueta.html` | La maqueta, autocontenida (los logos van en base64). Se abre en cualquier navegador. Publicada además como artifact: https://claude.ai/code/artifact/3ee18eb0-0411-4e54-ba20-7d2a779c51d8 |
| `maqueta.py` | Lo que genera `maqueta.html`. Se edita ESTE, no el HTML. Necesita `logos.py`, que se regenera con el snippet de abajo. |
| `Index.vue.actual` | El login que hay hoy dentro de `chatsuite:base`, extraído tal cual. Es la base a modificar. |
| `assets/` | El logo de DT Growth y sus derivados. |

## Por qué el arte del panel no es una foto

Son tres focos del color del cliente sobre negro más una trama fina. Si
dependiera de una imagen, cada cliente nuevo necesitaría una foto buena o su
login se vería peor que el de los demás; así, el que se dé de alta mañana
hereda el diseño y solo cambia `--brand-rgb`.

## Lo que falta para que esto exista de verdad

1. Portar la maqueta a `Index.vue` **sin tocar la lógica**: MFA, Google, SAML,
   validación y el `submit` se quedan como están. Solo cambia el `<template>` y
   el `<style scoped>`. Los `FormInput` y `NextButton` de Chatwoot traen sus
   clases, así que restilarlos exige `:deep()`.
2. Copiar los assets de DTGP a una ruta **horneada**, p. ej.
   `/app/public/dtgp/`, y NO a `/app/public/brand-assets/`: ese directorio lo
   reemplaza el bind-mount de cada cliente, así que la firma «Powered by DT
   Growth Partners» desaparecería en cuanto el cliente tuviera marca propia.
3. `docker build -t chatsuite:base base-build/` — son ~10 minutos, casi todos
   del `assets:precompile`.
4. Recrear (o `docker compose up -d`) los tenants para que tomen la imagen.

**Orden para el video**: hornear la imagen ANTES de borrar y recrear
CompuXtreme, para que nazca ya con el login nuevo.

## Regenerar logos.py

```python
import base64, pathlib
b = lambda n: base64.b64encode(pathlib.Path('assets/' + n).read_bytes()).decode()
pathlib.Path('logos.py').write_text(
    f"CLARO = '{b('dtgp-lockup-claro.png')}'\n"
    f"OSCURO = '{b('dtgp-lockup-oscuro.png')}'\n"
    f"MONO_GRIS = '{b('dtgp-mono-gris.png')}'\n"
    f"MONO_CLARO = '{b('dtgp-mono-claro.png')}'\n")
```

Los derivados salen del original con el alfa como máscara: el logo es un lockup
blanco sobre transparente, así que teñirlo es reemplazar el color y conservar el
canal alfa. El monograma se recorta en x=762, que es donde está el único hueco
vertical entre el símbolo y las palabras.
