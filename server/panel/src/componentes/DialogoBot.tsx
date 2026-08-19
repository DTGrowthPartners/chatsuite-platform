// Configurador del bot, en nuestro panel.
//
// Las pestañas viven en ConfiguradorBot y son las mismas que ve el cliente
// dentro de su Chatsuite; aquí solo se envuelven en un diálogo y se añade el
// caso de "este cliente todavía no tiene bot", que allá no existe.
import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';

import { api, type Tenant } from '@/api';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { ConfiguradorBot } from '@/componentes/ConfiguradorBot';

export function DialogoBot({
  tenant, alCerrar, alJob,
}: { tenant: Tenant | null; alCerrar: () => void; alJob: (id: string) => void }) {
  const [sinBot, setSinBot] = useState(false);
  const slug = tenant?.slug;

  useEffect(() => { setSinBot(false); }, [slug]);

  return (
    // Igual que el alta: acá se editan la persona y la operación sin guardar, y
    // un clic afuera se llevaría los cambios.
    <Dialog open={!!tenant} disablePointerDismissal onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="size-5" /> Bot de {tenant?.nombre}
          </DialogTitle>
          <DialogDescription>
            Todo esto se guarda en el perfil del cliente y aplica sin reiniciar el bot.
          </DialogDescription>
        </DialogHeader>

        {sinBot ? (
          <div className="grid justify-items-center gap-3 py-10 text-center">
            <p className="text-sm text-muted-foreground">
              Este cliente todavía no tiene bot. Se le crea el AgentBot en Chatsuite,
              se publica el webhook y queda en borrador, sin escribirle a nadie.
            </p>
            <Button
              onClick={async () => {
                if (!slug) return;
                try {
                  const { job } = await api.bot.preparar(slug);
                  alJob(job);
                  alCerrar();
                } catch (e) { toast.error((e as Error).message); }
              }}
            >
              Crear el bot
            </Button>
          </div>
        ) : slug ? (
          <ConfiguradorBot
            key={slug}
            slug={slug}
            modo="panel"
            alJob={alJob}
            alSinBot={() => setSinBot(true)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
