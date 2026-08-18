import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';

import { api } from '@/api';
import { Login } from '@/vistas/Login';
import { Panel } from '@/vistas/Panel';
import { Toaster } from '@/components/ui/sonner';

export default function App() {
  // null mientras se consulta: pintar el login y cambiarlo medio segundo
  // despues produce un parpadeo feo en cada recarga.
  const [autenticado, setAutenticado] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/sesion')
      .then((r) => r.json())
      .then((d) => setAutenticado(!!d.autenticado))
      .catch(() => setAutenticado(false));
  }, []);

  const salir = useCallback(async () => {
    await api.salir().catch(() => {});
    setAutenticado(false);
  }, []);

  if (autenticado === null) return null;

  return (
    // reducedMotion="user" respeta la preferencia del sistema: quien la tenga
    // activada recibe el estado FINAL de una vez, no una animacion mas rapida.
    // Importa mas de lo que parece: las vistas arrancan en opacity 0, asi que
    // sin esto un entorno donde la animacion no corra dejaria el panel en
    // blanco con el contenido presente pero invisible.
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait">
        <motion.div
          key={autenticado ? 'panel' : 'login'}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {autenticado
            ? <Panel alSalir={salir} />
            : <Login alEntrar={() => setAutenticado(true)} />}
        </motion.div>
      </AnimatePresence>
      <Toaster position="bottom-right" />
    </MotionConfig>
  );
}
