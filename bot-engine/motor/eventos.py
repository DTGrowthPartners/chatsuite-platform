"""Qué hizo el bot: eventos crudos y su resumen diario.

Dos archivos por cliente:

- `data/eventos.jsonl` — una línea por hecho, de solo agregar. Se retiene ~90
  días. Es el detalle: permite responder preguntas que hoy no se nos ocurrieron
  ("¿a qué hora escalan más?", "¿qué producto pregunta quien no cierra?").
- `data/stats.json` — el acumulado por día. Es lo que lee el panel; barato de
  consultar y se guarda siempre.

**No se guarda el contenido de los mensajes.** Ese ya vive en Chatsuite, y
duplicarlo sería crear un problema de privacidad sin ganar nada. Acá van hechos
y metadatos: qué pasó, en qué conversación, cuánto tardó y cuánto costó.

La excepción es `sin_dato`: ahí sí se guarda la pregunta que el bot no supo
responder, porque ES el dato. Cada una de esas líneas es una fila que falta en
el catálogo o en la tabla de domicilios.
"""
import json
import logging
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import perfil as perfil_mod
from .config import DATA

log = logging.getLogger("chatsuite-bot")

RUTA_EVENTOS = DATA / "eventos.jsonl"
RUTA_STATS = DATA / "stats.json"

DIAS_CRUDO = 90
DIAS_RESUMEN = 400

# Un solo escritor por proceso; el append de una línea corta es atómico en
# Linux, pero el read-modify-write de stats.json no lo es.
_lock = threading.Lock()


def _hoy() -> str:
    return str(datetime.now(ZoneInfo(perfil_mod.actual().tz)).date())


def _leer_stats() -> dict:
    try:
        return json.loads(RUTA_STATS.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _guardar_stats(datos: dict) -> None:
    tmp = RUTA_STATS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(RUTA_STATS)


def registrar(tipo: str, conv_id: int = 0, **datos) -> None:
    """Anota un hecho. Nunca lanza: medir jamás debe tumbar una respuesta."""
    try:
        with _lock:
            linea = {"ts": round(time.time(), 3), "tipo": tipo, "conv": conv_id, **datos}
            with RUTA_EVENTOS.open("a", encoding="utf-8") as f:
                f.write(json.dumps(linea, ensure_ascii=False) + "\n")

            stats = _leer_stats()
            dia = stats.setdefault(_hoy(), {})
            dia[tipo] = dia.get(tipo, 0) + 1
            # Los acumulables se suman aparte del contador de eventos: sirven
            # para sacar promedios sin releer el jsonl entero.
            for campo in ("tokens_in", "tokens_out", "cache_lee", "cache_escribe", "ms"):
                if campo in datos:
                    dia[campo] = dia.get(campo, 0) + int(datos[campo] or 0)
            if tipo == "tool" and datos.get("nombre"):
                tools = dia.setdefault("tools", {})
                tools[datos["nombre"]] = tools.get(datos["nombre"], 0) + 1
            for viejo in sorted(stats)[:-DIAS_RESUMEN]:
                stats.pop(viejo, None)
            _guardar_stats(stats)
    except Exception:
        log.exception("no se pudo registrar el evento %s", tipo)


def purgar() -> int:
    """Tira las líneas crudas de más de DIAS_CRUDO. El resumen no se toca."""
    if not RUTA_EVENTOS.exists():
        return 0
    corte = time.time() - DIAS_CRUDO * 86400
    quedan, tiradas = [], 0
    with _lock:
        for linea in RUTA_EVENTOS.read_text(encoding="utf-8").splitlines():
            try:
                if json.loads(linea).get("ts", 0) >= corte:
                    quedan.append(linea)
                else:
                    tiradas += 1
            except Exception:
                continue
        if tiradas:
            tmp = RUTA_EVENTOS.with_suffix(".jsonl.tmp")
            tmp.write_text("\n".join(quedan) + ("\n" if quedan else ""), encoding="utf-8")
            tmp.replace(RUTA_EVENTOS)
    return tiradas


# ── Lecturas para el panel ──────────────────────────────────────────────────

def resumen(dias: int = 30) -> dict:
    """Lo del período, con lo derivado ya calculado."""
    stats = _leer_stats()
    tz = ZoneInfo(perfil_mod.actual().tz)
    desde = (datetime.now(tz) - timedelta(days=dias - 1)).date()
    total: dict = {"tools": {}}
    por_dia = {}
    for dia, d in sorted(stats.items()):
        try:
            if datetime.fromisoformat(dia).date() < desde:
                continue
        except ValueError:
            continue
        por_dia[dia] = d
        for k, v in d.items():
            if k == "tools":
                for t, n in v.items():
                    total["tools"][t] = total["tools"].get(t, 0) + n
            else:
                total[k] = total.get(k, 0) + v

    atendidos = total.get("atendido", 0)
    escaladas = total.get("escalada", 0)
    return {
        "dias": dias,
        "total": total,
        "por_dia": por_dia,
        "derivadas": {
            # LA métrica: qué parte de las conversaciones cerró el bot sin que
            # un humano tuviera que entrar. Es lo que traduce a asesores
            # ahorrados.
            "contencion": round((atendidos - escaladas) / atendidos, 3) if atendidos else None,
            "pedidos_por_100": round(total.get("pedido", 0) * 100 / atendidos, 1) if atendidos else None,
            "ms_promedio": round(total.get("ms", 0) / atendidos) if atendidos else None,
            # Todo lo que el turno movió de verdad, cacheado incluido.
            "tokens_por_atendido": round(
                (total.get("tokens_in", 0) + total.get("tokens_out", 0)
                 + total.get("cache_lee", 0) + total.get("cache_escribe", 0)) / atendidos
            ) if atendidos else None,
        },
    }


def sin_datos(limite: int = 40) -> list[dict]:
    """Las preguntas que el bot no supo responder, agrupadas.

    Es la lista de trabajo para mejorarlo: si el mismo barrio aparece 40 veces,
    no es un incidente, es una fila que falta en la tabla de domicilios.
    """
    if not RUTA_EVENTOS.exists():
        return []
    vistos: dict[str, dict] = {}
    for linea in RUTA_EVENTOS.read_text(encoding="utf-8").splitlines()[-20000:]:
        try:
            e = json.loads(linea)
        except Exception:
            continue
        if e.get("tipo") != "sin_dato":
            continue
        texto = (e.get("pregunta") or "").strip()
        if not texto:
            continue
        clave = texto.lower()[:80]
        v = vistos.setdefault(clave, {"pregunta": texto, "veces": 0, "ultima": 0})
        v["veces"] += 1
        v["ultima"] = max(v["ultima"], e.get("ts", 0))
    return sorted(vistos.values(), key=lambda x: -x["veces"])[:limite]
