import { useState } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';

import { api } from '@/api';
import { Marca } from '@/componentes/Marca';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function Login({ alEntrar }: { alEntrar: () => void }) {
  const [usuario, setUsuario] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

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
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-[23rem]"
      >
        <div className="mb-7 text-center">
          <Marca className="size-13" />
          <h1 className="mt-3.5 text-[1.6rem] font-semibold tracking-tight">Chatsuite</h1>
          <p className="text-sm text-muted-foreground">Panel de aprovisionamiento</p>
        </div>

        <form
          onSubmit={enviar}
          className="rounded-2xl border bg-card p-6 shadow-[0_24px_60px_rgb(0_0_0/45%)]"
        >
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="usuario">Usuario</Label>
              <Input
                id="usuario" name="usuario" autoComplete="username" autoFocus required
                value={usuario} onChange={(e) => setUsuario(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="clave">Clave</Label>
              <Input
                id="clave" name="clave" type="password" autoComplete="current-password" required
                value={clave} onChange={(e) => setClave(e.target.value)}
              />
            </div>

            {error && (
              // El aviso entra con altura animada para que el formulario no
              // pegue un salto al aparecer.
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ duration: 0.22 }}
              >
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </motion.div>
            )}

            <Button type="submit" disabled={enviando} className="mt-1 w-full">
              {enviando && <Loader2 className="animate-spin" />}
              {enviando ? 'Entrando…' : 'Entrar'}
            </Button>
          </div>
        </form>

        <p className="mt-5 text-center text-xs tracking-wide text-muted-foreground">
          DT Growth Partners
        </p>
      </motion.div>
    </div>
  );
}
