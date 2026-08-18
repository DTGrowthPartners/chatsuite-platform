"""Secretos y rutas. Todo lo demás vive en perfil.json.

Un proceso por cliente: `CHATSUITE_BOT_PERFIL` apunta al directorio del tenant
(/srv/chatsuite/<slug>/bot), y de ahí salen el perfil, los datos y el .env.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

RAIZ_PERFIL = Path(os.getenv("CHATSUITE_BOT_PERFIL", "/srv/chatsuite/demo/bot")).resolve()
RAIZ_MOTOR = Path(__file__).resolve().parent.parent

load_dotenv(RAIZ_PERFIL / ".env")

DATA = RAIZ_PERFIL / "data"
PROMPTS = RAIZ_PERFIL / "prompts"
DATA.mkdir(parents=True, exist_ok=True)


class Secretos:
    """Solo credenciales. Cambiarlas sí exige reiniciar, y está bien."""

    # Chatsuite. El token del Agent Bot escribe mensajes; el de lectura es de un
    # usuario agente y hace falta para el historial Y para las etiquetas: con el
    # del bot los dos dan 401, en silencio.
    chatwoot_url = os.getenv("CHATWOOT_URL", "").rstrip("/")
    account_id = os.getenv("CHATWOOT_ACCOUNT_ID", "1")
    bot_token = os.getenv("CHATWOOT_BOT_TOKEN", "")
    read_token = os.getenv("CHATWOOT_READ_TOKEN", "")

    # Claude vía Darío. OJO con el puerto: un BASE_URL viejo da 401 silencioso.
    dario_url = os.getenv("DARIO_URL", "http://127.0.0.1:3457")

    # Evolution (canal evolution)
    evolution_url = os.getenv("EVOLUTION_URL", "")
    evolution_apikey = os.getenv("EVOLUTION_APIKEY", "")

    # Meta Graph (canal cloud_api: plantillas y avisos al equipo)
    meta_token = os.getenv("META_SYSTEM_USER_TOKEN", "")
    meta_phone_id = os.getenv("META_PHONE_NUMBER_ID", "")

    # El número del propio bot, para no avisarse a sí mismo.
    bot_numero = os.getenv("BOT_NUMERO", "")

    # 3200 es el panel: un default ahi haria que un bot mal lanzado chocara con el.
    puerto = int(os.getenv("PORT", "3310"))


secretos = Secretos()
