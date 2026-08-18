"""La agenda propia: disponibilidad, reserva y cancelación.

Vive aparte del módulo para que cambiar de proveedor (Cal.com, AgendaPro) sea
reemplazar este archivo y no reescribir el módulo.

Dos decisiones que sostienen todo lo demás:

1. **El modelo NUNCA calcula horarios.** Se le entregan turnos concretos, ya
   filtrados por horario, duración, cierres y lo que ya está ocupado. Un modelo
   al que se le pide «calcula la disponibilidad» inventa horas que no existen y
   agenda encima de otro cliente.

2. **La reserva vuelve a verificar antes de escribir.** Entre que se muestran
   los horarios y el cliente elige pasan minutos, y en ese rato otro pudo tomar
   el mismo. Sin esa segunda comprobación se agendan dos personas a la misma
   hora, y eso el cliente lo descubre en el mostrador.
"""
import json
import logging
import secrets
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from motor.config import DATA

log = logging.getLogger("chatsuite-bot")

RUTA_CITAS = DATA / "citas.json"
RUTA_CIERRES = DATA / "cierres.json"

# Un solo escritor: sin esto, dos conversaciones simultáneas pueden leer el
# mismo archivo y la segunda pisar la cita de la primera.
_lock = threading.Lock()

ACTIVAS = ("agendada", "confirmada")


def _leer(ruta: Path, por_defecto):
    try:
        return json.loads(ruta.read_text(encoding="utf-8"))
    except Exception:
        return por_defecto


def citas() -> list[dict]:
    return _leer(RUTA_CITAS, [])


def _guardar(datos: list[dict]) -> None:
    tmp = RUTA_CITAS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(RUTA_CITAS)


def _tz(p) -> ZoneInfo:
    return ZoneInfo(p.tz)


def _cfg(p) -> dict:
    return p.modulo("citas")


def servicios(p) -> list[dict]:
    return [s for s in _cfg(p).get("servicios", []) if s.get("nombre")]


def profesionales(p) -> list[str]:
    return [x for x in _cfg(p).get("profesionales", []) if x]


def servicio_por_nombre(p, nombre: str) -> dict | None:
    n = (nombre or "").strip().lower()
    if not n:
        return None
    todos = servicios(p)
    for s in todos:
        if s["nombre"].lower() == n:
            return s
    # Coincidencia laxa: el cliente dice "corte" y el servicio es "Corte de cabello".
    for s in todos:
        if n in s["nombre"].lower() or s["nombre"].lower() in n:
            return s
    return None


def _minutos(hhmm: str, por_defecto: int) -> int:
    try:
        h, m = str(hhmm).split(":")
        return int(h) * 60 + int(m)
    except Exception:
        return por_defecto


def _horario_del_dia(p, fecha: datetime) -> list[tuple[int, int]]:
    """Los tramos que se atienden ese día, en minutos desde medianoche.

    Permite el corte de almuerzo: un día puede tener dos tramos.
    """
    llaves = ["lunes", "martes", "miercoles", "jueves", "viernes", "sabado", "domingo"]
    dia = _cfg(p).get("horario", {}).get(llaves[fecha.weekday()])
    if not dia:
        return []
    tramos = dia if isinstance(dia, list) else [dia]
    salida = []
    for t in tramos:
        if not isinstance(t, dict):
            continue
        ini, fin = _minutos(t.get("desde"), -1), _minutos(t.get("hasta"), -1)
        if 0 <= ini < fin:
            salida.append((ini, fin))
    return salida


def _cerrado(fecha: datetime) -> str | None:
    """Días cerrados (festivos, vacaciones): 'YYYY-MM-DD' o {desde, hasta}."""
    dia = fecha.strftime("%Y-%m-%d")
    for c in _leer(RUTA_CIERRES, []):
        if isinstance(c, str) and c == dia:
            return "cerrado"
        if isinstance(c, dict):
            if c.get("fecha") == dia or (c.get("desde", "") <= dia <= c.get("hasta", "")):
                return c.get("motivo") or "cerrado"
    return None


def _cruces(inicio: datetime, minutos: int) -> list[dict]:
    """Citas activas que se solapan con ese intervalo.

    Se comparan intervalos completos, no horas de inicio: una cita de 45 min a
    las 8:00 bloquea las 8:30 aunque «las 8:30» no esté tomada.
    """
    fin = inicio + timedelta(minutes=minutos)
    fuera = []
    for c in citas():
        if c.get("estado") not in ACTIVAS:
            continue
        try:
            c_ini = datetime.fromisoformat(c["inicio"])
        except Exception:
            continue
        c_fin = c_ini + timedelta(minutes=int(c.get("minutos") or 30))
        if inicio < c_fin and c_ini < fin:
            fuera.append(c)
    return fuera


def _ocupado(p, inicio: datetime, minutos: int, profesional: str) -> bool:
    """¿No se puede tomar ese horario?

    Con VARIOS profesionales y sin uno pedido, el turno solo está ocupado si
    TODOS están tomados. Tratarlo como ocupado en cuanto uno lo tenga hacía que
    el bot dijera «no hay cupo» con media agenda libre — se ve enseguida en una
    clínica con dos odontólogos.

    Una cita sin profesional asignado bloquea a todos: no se sabe quién la
    atiende, así que se asume lo conservador.
    """
    cruces = _cruces(inicio, minutos)
    if not cruces:
        return False
    if profesional:
        return any(not c.get("profesional") or c["profesional"] == profesional for c in cruces)

    equipo = profesionales(p)
    if len(equipo) <= 1:
        return True
    if any(not c.get("profesional") for c in cruces):
        return True
    tomados = {c["profesional"] for c in cruces}
    return all(x in tomados for x in equipo)


