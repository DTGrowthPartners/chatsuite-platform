"""El canal de WhatsApp: Evolution o Cloud API, detrás de una sola interfaz.

Este es el módulo que hace que soportar los dos canales no cueste dos bots. El
resto del motor llama siempre a las mismas funciones y acá se decide qué hacer
según `perfil.canal`, que se relee en caliente.

Lo que cambia de verdad entre canales:

| | Evolution | Cloud API |
|---|---|---|
| "escribiendo…" | sí (sendPresence) | no existe |
| acuses de entrega | los vemos, y frenan | los recibe Chatwoot, no nosotros |
| reconexión / QR | hay sesión que se cae | no hay sesión |
| ventana de 24 h | no aplica | aplica, con plantillas |
| grupos | sí | no, y no hay parche |

⚠️ LA TRAMPA QUE YA NOS COSTÓ UN BOT MUDO: el freno por acuses exige acuses.
Si el canal quedó en `evolution` pero nadie nos está reenviando los acuses, el
freno se dispara solo a los ~8 minutos y CONGELA todos los salientes sin que
nada parezca roto. Acá eso no puede pasar: sin al menos un acuse registrado en
toda la vida del proceso, el freno no congela — avisa y sigue.
"""
import asyncio
import logging
import time
from collections import deque

import httpx

from . import estado, perfil as perfil_mod, plantillas
from .config import secretos

log = logging.getLogger("chatsuite-bot")

# Sin acuses durante este lapso, con envíos de por medio → congelar salientes.
_SIN_ACUSE = 8 * 60
_ENVIOS_MINIMOS = 3

_ultimo_estado: str | None = None
_envios: deque[float] = deque(maxlen=200)
_ultimo_acuse: float = time.time()
_acuses_vistos: int = 0
_congelado: bool = False


def es_evolution() -> bool:
    return perfil_mod.actual().canal == "evolution"


def es_cloud() -> bool:
    return perfil_mod.actual().canal == "cloud_api"


def acepta_grupos() -> bool:
    """Cloud API no entrega grupos y no hay forma de cambiarlo."""
    return es_evolution()


# ── Envíos y acuses ─────────────────────────────────────────────────────────

def registrar_envio() -> None:
    _envios.append(time.time())


def registrar_acuse() -> None:
    """Un DELIVERY_ACK/READ de cualquier mensaje nuestro: el canal entrega."""
    global _ultimo_acuse, _congelado, _acuses_vistos
    _ultimo_acuse = time.time()
    _acuses_vistos += 1
    if _congelado:
        _congelado = False
        log.warning("los acuses volvieron: se descongelan los salientes")


def congelado() -> bool:
    """¿Hay que abstenerse de enviar por sospecha de sanción?

    Solo tiene sentido en Evolution. En Cloud API no vemos los acuses, así que
    su ausencia no significa nada: devolver True acá apagaría el bot de mentira.
    """
    if not es_evolution():
        return False
    return _congelado


def _destino_jid(telefono: str) -> str:
    """Los LID (14+ dígitos, número oculto) SOLO entregan por @lid. Mandarle a
    @s.whatsapp.net a una cuenta LID falla mudo — es el bug que tuvo cantina."""
    digitos = estado.normalizar(telefono)
    dominio = "lid" if len(digitos) > 13 else "s.whatsapp.net"
    return f"{digitos}@{dominio}"


async def escribiendo(telefono: str, segundos: float) -> None:
    """Muestra "escribiendo…" durante `segundos`. Best-effort.

    En Cloud API no hay presencia: las pausas de tipeo se respetan igual (el bot
    sigue esperando antes de responder), lo único que se pierde es el indicador.
    """
    if not es_evolution():
        return
    p = perfil_mod.actual()
    instancia = p.get("canal.evolution.instancia", "")
    url = p.get("canal.evolution.url") or secretos.evolution_url
    digitos = estado.normalizar(telefono)
    if not (instancia and url and digitos):
        return
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(max(10.0, segundos + 5))) as c:
            await c.post(
                f"{url}/chat/sendPresence/{instancia}",
                headers={"apikey": secretos.evolution_apikey},
                json={
                    "number": _destino_jid(telefono),
                    "presence": "composing",
                    "delay": int(segundos * 1000),
                },
            )
    except Exception:
        log.debug("sendPresence falló para %s (best-effort)", digitos)


# ── Tráfico proactivo y ventana de 24 h ─────────────────────────────────────

