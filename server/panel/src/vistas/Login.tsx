import { useEffect, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import '@fontsource-variable/inter/opsz.css';
import '@fontsource/instrument-serif/400-italic.css';
import './login.css';

import { api } from '@/api';

export function Login({ alEntrar }: { alEntrar: () => void }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [verClave, setVerClave] = useState(false);
  const raiz = useRef<HTMLDivElement>(null);

  // El fondo negro tiene que llegar al borde del rebote de scroll, asi que se
  // marca el body y no un contenedor. Se quita al desmontar para que el tablero
  // recupere su propio tema.
  useEffect(() => {
    document.body.classList.add('lg-negro');
    return () => document.body.classList.remove('lg-negro');
  }, []);

  // Las entradas descansan en opacity 1: si las animaciones no corren, la
  // pantalla se ve entera igual. `both` aplica el fotograma 0 durante el retardo,
  // asi que cuando si corren, arrancan ocultas. Al terminar cada una se congela
  // con .is-in para que nada quede a merced de un recalculo posterior.
  useEffect(() => {
    const nodo = raiz.current;
    if (!nodo) return;
    const piezas = Array.from(nodo.querySelectorAll<HTMLElement>('.lg-in, .lg-fondo'));
    const congelar = (el: HTMLElement) => el.classList.add('is-in');
    piezas.forEach((el) => el.addEventListener('animationend', () => congelar(el), { once: true }));

    // Respaldo: si tras dos fotogramas ninguna animacion arranco (extension que
    // las bloquea, navegador viejo), se dan todas por terminadas.
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        const corriendo = piezas.some((el) => {
          if (!el.getAnimations) return true;
          return el.getAnimations().some((a) => a.playState === 'running' || a.playState === 'finished');
        });
        if (!corriendo) piezas.forEach(congelar);
      });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  async function enviar(ev: React.FormEvent) {
    ev.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await api.entrar(usuario, clave);
      alEntrar();
    } catch (e) {
      setError((e as Error).message);
      setClave('');
      setVerClave(false);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="lg-root" ref={raiz}>
      <div className="lg-grain" aria-hidden="true" />

      <video
        className="lg-fondo"
        poster="/portada.jpg"
        src="/portada.mp4"
        autoPlay muted loop playsInline preload="auto"
        aria-hidden="true"
      />
      <div className="lg-velo" aria-hidden="true" />

      <div className="lg-page">
        <div className="lg-copy">
          <div className="lg-badge lg-in lg-in--pop" style={{ '--d': '0.10s' } as React.CSSProperties}>
            <svg className="lg-star" viewBox="0 0 24 24" fill="#ffffff" aria-hidden="true">
              <path d="M12 2.6C12.55 2.6 12.88 3.15 13.08 4.7c.62 4.7 1.52 5.6 6.22 6.22 1.55.2 2.1.53 2.1 1.08s-.55.88-2.1 1.08c-4.7.62-5.6 1.52-6.22 6.22-.2 1.55-.53 2.1-1.08 2.1s-.88-.55-1.08-2.1c-.62-4.7-1.52-5.6-6.22-6.22C3.15 12.88 2.6 12.55 2.6 12s.55-.88 2.1-1.08c4.7-.62 5.6-1.52 6.22-6.22C11.12 3.15 11.45 2.6 12 2.6Z" />
            </svg>
            Panel de aprovisionamiento
          </div>

          <span className="lg-logo lg-in lg-in--scale" style={{ '--d': '0.24s' } as React.CSSProperties}>
            <img src="/dt-logo.png" alt="DT Growth Partners" width={2000} height={564} />
          </span>

          <form className="lg-form" onSubmit={enviar}>
            <input
              className="lg-campo lg-in lg-in--btn"
              style={{ '--d': '0.44s' } as React.CSSProperties}
              id="usuario" name="usuario" placeholder="Usuario" aria-label="Usuario"
              autoComplete="username" autoFocus required
              value={usuario} onChange={(e) => setUsuario(e.target.value)}
            />
            <span className="lg-caja lg-in lg-in--btn" style={{ '--d': '0.54s' } as React.CSSProperties}>
              <input
                className="lg-campo"
                id="clave" name="clave" type={verClave ? 'text' : 'password'}
                placeholder="Clave" aria-label="Clave"
                autoComplete="current-password" required
                value={clave} onChange={(e) => setClave(e.target.value)}
              />
              <button
                className="lg-ojo"
                type="button"
                onClick={() => setVerClave((v) => !v)}
                aria-label={verClave ? 'Ocultar la clave' : 'Ver la clave'}
                aria-pressed={verClave}
                title={verClave ? 'Ocultar' : 'Ver'}
              >
                {verClave ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
              </button>
            </span>

            <button
              className="lg-btn lg-in lg-in--btn"
              style={{ '--d': '0.64s' } as React.CSSProperties}
              type="submit" disabled={enviando}
            >
              {enviando && <i className="lg-spinner" />}
              {enviando ? 'Entrando…' : 'Entrar'}
            </button>

            {error && <p className="lg-error" role="alert">{error}</p>}
          </form>
        </div>
      </div>
    </div>
  );
}
