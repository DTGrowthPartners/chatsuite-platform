"""Arranque del bot de un cliente.

    CHATSUITE_BOT_PERFIL=/srv/chatsuite/<slug>/bot PORT=3210 python ejecutar.py

Un proceso por cliente: aísla (si uno se cae, se cae uno solo) y cuesta ~80 MB
contra los 1.1 GB del Chatsuite del mismo cliente, así que no mueve la aguja.
"""
import logging

import uvicorn

from motor.config import secretos

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

if __name__ == "__main__":
    uvicorn.run("motor.api:app", host="127.0.0.1", port=secretos.puerto, log_level="info")
