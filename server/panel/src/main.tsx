import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App.tsx';
import './index.css';

// El panel es de tema oscuro fijo: es una herramienta interna que se usa junto a
// la terminal, y sostener dos temas seria trabajo sin retorno.
document.documentElement.classList.add('dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
