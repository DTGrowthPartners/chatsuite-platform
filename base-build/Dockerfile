# chatsuite:base — imagen unica para TODOS los Chatsuite de clientes.
#
# Parte de chatwoot:dtgp (Chatwoot 4.13.0 + pantallas de sesion + parche v26 de
# WhatsApp Cloud API) y le quita la marca horneada, que es lo que hoy obliga a
# construir una imagen de ~4 GB por cliente.
#
#   docker build -t chatsuite:base /home/ubuntu/chatsuite-platform/base-build
#
# Despues de este build, la identidad de un cliente entra montando su directorio
# sobre /app/public/brand-assets/ — sin build, sin reiniciar nada mas que su
# propio contenedor:
#
#   volumes:
#     - /srv/chatsuite/<slug>/brand:/app/public/brand-assets:ro
#
# Ese directorio debe traer los 9 archivos que el layout y los .vue esperan:
#   brand.css  sidebar-logo.png  watermark.png
#   logo.svg  logo_dark.svg  logo_thumbnail.svg
#   favicon-16x16.png  favicon-32x32.png  favicon-96x96.png
# (favicon-512x512.png es opcional: lo referencia InstallationConfig
# LOGO_THUMBNAIL, no el layout.)
#
# NO reemplaza a chatwoot:dtgp ni a chatwoot:compuxtreme: esas siguen sirviendo
# a tubodega, maria y compuxtreme tal cual estan.

FROM chatwoot:dtgp

USER root
WORKDIR /app

# 1) El color de marca deja de ser un valor fijo y pasa a variable CSS.
#    `brand` alimenta las clases n-brand de Tailwind (botones, enlaces, item
#    activo del sidebar, foco). Con el hex, el color queda compilado en 253
#    lugares de 8 archivos CSS y cambiarlo exige recompilar Vite.
#
#    La sintaxis `rgb(var(--brand-rgb) / <alpha-value>)` es la de Tailwind 3.4:
#    el placeholder <alpha-value> es lo que permite que sigan funcionando las
#    variantes con opacidad (hover, disabled, anillos de foco). Sin el, Tailwind
#    emite el color solido y esos estados se ven mal.
#
#    theme/colors.js lo importa UNICAMENTE tailwind.config.js — ningun JS lee
#    estos valores en runtime, asi que el cambio no puede romper el dashboard.
#
#    El delimitador de sed es | porque el valor nuevo contiene /.
RUN sed -i "s|brand: '#007FFC',|brand: 'rgb(var(--brand-rgb) / <alpha-value>)',|" /app/theme/colors.js \
 && grep -q "brand: 'rgb(var(--brand-rgb) / <alpha-value>)'," /app/theme/colors.js

# 2) Logo del sidebar y marca de agua del panel vacio: de asset de Vite a
#    estatico de public/.
#
#    OJO con la forma: tiene que ser un binding dinamico (:src con la ruta como
#    literal), NO un src plano. El compilador de plantillas de Vue reescribe
#    todo src="..." estatico como un import, y lo hace tambien cuando la ruta
#    empieza por / — el build muere con "Rollup failed to resolve import
#    /brand-assets/sidebar-logo.png". Con :src la expresion se evalua en
#    runtime, Rollup no la ve, y el navegador pide el archivo a Rails desde
#    public/ — que es justo lo que el bind-mount del tenant reemplaza.
RUN sed -i "s|src=\"dashboard/assets/images/dtgp-logo.png\"|:src=\"'/brand-assets/sidebar-logo.png'\"|" \
      /app/app/javascript/dashboard/components-next/sidebar/Sidebar.vue \
 && grep -q ":src=\"'/brand-assets/sidebar-logo.png'\"" \
      /app/app/javascript/dashboard/components-next/sidebar/Sidebar.vue \
 && sed -i "s|src=\"dashboard/assets/images/dtgp-watermark.png\"|:src=\"'/brand-assets/watermark.png'\"|" \
      /app/app/javascript/dashboard/components/widgets/conversation/EmptyState/EmptyStateMessage.vue \
 && grep -q ":src=\"'/brand-assets/watermark.png'\"" \
      /app/app/javascript/dashboard/components/widgets/conversation/EmptyState/EmptyStateMessage.vue

# 3) El texto alternativo del logo nombraba a DTGP, y en un Chatsuite de cliente
#    eso se filtra a lectores de pantalla y al tooltip de imagen rota. Queda
#    vacio a proposito: es decorativo, el nombre de la cuenta ya esta al lado.
RUN sed -i 's|alt="Chatsuite by DT Growth Partners"|alt=""|' \
      /app/app/javascript/dashboard/components-next/sidebar/Sidebar.vue \
 && ! grep -q 'DT Growth Partners' /app/app/javascript/dashboard/components-next/sidebar/Sidebar.vue

