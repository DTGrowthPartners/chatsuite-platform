/* Botón "Mi asistente" dentro del Chatsuite del cliente.
 *
 * Lo inyecta nginx con sub_filter en el HTML del dashboard. Existe porque las
 * Dashboard Apps de Chatwoot solo aparecen dentro del panel de una conversación
 * —es límite de la feature— y la configuración del bot no depende de con quién
 * estés hablando.
 *
 * Abre /bot/config/ en una capa sobre la interfaz. Es el mismo origen, así que
 * el iframe hereda la sesión de Chatwoot y no hay segundo login.
 */
(function () {
  if (window.__configBot) return; // el dashboard es una SPA: no duplicar
  window.__configBot = true;

  // En el login no hay sesión que heredar y el iframe daría 401.
  if (location.pathname.startsWith('/app/login')) return;

  var css = ''
    + '#cfgb-boton{position:fixed;left:14px;bottom:14px;z-index:2147483000;'
    + 'display:flex;align-items:center;gap:7px;padding:9px 14px;border-radius:22px;'
    + 'border:none;background:#1f93ff;color:#fff;cursor:pointer;'
    + 'font:600 13px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    + 'box-shadow:0 2px 10px rgba(0,0,0,.25)}'
    + '#cfgb-boton:hover{background:#0d7ae0}'
    + '#cfgb-capa{position:fixed;inset:0;z-index:2147483001;display:none;background:rgba(0,0,0,.45)}'
    + '#cfgb-capa.abierta{display:block}'
    + '#cfgb-marco{position:absolute;inset:3vh 3vw;background:#fff;border-radius:10px;'
    + 'overflow:hidden;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.35)}'
    + '#cfgb-barra{display:flex;align-items:center;justify-content:space-between;'
    + 'padding:9px 14px;background:#1f2d3d;color:#fff;'
    + 'font:600 14px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
    + '#cfgb-barra button{background:none;border:none;color:#fff;font-size:20px;'
    + 'cursor:pointer;line-height:1;padding:0 4px}'
    + '#cfgb-marco iframe{flex:1;width:100%;border:0}'
    + '@media (max-width:600px){#cfgb-marco{inset:0;border-radius:0}}';

  var estilo = document.createElement('style');
  estilo.textContent = css;
  document.head.appendChild(estilo);

  var boton = document.createElement('button');
  boton.id = 'cfgb-boton';
  boton.innerHTML = '<span>🤖</span><span>Mi asistente</span>';
  boton.title = 'Configurar el asistente de WhatsApp';

  var capa = document.createElement('div');
  capa.id = 'cfgb-capa';
  capa.innerHTML = '<div id="cfgb-marco"><div id="cfgb-barra">'
    + '<span>Mi asistente · catálogo, respuestas y horarios</span>'
    + '<button type="button" title="Cerrar">&times;</button></div></div>';

  // El iframe se crea al abrir por primera vez: si no, cada pestaña del
  // dashboard pagaría la carga del configurador sin que nadie lo use.
  var marco = null;
  function abrir() {
    if (!marco) {
      marco = document.createElement('iframe');
      marco.src = '/bot/config/';
      capa.querySelector('#cfgb-marco').appendChild(marco);
    }
    capa.classList.add('abierta');
  }
  function cerrar() { capa.classList.remove('abierta'); }

  boton.onclick = abrir;
  capa.querySelector('#cfgb-barra button').onclick = cerrar;
  capa.onclick = function (e) { if (e.target === capa) cerrar(); };
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && capa.classList.contains('abierta')) cerrar();
  });

  function montar() {
    if (!document.body) return;
    document.body.appendChild(boton);
    document.body.appendChild(capa);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', montar);
  else montar();
})();
