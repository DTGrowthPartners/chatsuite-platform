# Arranque en limpio de un Chatsuite. Generado por el provisioner.
#
#   docker exec -i cs_<slug>-rails-1 bundle exec rails runner /app/bootstrap.rb
#
# Corre una sola vez despues del primer `docker compose up -d`, cuando la base
# ya migro pero no hay cuenta ni usuarios. Reemplaza al asistente de
# /installation/onboarding, que ademas deja una llave en Redis que habria que
# borrar aparte.
#
# Es idempotente: se puede repetir sin duplicar cuenta ni usuario, que es lo que
# permite reintentar un aprovisionamiento a medias.

CLAVE_ADMIN = ENV.fetch('CHATSUITE_ADMIN_PASSWORD')
CLAVE_SUPER = ENV.fetch('CHATSUITE_SUPERADMIN_PASSWORD')
NOMBRE      = ENV.fetch('CHATSUITE_NOMBRE')
EMAIL_ADMIN = ENV.fetch('CHATSUITE_ADMIN_EMAIL')
EMAIL_SUPER = ENV.fetch('CHATSUITE_SUPERADMIN_EMAIL')
COLOR       = ENV.fetch('CHATSUITE_COLOR')
# La marca puede diferir del nombre del cliente: muchos operan con razon social
# por un lado y nombre comercial por otro, y lo que el cliente ve es la marca.
MARCA       = ENV.fetch('CHATSUITE_MARCA', NOMBRE)
# Sitio del cliente. Alimenta BRAND_URL y los enlaces de terminos y privacidad,
# que por defecto apuntaban al propio dashboard (un enlace a ninguna parte).
SITIO       = ENV.fetch('CHATSUITE_SITIO', '')
IDIOMA      = ENV.fetch('CHATSUITE_LOCALE', 'es')

# --- Cuenta y usuario administrador -----------------------------------------
cuenta = Account.find_by(name: NOMBRE) || Account.create!(name: NOMBRE, locale: IDIOMA)
cuenta.update!(locale: IDIOMA) if cuenta.locale != IDIOMA

usuario = User.find_by(email: EMAIL_ADMIN)
if usuario.nil?
  usuario = User.new(
    name: "Admin #{NOMBRE}",
    display_name: 'Admin',
    email: EMAIL_ADMIN,
    password: CLAVE_ADMIN,
    password_confirmation: CLAVE_ADMIN
  )
  usuario.skip_confirmation!
  usuario.save!
else
  usuario.update!(password: CLAVE_ADMIN, password_confirmation: CLAVE_ADMIN)
end

AccountUser.find_or_create_by!(account_id: cuenta.id, user_id: usuario.id) do |au|
  au.role = :administrator
end

# --- Super admin (panel /super_admin) ---------------------------------------
# STI sobre la tabla users: sin `name` explota con NotNullViolation.
super_admin = SuperAdmin.find_by(email: EMAIL_SUPER)
if super_admin.nil?
  SuperAdmin.create!(
    name: "Super Admin #{NOMBRE}",
    email: EMAIL_SUPER,
    password: CLAVE_SUPER,
    password_confirmation: CLAVE_SUPER
  )
else
  super_admin.update!(password: CLAVE_SUPER, password_confirmation: CLAVE_SUPER)
end

# --- Identidad de marca ------------------------------------------------------
# Solo va aqui lo que NO puede salir de brand-assets/: nombres, URLs y el color
# de los <meta>, que el navegador lee antes de cualquier hoja de estilos. Los
# logos y el color del producto entran por el bind-mount, sin tocar la base.
#
# INSTALLATION_NAME lo consume `replaceInstallationName`: cambia el titulo de la
# pestaña y las decenas de textos de i18n que dicen "Chatwoot".
#
# Los tres CHATWOOT_SUPPORT_* se vacian a proposito: alimentan el widget de
# soporte del propio Chatwoot, que si no aparece flotando dentro del dashboard
# del cliente.
sitio = SITIO.empty? ? "https://#{ENV.fetch('CHATSUITE_DOMINIO')}" : SITIO
marca = {
  'INSTALLATION_NAME' => MARCA,
  'BRAND_NAME' => MARCA,
  'BRAND_COLOR' => COLOR,
  'BRAND_URL' => sitio,
  'WIDGET_BRAND_URL' => sitio,
  'LOGO' => '/brand-assets/logo.svg',
  'LOGO_DARK' => '/brand-assets/logo_dark.svg',
  'LOGO_THUMBNAIL' => '/brand-assets/logo_thumbnail.svg',
  'TERMS_URL' => sitio,
  'PRIVACY_URL' => sitio,
  'DISPLAY_MANIFEST' => true,
  'CHATWOOT_SUPPORT_WEBSITE_TOKEN' => '',
  'CHATWOOT_SUPPORT_SCRIPT_URL' => '',
  'CHATWOOT_SUPPORT_IDENTIFIER_HASH' => '',
  'CHATWOOT_INSTANCE_ADMIN_EMAIL' => EMAIL_SUPER,
}

marca.each do |nombre, valor|
  config = InstallationConfig.find_or_initialize_by(name: nombre)
  config.value = valor
  config.locked = false
  config.save!
end
GlobalConfig.clear_cache

# --- Cerrar el asistente de instalacion ---------------------------------------
# Sin esto, TODA ruta del dashboard responde 302 a /installation/onboarding y el
# Chatsuite parece roto aunque la cuenta, el admin y la marca ya esten listos.
#
# La condicion vive en DashboardController#ensure_installation_onboarding y mira
# una llave de Redis, no la base: por eso crear la cuenta no la limpia sola y
# hay que borrarla explicitamente.
Redis::Alfred.delete(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)

puts "ONBOARDING_CERRADO=#{Redis::Alfred.get(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING).nil?}"
puts "CUENTA_ID=#{cuenta.id}"
puts "USUARIO_ID=#{usuario.id}"
puts "TOKEN=#{usuario.access_token.token}"
puts "INSTALLATION_NAME=#{InstallationConfig.find_by(name: 'INSTALLATION_NAME').value}"
