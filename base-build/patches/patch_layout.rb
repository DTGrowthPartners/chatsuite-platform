# Hace que la identidad visual del layout salga de /brand-assets/, no de la imagen.
#
# Corre dentro del build de chatsuite:base sobre app/views/layouts/vueapp.html.erb.
#
# Los favicons y el color de la barra del navegador estan hardcodeados en el
# layout de upstream. Mientras vivan ahi, cambiarlos por cliente obliga a
# reconstruir la imagen. Este parche los reapunta al directorio que cada tenant
# monta, y de paso engancha brand.css, que es donde viene --brand-rgb.
#
# Aborta si un ancla no aparece: es preferible romper el build a publicar una
# imagen que silenciosamente se quedo con la marca de DTGP.

RUTA = '/app/app/views/layouts/vueapp.html.erb'

html = File.read(RUTA)
original = html.dup

def exigir(condicion, mensaje)
  return if condicion

  abort("patch_layout: #{mensaje} — upstream cambio el layout, revisar a mano")
end

# 1) Favicons -> al directorio montado.
#    Se listan explicitos en vez de una regex sobre /favicon-*: el layout tambien
#    trae apple-icon-* y android-icon-*, que no generamos por cliente y deben
#    seguir saliendo de la imagen.
%w[16x16 32x32 96x96].each do |tam|
  viejo = %(href="/favicon-#{tam}.png")
  exigir(html.include?(viejo), "no encontre el favicon #{tam}")
  html = html.gsub(viejo, %(href="/brand-assets/favicon-#{tam}.png"))
end

# 2) Color de la barra del navegador y del tile de Windows.
#    Es el unico color de marca que no puede salir de una variable CSS: son
#    <meta>, y el navegador los lee antes de aplicar hoja de estilos alguna.
#    Por eso van por InstallationConfig, que el tenant setea en su bootstrap.
%w[msapplication-TileColor theme-color].each do |meta|
  viejo = %(<meta name="#{meta}" content="#1f93ff">)
  exigir(html.include?(viejo), "no encontre el meta #{meta}")
  # Se usa GlobalConfig.get_value y no @global_config: ese hash lo arma
  # DashboardController con una lista blanca fija (GLOBAL_CONFIG_KEYS) que no
  # incluye BRAND_COLOR, asi que ahi siempre llegaria nil y el color caeria al
  # fallback. get_value lee el mismo InstallationConfig con la misma cache.
  nuevo = %(<meta name="#{meta}" content="<%= GlobalConfig.get_value('BRAND_COLOR').presence || '#1f93ff' %>">)
  html = html.gsub(viejo, nuevo)
end

# 3) brand.css, despues de los tags de Vite.
#    El orden importa: si entrara antes, cualquier :root que emita el bundle de
#    Vite ganaria por ser posterior y --brand-rgb quedaria en el valor por
#    defecto de la imagen.
ancla = '<%= vite_javascript_tag @application_pack %>'
exigir(html.include?(ancla), 'no encontre el vite_javascript_tag')
exigir(html.scan(ancla).size == 1, 'el vite_javascript_tag aparece mas de una vez')
html = html.sub(ancla, %(#{ancla}\n    <link rel="stylesheet" href="/brand-assets/brand.css">))

exigir(html != original, 'el layout quedo identico')

File.write(RUTA, html)
puts 'patch_layout: favicons, meta de color y brand.css reapuntados a /brand-assets/'
