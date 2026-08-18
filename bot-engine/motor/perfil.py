"""El perfil del cliente: un solo archivo con TODO lo configurable.

La razón de existir de este módulo es que en tubodega-bot la configuración
vivía en cinco sitios con cinco comportamientos distintos (el .env exigía
reiniciar, los data/*.json se releían solos, las etiquetas vivían en Chatwoot).
Acá hay un solo `perfil.json` por cliente, que el panel escribe y el motor
relee cuando cambia el mtime: **ninguna decisión de negocio exige un reinicio**.

El .env queda solo para secretos (tokens), que sí exigen reinicio y está bien
que así sea.
"""
import json
import logging
import threading
from pathlib import Path
from typing import Any

from .config import RAIZ_PERFIL

log = logging.getLogger("chatsuite-bot")

RUTA = RAIZ_PERFIL / "perfil.json"

# Estados del ciclo de vida. El interruptor de producción vive ACÁ y no en un
# archivo de runtime a propósito: en Tu Bodega el "modo observación" se perdió
# solo en un reinicio porque el default del código era True y nadie lo notó.
BORRADOR = "borrador"      # se configura; el bot ni siquiera contesta
PRUEBA = "prueba"          # responde SOLO al simulador y a los del equipo
PRODUCCION = "produccion"  # responde a clientes reales

_lock = threading.Lock()
_cache: dict | None = None
_mtime: float = 0.0


class Perfil:
    """Vista de solo lectura del perfil, con acceso por ruta punteada."""

    def __init__(self, datos: dict):
        self._d = datos or {}

    def get(self, ruta: str, por_defecto: Any = None) -> Any:
        nodo: Any = self._d
        for parte in ruta.split("."):
            if not isinstance(nodo, dict) or parte not in nodo:
                return por_defecto
            nodo = nodo[parte]
        return nodo if nodo is not None else por_defecto

    # ── Atajos de lo que se consulta en cada mensaje ────────────────────────
    @property
    def slug(self) -> str:
        return self.get("slug", "sin-slug")

    @property
    def estado(self) -> str:
        return self.get("estado", BORRADOR)

    @property
    def en_produccion(self) -> bool:
        return self.estado == PRODUCCION

    @property
    def negocio(self) -> str:
        return self.get("negocio.nombre", "el negocio")

    @property
    def tz(self) -> str:
        return self.get("negocio.zona_horaria", "America/Bogota")

    @property
    def moneda(self) -> str:
        return self.get("negocio.moneda", "COP")

    @property
    def canal(self) -> str:
        """`evolution` o `cloud_api`. Es lo único que decide si aplica la
        ventana de 24 h y si hay presencia y acuses."""
        return self.get("canal.tipo", "evolution")

    @property
    def audiencia(self) -> str:
        """`clientes`, `equipo` o `ambos`.

        No todos los bots atienden clientes: uno administrativo interno invierte
        la regla del equipo (solo atiende a los de adentro) y uno de gimnasio
        puede necesitar las dos, con permisos distintos según quién escribe.
        """
        return self.get("audiencia", "clientes")

    @property
    def modulos(self) -> list[str]:
        return list(self.get("modulos", []))

    @property
    def etiquetas_validas(self) -> set[str]:
        """Catálogo cerrado. Chatwoot crea al vuelo cualquier etiqueta que
        reciba, así que sin esta lista un modelo creativo llena la cuenta de
        etiquetas inventadas y las vistas guardadas dejan de significar algo
        (es exactamente lo que pasó en Laura/Sandra)."""
        return {
            (e.get("nombre") or "").strip().lower()
            for e in self.get("etiquetas", [])
            if (e.get("nombre") or "").strip()
        }

    def modulo(self, nombre: str) -> dict:
        """Configuración específica de un módulo (p. ej. `tienda`)."""
        return self.get(nombre, {}) or {}

    def como_dict(self) -> dict:
        return json.loads(json.dumps(self._d))


_VACIO = Perfil({"slug": "sin-perfil", "estado": BORRADOR})


def actual() -> Perfil:
    """El perfil vigente, releyendo el archivo si cambió en disco.

    Se llama en cada mensaje. La comparación es por mtime, así que el costo
    normal es un `stat()`.
    """
    global _cache, _mtime
    try:
        m = RUTA.stat().st_mtime
    except FileNotFoundError:
        if _cache is None:
            log.error("no existe %s; el bot queda en borrador", RUTA)
        return Perfil(_cache) if _cache else _VACIO

    if _cache is not None and m == _mtime:
        return Perfil(_cache)

    with _lock:
        try:
            datos = json.loads(RUTA.read_text(encoding="utf-8"))
        except Exception:
            # Un perfil a medio escribir no debe tumbar al bot: se sigue con el
            # último bueno hasta que el archivo vuelva a ser válido.
            log.exception("perfil.json ilegible; sigo con el anterior")
            return Perfil(_cache) if _cache else _VACIO
        _cache, _mtime = datos, m
        log.info(
            "perfil recargado: %s · estado=%s · canal=%s · modulos=%s",
            datos.get("slug"), datos.get("estado"), (datos.get("canal") or {}).get("tipo"),
            ",".join(datos.get("modulos") or []) or "-",
        )
    return Perfil(_cache)


def escribir(datos: dict) -> None:
    """Guarda el perfil (lo usa el panel). Escritura atómica: el motor puede
    estar leyéndolo en el mismo instante."""
    RUTA.parent.mkdir(parents=True, exist_ok=True)
    tmp = RUTA.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(RUTA)
