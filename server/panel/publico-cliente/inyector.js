/* Botón "Mi asistente" dentro del Chatsuite del cliente.
 *
 * OJO: esto es una plantilla, no un estático. Lo sirve el panel sustituyendo
 * {{COLOR}} y {{TEXTO}} por la marca del cliente, así que abrirlo tal cual
 * desde disco muestra las llaves sin reemplazar.
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
    // Levantado del borde: abajo a la izquierda Chatwoot pone el avatar y el
    // correo de la cuenta, y el botón los tapaba.
    + '#cfgb-boton{position:fixed;left:14px;bottom:78px;z-index:2147483000;'
    + 'display:flex;align-items:center;gap:7px;padding:10px 14px;border-radius:6px;'
    + 'border:none;background:{{COLOR}};color:{{TEXTO}};cursor:pointer;'
    // Inter es la tipografia del propio Chatwoot, asi que ya esta cargada en la
    // pagina y el boton no parece pegado de otra interfaz.
    + 'font:500 15px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;'
    + 'box-shadow:0 2px 10px rgba(0,0,0,.25)}'
    + '#cfgb-boton svg{flex:none;width:17px;height:17px}'
    + '#cfgb-boton:hover{filter:brightness(.9)}'
    + '#cfgb-capa{position:fixed;inset:0;z-index:2147483001;display:none;background:rgba(0,0,0,.45)}'
    + '#cfgb-capa.abierta{display:block}'
    // Fondo oscuro: es el tema por defecto del configurador, y con blanco se
    // veia un flash claro cada vez que se abria.
    + '#cfgb-marco{position:absolute;inset:3vh 3vw;background:#07060f;border-radius:10px;'
    + 'overflow:hidden;display:flex;flex-direction:column;box-shadow:0 10px 40px rgba(0,0,0,.35)}'
    + '#cfgb-barra{display:flex;align-items:center;justify-content:space-between;'
    + 'padding:9px 14px;background:{{COLOR}};color:{{TEXTO}};'
    + 'font:600 14px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}'
    + '#cfgb-barra button{background:none;border:none;color:{{TEXTO}};font-size:20px;'
    + 'cursor:pointer;line-height:1;padding:0 4px}'
    + '#cfgb-marco iframe{flex:1;width:100%;border:0}'
    + '@media (max-width:600px){#cfgb-marco{inset:0;border-radius:0}}';

  var estilo = document.createElement('style');
  estilo.textContent = css;
  document.head.appendChild(estilo);

  var boton = document.createElement('button');
  boton.id = 'cfgb-boton';
  // Icono en linea y con `currentColor`: sigue al color del texto de la marca,
  // y no depende de que la fuente del sistema tenga ese emoji —en Windows el
  // robot se veia plano y de otro estilo que el resto de la interfaz—.
  boton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" '
    + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/>'
    + '<path d="M12 7v4"/><path d="M8 16h.01"/><path d="M16 16h.01"/></svg>'
    + '<span>Mi asistente</span>';
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
