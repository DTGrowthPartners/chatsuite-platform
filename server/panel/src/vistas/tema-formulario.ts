// El tema del formulario de onboarding.
//
// Va en su propio modulo y no en formulario.tsx porque la vista tambien lo
// necesita para dibujar el interruptor, y ese import seria circular.
//
// Oscuro por defecto. Se decidio asi y no siguiendo `prefers-color-scheme`
// porque este enlace se abre casi siempre desde WhatsApp, donde el navegador
// embebido no siempre reporta la preferencia del sistema: quedaba a suerte de
// que app lo abriera.
export const LLAVE_TEMA = 'onboarding-tema';

export type Tema = 'oscuro' | 'claro';

export function aplicarTema(tema: Tema) {
  document.documentElement.classList.toggle('dark', tema === 'oscuro');
}

// Se lee y aplica antes de pintar: dentro de un efecto se ve un fogonazo blanco
// en cada apertura, y en un formulario al que se vuelve varias veces, molesta.
export const temaInicial: Tema = localStorage.getItem(LLAVE_TEMA) === 'claro' ? 'claro' : 'oscuro';
