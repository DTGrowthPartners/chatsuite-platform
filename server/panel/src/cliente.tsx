// El configurador tal como lo ve el cliente, dentro de su propio Chatsuite.
//
// Se sirve bajo /bot/config/ del dominio del cliente, así que es del MISMO
// origen que Chatwoot y puede leer su cookie de sesión. De ahí salen las
// credenciales: no hay login propio ni contraseña nueva que administrar. Quien
// tiene usuario administrador en el Chatsuite, entra; quien no, no.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster, toast } from 'sonner';

import { configurarApi } from './api';
import { ConfiguradorBot } from './componentes/ConfiguradorBot';
import './index.css';

/**
 * Las credenciales de devise_token_auth que Chatwoot guarda en su cookie.
 *
 * OJO con dos cosas que ya costaron caras una vez: la cookie viene
 * percent-encoded, y sus claves llevan GUION (`access-token`), no guion bajo.
 * Los tres valores viajan juntos o Rails no autentica.
 */
function credenciales(): Record<string, string> {
  const cruda = document.cookie.split('; ').find((c) => c.startsWith('cw_d_session_info='));
  if (!cruda) return {};
  try {
    const datos = JSON.parse(decodeURIComponent(cruda.slice('cw_d_session_info='.length)).replace(/^"|"$/g, ''));
    const token = datos['access-token'];
    if (!token) return {};
    return { 'X-CW-Token': token, 'X-CW-Client': datos.client, 'X-CW-Uid': datos.uid };
  } catch {
    return {};
  }
}

configurarApi({ base: '/bot/config', cabeceras: credenciales });

type Contexto = { slug: string; nombre: string; usuario: string };

function App() {
  const [contexto, setContexto] = useState<Contexto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/bot/config/api/contexto', { headers: credenciales() })
      .then(async (r) => {
        const cuerpo = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(cuerpo.error || `error ${r.status}`);
        setContexto(cuerpo as Contexto);
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  if (error) {
    return (
      <div className="mx-auto grid max-w-md gap-2 px-6 py-16 text-center">
        <h1 className="text-base font-semibold">No puedo abrir la configuración</h1>
        <p className="text-sm text-muted-foreground">{error}</p>
        <p className="text-xs text-muted-foreground">
          Si acabas de entrar, recarga la página. Si el mensaje habla de permisos,
          pídele al dueño que te haga administrador.
        </p>
      </div>
    );
  }

  if (!contexto) return <p className="py-16 text-center text-sm text-muted-foreground">cargando…</p>;

  return (
    // Alto completo y una sola zona con scroll: esto vive dentro de un iframe
    // estrecho, y dos barras de scroll ahí dentro son inusables.
    <div className="flex h-dvh flex-col gap-3 p-4">
      <header>
        <h1 className="text-base font-semibold">Tu asistente de WhatsApp</h1>
        <p className="text-xs text-muted-foreground">
          Lo que cambies aquí lo aplica al instante, sin reiniciar nada.
        </p>
      </header>
      <ConfiguradorBot
        slug={contexto.slug}
        modo="cliente"
        alSinBot={() => toast.error('todavía no hay bot configurado para esta cuenta')}
      />
      <Toaster position="top-center" richColors />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
