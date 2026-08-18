# Chatsuite de {{NOMBRE}} — https://{{DOMINIO}}
# Generado por el provisioner. No editar a mano: un re-aprovisionamiento lo pisa.

RAILS_ENV=production
NODE_ENV=production
INSTALLATION_ENV=docker

SECRET_KEY_BASE={{SECRET_KEY_BASE}}

FRONTEND_URL=https://{{DOMINIO}}
DEFAULT_LOCALE=es
FORCE_SSL=true

POSTGRES_HOST=postgres
POSTGRES_USERNAME=postgres
POSTGRES_PASSWORD={{POSTGRES_PASSWORD}}
POSTGRES_DATABASE=chatwoot

REDIS_URL=redis://:{{REDIS_PASSWORD}}@redis:6379
REDIS_PASSWORD={{REDIS_PASSWORD}}

MAILER_SENDER_EMAIL={{NOMBRE}} <noreply@dtgrowthpartners.com>
SMTP_DOMAIN=dtgrowthpartners.com
SMTP_ADDRESS={{SMTP_ADDRESS}}
SMTP_PORT=587
SMTP_USERNAME={{SMTP_USERNAME}}
SMTP_PASSWORD={{SMTP_PASSWORD}}
SMTP_AUTHENTICATION=plain
SMTP_ENABLE_STARTTLS_AUTO=true
SMTP_OPENSSL_VERIFY_MODE=peer

ACTIVE_STORAGE_SERVICE=local
ENABLE_ACCOUNT_SIGNUP=false
RAILS_LOG_TO_STDOUT=true
USE_INBOX_AVATAR_FOR_BOT=true

RACK_TIMEOUT_SERVICE_TIMEOUT=0

# La version de Graph se fija aqui porque el default de Chatwoot se queda atras
# y Meta retira versiones viejas cada ~2 anios.
WHATSAPP_API_VERSION=v22.0

COMPOSE_PROJECT_NAME=chatsuite_{{SLUG}}
