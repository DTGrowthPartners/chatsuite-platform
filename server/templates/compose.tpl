# Chatsuite de {{NOMBRE}} — https://{{DOMINIO}}
# Generado por el provisioner. No editar a mano.
#
# OJO: COMPOSE_PROJECT_NAME (en .env) define el nombre de los volumenes.
# Cambiarlo despues de tener datos crea volumenes NUEVOS Y VACIOS sin avisar.
services:
  postgres:
    image: pgvector/pgvector:pg16
    restart: unless-stopped
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: chatwoot
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

  redis:
    image: redis:alpine
    restart: unless-stopped
    command: ["sh", "-c", "redis-server --requirepass \"$REDIS_PASSWORD\""]
    env_file: .env
    volumes:
      - redis_data:/data

  # Ancla YAML compartida. docker compose igual le crea un contenedor -base-1
  # que queda Exited; el provisioner lo borra despues del primer arranque.
  base: &base
    image: chatsuite:base
    env_file: .env
    volumes:
      - storage_data:/app/storage
      # La identidad del cliente entra por aqui: logos, favicons y brand.css.
      # De solo lectura a proposito — la app nunca deberia escribir su marca.
      - ./brand:/app/public/brand-assets:ro
    depends_on:
      - postgres
      - redis

  rails:
    <<: *base
    restart: unless-stopped
    ports:
      - "127.0.0.1:{{PUERTO}}:3000"
    entrypoint: docker/entrypoints/rails.sh
    command: ["bundle", "exec", "rails", "s", "-p", "3000", "-b", "0.0.0.0"]

  sidekiq:
    <<: *base
    restart: unless-stopped
    command: ["bundle", "exec", "sidekiq", "-C", "config/sidekiq.yml"]

volumes:
  postgres_data:
  redis_data:
  storage_data:
