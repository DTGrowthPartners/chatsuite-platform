import pathlib
from logos import CLARO, MONO_GRIS

HTML = """<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Chatsuite — Entrar</title>
<style>
:root{
  /* Lo unico que cambia por cliente: su color. Aqui va el azul de DTGP. */
  --brand-rgb: 0 127 252;
  --brand-2-rgb: 38 189 240;

  --tinta:#101319; --tinta-2:#3d4453; --tenue:#6b7280;
  --papel:#ffffff; --fondo:#f4f5f7;
  --campo:#fbfbfc; --campo-borde:#dcdfe4;
  --linea:#e6e8ec;
}
*{box-sizing:border-box}
html,body{height:100%;margin:0;background:var(--fondo);
  font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:geometricPrecision}
body{overflow:hidden}

.escena{position:fixed;inset:0;display:grid;grid-template-columns:1.08fr 1fr}

/* ---------- panel de marca ---------- */
.marca{position:relative;overflow:hidden;background:#080b11;display:flex;flex-direction:column;
  justify-content:space-between;padding:42px 48px 60px}
/* El "arte" no es una foto: son tres focos del color del cliente sobre negro.
   Asi ningun cliente necesita traer una imagen para que su login se vea bien. */
.marca::before{content:"";position:absolute;inset:-30% -20% -20% -30%;
  background:
    radial-gradient(42% 50% at 18% 22%, rgb(var(--brand-rgb) / .72) 0%, transparent 66%),
    radial-gradient(40% 46% at 84% 30%, rgb(var(--brand-2-rgb) / .42) 0%, transparent 68%),
    radial-gradient(58% 60% at 70% 92%, rgb(var(--brand-rgb) / .42) 0%, transparent 70%),
    radial-gradient(30% 34% at 46% 58%, rgb(var(--brand-2-rgb) / .16) 0%, transparent 72%);
  filter:blur(18px)}
/* Trama fina: le quita el aire de degradado plano de plantilla. */
.marca::after{content:"";position:absolute;inset:0;opacity:.5;
  background-image:linear-gradient(rgb(255 255 255 / .045) 1px, transparent 1px),
    linear-gradient(90deg, rgb(255 255 255 / .045) 1px, transparent 1px);
  background-size:46px 46px;
  mask-image:radial-gradient(72% 62% at 40% 44%, #000 20%, transparent 78%)}
.marca > *{position:relative;z-index:1}
.marca > div:nth-of-type(1){margin-top:auto}

.logo{height:34px;width:auto;object-fit:contain;object-position:left center;opacity:.96}

.insignia{display:inline-flex;align-items:center;gap:9px;align-self:flex-start;
  height:35px;padding:0 15px 0 13px;border-radius:999px;
  background:rgb(255 255 255 / .10);border:1px solid rgb(255 255 255 / .16);
  backdrop-filter:blur(8px) saturate(140%);
  color:#eef2f8;font-size:13px;letter-spacing:-.01em;white-space:nowrap}
.insignia svg{width:15px;height:15px;flex:none;color:rgb(var(--brand-2-rgb))}

.titular{margin:22px 0 0;font-size:clamp(38px,3.9vw,58px);line-height:1.02;
  letter-spacing:-.035em;font-weight:640;color:#fff}
.titular span{display:block;color:transparent;
  background:linear-gradient(100deg, rgb(var(--brand-rgb)), rgb(var(--brand-2-rgb)));
  -webkit-background-clip:text;background-clip:text}
.bajada{margin:16px 0 0;max-width:29rem;font-size:15px;line-height:1.62;color:rgb(226 232 240 / .55)}


/* ---------- columna del formulario ---------- */
.acceso{display:flex;align-items:center;justify-content:center;padding:22px 22px 22px 0;background:var(--fondo)}
.tarjeta{width:100%;max-width:520px;background:var(--papel);border-radius:26px;
  border:1px solid rgb(16 19 25 / .05);
  box-shadow:0 1px 3px rgb(10 14 20 / .05), 1px 12px 34px rgb(10 14 20 / .10);
  padding:52px 56px 40px;max-height:100%;overflow:auto}

h1{margin:0;font-size:34px;line-height:1.1;letter-spacing:-.032em;font-weight:640;color:var(--tinta)}
.sub{margin:12px 0 34px;font-size:15.5px;line-height:1.55;color:var(--tenue)}
.sub b{color:var(--tinta-2);font-weight:600}

label{display:block;font-size:13px;font-weight:560;color:var(--tinta-2);margin:0 0 7px}
.campo{width:100%;height:54px;padding:0 16px;border-radius:12px;background:var(--campo);
  border:1.5px solid var(--campo-borde);font-size:15px;color:var(--tinta);outline:none;
  transition:border-color .16s ease, box-shadow .16s ease, background .16s ease}
.campo::placeholder{color:#9aa1ad}
.campo:focus{background:#fff;border-color:rgb(var(--brand-rgb) / .55);
  box-shadow:0 0 0 4px rgb(var(--brand-rgb) / .12)}
.grupo{margin-bottom:18px}
.olvido{display:block;margin-top:9px;font-size:13px;color:rgb(var(--brand-rgb));text-decoration:none}
.olvido:hover{text-decoration:underline}

.entrar{margin-top:8px;width:100%;height:56px;border:0;border-radius:999px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:10px;
  background:linear-gradient(180deg, #232b36 0%, #171d26 100%);color:#fff;
  font-size:15.5px;font-weight:560;letter-spacing:-.01em;
  box-shadow:0 8px 20px rgb(18 26 34 / .18), 0 2px 5px rgb(18 26 34 / .10);
  transition:filter .18s ease, transform .18s cubic-bezier(.2,.7,.3,1)}
.entrar:hover{filter:brightness(1.14)}
.entrar:active{transform:translateY(1px)}
.entrar svg{width:13px;height:13px}

.divisor{display:flex;align-items:center;gap:16px;margin:26px 0}
.divisor i{flex:1;height:1px;background:var(--linea)}
.divisor b{font-size:11px;font-weight:700;letter-spacing:.09em;color:#9aa1ad}

.google{width:100%;height:54px;border-radius:999px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;gap:11px;
  background:#fff;border:1.5px solid var(--campo-borde);
  font-size:15px;color:var(--tinta-2);
  transition:background .18s ease, box-shadow .18s ease, transform .18s cubic-bezier(.2,.7,.3,1)}
.google:hover{box-shadow:0 3px 10px rgb(0 0 0 / .07)}
.google:active{transform:translateY(1px)}
.google svg{width:18px;height:18px}

.registro{margin:26px 0 0;text-align:center;font-size:14px;color:var(--tenue)}
.registro a{color:var(--tinta);font-weight:640;text-decoration:underline;text-underline-offset:3px}

/* La firma de DTGP: discreta, y con un asset horneado que el montaje de marca
   del cliente no puede reemplazar. */
.firma{display:flex;align-items:center;justify-content:center;gap:7px;
  margin:32px 0 0;padding-top:19px;border-top:1px solid var(--linea);
  font-size:11.5px;letter-spacing:.015em;color:#a3a9b4}
.firma img{height:15px;width:auto;opacity:.75}
.firma b{font-weight:600;color:#818897}

@media (max-width:1023px){
  body{overflow:auto}
  .escena{position:static;display:block}
  .marca{padding:26px 24px 30px;min-height:270px}
  .logo{height:26px}
  .titular{font-size:32px}
  .bajada{display:none}
  .acceso{padding:0;background:var(--papel)}
  .tarjeta{max-width:none;border:0;border-radius:26px 26px 0 0;box-shadow:none;
    margin-top:-22px;padding:34px 24px 30px}
}
</style></head>
<body>
<div class="escena">
  <section class="marca">
    <img class="logo" src="data:image/png;base64,__CLARO__" alt="">
    <div>
      <div class="insignia">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
        </svg>
        Atención al cliente, sin perder el hilo
      </div>
      <h2 class="titular">Cada conversación,<span>en su lugar.</span></h2>
      <p class="bajada">
        WhatsApp, Instagram y correo en la misma bandeja, con el historial
        completo de cada cliente y un asistente que responde cuando tú no puedes.
      </p>
    </div>
  </section>

  <section class="acceso">
    <div class="tarjeta">
      <h1>Bienvenido de nuevo</h1>
      <p class="sub"><b>Entra</b> para seguir atendiendo a tus clientes.</p>

      <div class="grupo">
        <label for="correo">Correo</label>
        <input class="campo" id="correo" type="email" placeholder="nombre@empresa.com">
      </div>
      <div class="grupo">
        <label for="clave">Contraseña</label>
        <input class="campo" id="clave" type="password" placeholder="••••••••••">
        <a class="olvido" href="#">¿Olvidaste tu contraseña?</a>
      </div>

      <button class="entrar" type="button">
        Entrar
        <svg viewBox="0 0 22 22" fill="none"><path d="M3 11h15.4M11 3.3l7.7 7.7-7.7 7.7"
          stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>

      <div class="divisor"><i></i><b>O</b><i></i></div>

      <button class="google" type="button">
        <svg viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.6-.15-3.15-.42-4.65H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.6 5.9c4.44-4.1 7.22-10.14 7.22-17.45z"/><path fill="#FBBC05" d="M10.4 28.7a14.4 14.4 0 0 1 0-9.4l-7.8-6.1a24 24 0 0 0 0 21.6l7.8-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.95-2.13 15.93-5.82l-7.6-5.9c-2.12 1.42-4.84 2.26-8.33 2.26-6.3 0-11.7-3.7-13.6-9.84l-7.8 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
        Entrar con Google
      </button>

      <p class="registro">¿Aún no tienes cuenta? <a href="#">Escríbenos</a></p>

      <div class="firma">
        <img src="data:image/png;base64,__MONO__" alt="">
        Powered by <b>DT Growth Partners</b>
      </div>
    </div>
  </section>
</div>
</body></html>
"""

pathlib.Path('login-maqueta.html').write_text(
    HTML.replace('__CLARO__', CLARO).replace('__MONO__', MONO_GRIS))
print('maqueta escrita')