# 3b) Pantallas de sesion (login, signup, reset): son las unicas que no pasan
#     por la paleta de Tailwind. Las agrego DTGP con su propio mini sistema de
#     variables y el azul horneado, asi que sin este paso un cliente entra a su
#     Chatsuite y lo primero que ve es el azul de DTGP.
#
#     --dtgp-blue vive dentro de .dtgp-auth, pero --brand-rgb esta en :root y se
#     hereda, asi que la referencia resuelve. En el degradado del login se usan
#     las variables de :root directamente en vez de --dtgp-blue: ese bloque
#     puede renderizarse fuera de .dtgp-auth y con --dtgp-blue quedaria sin
#     valor. El fallback de --brand-accent-rgb cubre a un tenant cuyo brand.css
#     sea viejo y solo traiga --brand-rgb.
RUN sed -i \
      -e 's|--dtgp-blue: #007ffc;|--dtgp-blue: rgb(var(--brand-rgb));|' \
      -e 's|--dtgp-cyan: #26bdf0;|--dtgp-cyan: rgb(var(--brand-accent-rgb, var(--brand-rgb)));|' \
      /app/app/javascript/v3/App.vue \
 && grep -q -- '--dtgp-blue: rgb(var(--brand-rgb));' /app/app/javascript/v3/App.vue \
 && grep -q -- '--dtgp-cyan: rgb(var(--brand-accent-rgb' /app/app/javascript/v3/App.vue \
 && sed -i \
      's|background: linear-gradient(100deg, #007ffc, #26bdf0);|background: linear-gradient(100deg, rgb(var(--brand-rgb)), rgb(var(--brand-accent-rgb, var(--brand-rgb))));|' \
      /app/app/javascript/v3/views/login/Index.vue \
 && grep -q 'linear-gradient(100deg, rgb(var(--brand-rgb))' /app/app/javascript/v3/views/login/Index.vue

# 4) Quien escribio cada mensaje, a la vista en el globo.
#
#    Chatwoot ya distingue bot de humano por dentro (sender.type) y pinta el
#    avatar, pero no escribe el nombre en ninguna parte. Con un usuario
#    compartido eso daba igual; con varios asesores, saber si contesto el bot,
#    Ana o Beto es exactamente lo que hace falta ver.
#
#    Va ANTES del precompile —al reves que patch_layout.rb— porque toca un .vue
#    y eso lo empaqueta Vite. Ponerlo despues no tendria ningun efecto visible.
COPY patches/patch_autor.rb /tmp/patch_autor.rb
RUN ruby /tmp/patch_autor.rb \
 && grep -q 'chatsuite-autor' \
      /app/app/javascript/dashboard/components-next/message/MessageMeta.vue \
 && rm /tmp/patch_autor.rb

# 5) Marca por defecto (la de DTGP). Sirve para que la imagen arranque sola sin
#    montaje, y como plantilla de lo que el provisioner genera por cliente.
COPY brand-assets/ /app/public/brand-assets/

# 6) Recompilar Vite: los pasos 1-3 tocan fuentes que se empaquetan.
#    La imagen base borro node_modules despues de su build, hay que reinstalar;
#    pnpm standalone ya viene en /usr/local/bin desde chatwoot:branded.
RUN pnpm install --frozen-lockfile --prefer-offline \
 && SECRET_KEY_BASE_DUMMY=1 RAILS_ENV=production \
    bundle exec rake assets:precompile \
 && pnpm store prune \
 && rm -rf /app/node_modules /root/.cache /tmp/*

# 6b) Favicons, meta de color y el <link> a brand.css.
#     Va DESPUES del precompile a proposito: el layout es ERB que renderiza
#     Rails, Vite no lo empaqueta, y ponerlo antes hacia que cada ajuste al
#     parche invalidara la capa de assets:precompile, que son ~8 minutos.
COPY patches/patch_layout.rb /tmp/patch_layout.rb
RUN ruby /tmp/patch_layout.rb \
 && grep -q 'brand-assets/brand.css' /app/app/views/layouts/vueapp.html.erb \
 && grep -q 'brand-assets/favicon-32x32.png' /app/app/views/layouts/vueapp.html.erb \
 && rm /tmp/patch_layout.rb

# 7) Red de seguridad: si el precompile volvio a hornear un hex en lugar de la
#    variable, el build falla aqui y no publica una imagen que ignora brand.css.
RUN test "$(grep -rl 'var(--brand-rgb)' /app/public/vite/assets/*.css | wc -l)" -gt 0 \
 || (echo 'ERROR: --brand-rgb no quedo en el CSS compilado' && exit 1)

# 8) Y que el CSS que el manifiesto REALMENTE sirve no conserve el azul de DTGP.
#    Solo se miran los archivos referenciados: /app/public/vite/assets/ arrastra
#    huerfanos de los builds padres que nadie sirve, y mirarlos daria un falso
#    positivo permanente.
RUN for css in $(grep -o '"file":"assets/[^"]*\.css"' /app/public/vite/.vite/manifest.json \
                  | sed 's|.*"assets/|/app/public/vite/assets/|; s|"$||' | sort -u); do \
      if grep -qi '#007ffc' "$css"; then \
        echo "ERROR: $css todavia trae el azul de DTGP horneado"; exit 1; \
      fi; \
    done && echo 'OK: ningun CSS servido conserva el color de DTGP'
