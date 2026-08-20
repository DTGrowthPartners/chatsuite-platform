// El formulario de onboarding tal como lo ve el dueño del negocio.
//
// Entra por dtgp.ai/f/<token> con una clave de seis digitos. Su sesion es una
// cookie propia, atada a un solo formulario: no comparte nada con el panel.
//
// Oscuro por defecto, con interruptor. Se aplica ANTES de pintar y no dentro de
// un efecto: hacerlo despues deja ver un fogonazo blanco en cada apertura, que
// en un formulario largo se sufre cada vez que se vuelve a el.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';

import { FormularioPublico } from './vistas/FormularioPublico';
import { aplicarTema, temaInicial } from './vistas/tema-formulario';
import './index.css';

aplicarTema(temaInicial);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FormularioPublico />
    <Toaster position="bottom-center" />
  </StrictMode>,
);
