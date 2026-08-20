# Chatsuite de {{NOMBRE}} — {{DOMINIO}}
# Generado por el provisioner. No editar a mano.
#
# Se escribe SIN el bloque TLS: certbot --nginx lo agrega al emitir el
# certificado y ademas crea la redireccion de 80 a 443. Escribirlo aqui de
# antemano haria fallar el reload, porque el certificado todavia no existe.

server {
    listen 80;
    listen [::]:80;
    server_name {{DOMINIO}};

    # Adjuntos: Chatwoot acepta hasta 40MB por archivo, con margen para el
    # sobre multipart.
    client_max_body_size 50m;

    # Chatwoot manda cabeceras con guion bajo (api_access_token). nginx las
    # descarta por defecto y el inbox de API deja de autenticar.
    underscores_in_headers on;

    # Bloques que se agregan despues del alta (hoy: el bot). Van en archivos
    # aparte a proposito: reescribir este sitio para sumar un location borraria
    # el bloque TLS que certbot le agrego, y el dominio quedaria sin HTTPS
    # hasta la siguiente emision.
    include /srv/chatsuite/{{SLUG}}/nginx-extra/*.conf;


    # La marca del cliente entra por bind-mount y se puede regenerar en caliente:
    # cambiar el logo, corregir el color. Rails sirve estos estaticos con
    # `max-age` de UN AÑO y sin ETag, asi que el navegador se quedaba con la
    # version vieja para siempre — el archivo en disco cambiaba y en pantalla no
    # pasaba nada, que parece que el cambio no se aplico.
    #
    # Con revalidacion el navegador pregunta cada vez y Rails contesta 304 si no
    # cambio, asi que no cuesta ancho de banda: solo un viaje condicional.
    location /brand-assets/ {
        proxy_pass http://127.0.0.1:{{PUERTO}};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_hide_header Cache-Control;
        add_header Cache-Control "public, max-age=0, must-revalidate" always;
    }

    location / {
        proxy_pass http://127.0.0.1:{{PUERTO}};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # ActionCable va por WebSocket: sin estas dos, el dashboard carga pero
        # los mensajes no llegan en vivo y hay que refrescar a mano.
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_read_timeout 300s;
        proxy_connect_timeout 10s;
    }
}
