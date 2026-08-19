# Evolution API de {{NOMBRE}} — el canal de WhatsApp por QR.
# Generado por el provisioner. No editar a mano.
#
# UNO POR CLIENTE, no compartido. Dos razones:
#
# 1. `CHATWOOT_IMPORT_DATABASE_CONNECTION_URI` es GLOBAL por Evolution, no por
#    instancia: un Evolution compartido solo podria importar el historial de un
#    cliente. Con uno propio, cada cliente importa el suyo.
# 2. Aislamiento. Una sancion o una caida en el numero de un cliente no toca a
#    los demas. Es la misma decision que se tomo para CompuXtreme.
#
# Cuesta ~190 MB por cliente (api 137 + postgres 47 + redis 5).
#
# Imagen con el parche de LID: sin el, los mensajes de cuentas con numero oculto
# se pierden al espejarse a Chatsuite. HAY QUE REHACER EL PARCHE EN CADA UPGRADE.
services:
  api:
    container_name: evo_{{SLUG}}_api
    image: {{IMAGEN}}
    restart: unless-stopped
    depends_on:
      - evo-redis
      - evo-postgres
    ports:
      - "127.0.0.1:{{PUERTO}}:8080"
    volumes:
      - instancias:/evolution/instances
    env_file: .env
    networks:
      - default
      # La segunda red es para hablarle al postgres del Chatsuite por nombre de
      # contenedor, que es como llega el import de historial.
      - chatsuite

  # OJO CON LOS NOMBRES: este contenedor esta en DOS redes, y la del Chatsuite
  # tiene servicios llamados `postgres` y `redis`. Con esos nombres, Evolution
  # resolvia al POSTGRES DEL CLIENTE (fallaba la autenticacion) y su redis
  # habria escrito en la cache del Chatsuite. Por eso el prefijo `evo-`.
  evo-redis:
    container_name: evo_{{SLUG}}_redis
    image: redis:alpine
    restart: unless-stopped
    command: ["redis-server", "--port", "6379", "--appendonly", "yes"]
    volumes:
      - redis:/data
    networks:
      - default

  evo-postgres:
    container_name: evo_{{SLUG}}_postgres
    image: postgres:15
    restart: unless-stopped
    command: ["postgres", "-c", "max_connections=100"]
    environment:
      POSTGRES_DB: evolution_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres:/var/lib/postgresql/data
    networks:
      - default

volumes:
  instancias:
  redis:
  postgres:

networks:
  default:
  chatsuite:
    external: true
    name: cs_{{SLUG}}_default