def disponibilidad(p, servicio: dict, dias: int = 7, desde: datetime | None = None,
                   profesional: str = "", tope: int = 12) -> list[dict]:
    """Turnos reales que se pueden tomar. Es lo que ve el modelo."""
    tz = _tz(p)
    cfg = _cfg(p)
    ahora = datetime.now(tz)
    minutos = int(servicio.get("minutos") or cfg.get("duracion_min", 30))
    paso = int(cfg.get("paso_min", minutos))
    # No se ofrece algo para dentro de 5 minutos: nadie alcanza a llegar.
    minimo = ahora + timedelta(minutes=int(cfg.get("anticipacion_min", 60)))
    inicio_busqueda = max(desde or ahora, minimo)

    libres: list[dict] = []
    for d in range(dias + 1):
        dia = (inicio_busqueda + timedelta(days=d)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        if _cerrado(dia):
            continue
        for ini_min, fin_min in _horario_del_dia(p, dia):
            t = dia + timedelta(minutes=ini_min)
            limite = dia + timedelta(minutes=fin_min)
            while t + timedelta(minutes=minutos) <= limite:
                if t >= inicio_busqueda and not _ocupado(p, t, minutos, profesional):
                    libres.append({
                        "inicio": t.isoformat(),
                        "dia": t.strftime("%Y-%m-%d"),
                        "hora": t.strftime("%H:%M"),
                        "minutos": minutos,
                    })
                    if len(libres) >= tope:
                        return libres
                t += timedelta(minutes=paso)
    return libres


def reservar(p, *, servicio: dict, inicio_iso: str, nombre: str, telefono: str,
             conv_id: int, profesional: str = "", nota: str = "") -> dict:
    """Toma el turno. Lanza si ya no está libre.

    La verificación va DENTRO del lock y releyendo el archivo: entre que se
    mostraron los horarios y el cliente eligió pudo entrar otro.
    """
    tz = _tz(p)
    minutos = int(servicio.get("minutos") or _cfg(p).get("duracion_min", 30))
    try:
        inicio = datetime.fromisoformat(inicio_iso)
    except Exception as e:
        raise ValueError(f"fecha inválida: {inicio_iso}") from e
    if inicio.tzinfo is None:
        inicio = inicio.replace(tzinfo=tz)

    ahora = datetime.now(tz)
    if inicio <= ahora:
        raise ValueError("esa hora ya pasó")
    if _cerrado(inicio):
        raise ValueError("ese día está cerrado")
    if not _dentro_del_horario(p, inicio, minutos):
        raise ValueError("esa hora está fuera del horario de atención")

    with _lock:
        if _ocupado(p, inicio, minutos, profesional):
            raise ValueError("ese horario ya lo tomaron")
        cita = {
            "id": secrets.token_hex(3),
            "ts": time.time(),
            "estado": "agendada",
            "servicio": servicio["nombre"],
            "minutos": minutos,
            "inicio": inicio.isoformat(),
            "profesional": profesional or "",
            "nombre": (nombre or "").strip(),
            "telefono": telefono,
            "conv_id": conv_id,
            "nota": (nota or "").strip(),
            "precio": servicio.get("precio"),
        }
        todas = citas()
        todas.append(cita)
        _guardar(todas)
    return cita


def _dentro_del_horario(p, inicio: datetime, minutos: int) -> bool:
    dia = inicio.replace(hour=0, minute=0, second=0, microsecond=0)
    m_ini = inicio.hour * 60 + inicio.minute
    return any(a <= m_ini and m_ini + minutos <= b for a, b in _horario_del_dia(p, dia))


def proximas_de(telefono: str, limite: int = 3) -> list[dict]:
    """Las citas futuras de ese cliente, para cancelar o consultar."""
    ahora = datetime.now().astimezone()
    fuera = []
    for c in citas():
        if c.get("estado") not in ACTIVAS or c.get("telefono") != telefono:
            continue
        try:
            if datetime.fromisoformat(c["inicio"]) > ahora:
                fuera.append(c)
        except Exception:
            continue
    return sorted(fuera, key=lambda x: x["inicio"])[:limite]


def cancelar(cita_id: str, motivo: str = "") -> dict | None:
    with _lock:
        todas = citas()
        for c in todas:
            if c["id"] == cita_id and c.get("estado") in ACTIVAS:
                c["estado"] = "cancelada"
                c["cancelada_en"] = time.time()
                c["motivo_cancelacion"] = (motivo or "")[:200]
                _guardar(todas)
                return c
    return None


def en_texto(p, iso: str) -> str:
    """Una fecha como la diría una persona: «mañana a las 3:00 p. m.»."""
    dias = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
    meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
             "agosto", "septiembre", "octubre", "noviembre", "diciembre"]
    try:
        t = datetime.fromisoformat(iso)
    except Exception:
        return iso
    tz = _tz(p)
    if t.tzinfo is None:
        t = t.replace(tzinfo=tz)
    hoy = datetime.now(tz).date()
    delta = (t.date() - hoy).days
    if delta == 0:
        cuando = "hoy"
    elif delta == 1:
        cuando = "mañana"
    elif 2 <= delta <= 6:
        cuando = f"el {dias[t.weekday()]}"
    else:
        cuando = f"el {t.day} de {meses[t.month - 1]}"
    h = t.hour % 12 or 12
    ampm = "a. m." if t.hour < 12 else "p. m."
    return f"{cuando} a las {h}:{t.minute:02d} {ampm}"