async def bloquea_proactivo(conv_id: int, telefono: str, historial: list[dict]) -> tuple[bool, str]:
    """¿Hay que abstenerse de mandar texto libre a esta conversación?

    El tráfico proactivo (reenganches, barridos) le escribe primero a alguien
    que quizá lleva días callado, que es justo donde la ventana suele estar
    vencida. Devuelve (bloqueado, explicación_para_la_nota).

    En Evolution nunca bloquea: no hay ventana.
    """
    if not es_cloud():
        return False, ""

    if plantillas.ventana_abierta(historial):
        return False, ""

    p = perfil_mod.actual()
    horas = plantillas.horas_desde_ultimo(historial)
    detalle = f"{horas:.0f} h" if horas else "sin mensajes del cliente"
    plantilla = p.get("canal.cloud_api.plantilla_reenganche", "")

    if not plantilla:
        return True, f"ventana cerrada ({detalle}) y sin plantilla de reenganche configurada"

    digitos = estado.normalizar(telefono)
    if not (10 <= len(digitos) <= 13):
        # Identidad sin teléfono real: la plantilla no puede citar nada, que es
        # lo único que hace que Meta resuelva esas identidades. No hay vía.
        return True, f"ventana cerrada ({detalle}) y el contacto no tiene teléfono real"

    ok = await plantillas.enviar(
        digitos, plantilla, p.get("canal.cloud_api.plantilla_reenganche_idioma", "es")
    )
    return True, (
        f"Pasaron {detalle} desde el último mensaje del cliente, así que no se podía escribir "
        f"texto libre. Se {'envió' if ok else 'intentó enviar (falló)'} la plantilla "
        f"«{plantilla}». Cuando el cliente conteste se reabre la ventana y el bot sigue normal."
    )


# ── Vigilancia del canal ────────────────────────────────────────────────────

async def _estado_evolution() -> str | None:
    p = perfil_mod.actual()
    url = p.get("canal.evolution.url") or secretos.evolution_url
    instancia = p.get("canal.evolution.instancia", "")
    if not (url and instancia):
        return None
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as c:
            r = await c.get(
                f"{url}/instance/connectionState/{instancia}",
                headers={"apikey": secretos.evolution_apikey},
            )
            r.raise_for_status()
            return ((r.json().get("instance") or {}).get("state")) or None
    except Exception:
        return None


async def vigilar(al_reconectar, avisar) -> None:
    """Bucle de fondo (60 s). Solo hace algo con Evolution.

    Dos trabajos: detectar la reconexión (caída → open) para entrar en
    convalecencia y disparar el barrido en goteo; y el freno por acuses.
    """
    global _ultimo_estado, _congelado
    while True:
        try:
            if es_evolution():
                s = await _estado_evolution()
                if s:
                    if s == "open" and _ultimo_estado not in (None, "open"):
                        estado.iniciar_convalecencia(48)
                        _congelado = False
                        globals()["_ultimo_acuse"] = time.time()
                        log.warning("canal reconectado: convalecencia 48 h")
                        await avisar(
                            "reconexion",
                            "La sesión de WhatsApp volvió. El bot entra en convalecencia por "
                            "48 horas: ritmo reducido, tandas de fotos cortas y sin reenganches. "
                            "Lo que quedó esperando se responderá en goteo.",
                        )
                        asyncio.create_task(al_reconectar())
                    _ultimo_estado = s

                ahora = time.time()
                recientes = sum(1 for t in _envios if ahora - t < _SIN_ACUSE)
                if (
                    not _congelado
                    and _ultimo_estado == "open"
                    and recientes >= _ENVIOS_MINIMOS
                    and ahora - _ultimo_acuse > _SIN_ACUSE
                ):
                    if _acuses_vistos == 0:
                        # Nadie nos está reenviando acuses: el silencio no
                        # significa sanción, significa que el cable no está
                        # conectado. Congelar acá dejaría el bot mudo sin que
                        # nada pareciera roto — el bug que ya pagamos una vez.
                        log.warning(
                            "sin acuses y sin haber visto NINGUNO: el reenvío de acuses no "
                            "está conectado. NO se congela; revisar el puente de acuses."
                        )
                    else:
                        _congelado = True
                        log.error("%s envíos sin acuse en %s min: salientes CONGELADOS",
                                  recientes, _SIN_ACUSE // 60)
                        await avisar(
                            "sin_acuses",
                            f"Los últimos {recientes} mensajes no recibieron acuse de entrega "
                            "(posible sanción silenciosa). El bot congeló sus envíos para no "
                            "agravarla. Se descongela solo cuando vuelva a llegar un acuse.",
                        )
        except Exception:
            log.exception("vigilancia del canal: fallo en el ciclo")
        await asyncio.sleep(60)


def diagnostico() -> dict:
    return {
        "canal": perfil_mod.actual().canal,
        "estado_sesion": _ultimo_estado,
        "congelado": congelado(),
        "acuses_vistos": _acuses_vistos,
        "envios_ultima_hora": sum(1 for t in _envios if time.time() - t < 3600),
    }
