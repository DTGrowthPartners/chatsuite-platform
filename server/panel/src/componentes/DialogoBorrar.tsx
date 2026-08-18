import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';

import type { Tenant } from '@/api';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Props = {
  tenant: Tenant | null;
  alCerrar: () => void;
  alConfirmar: (slug: string) => void;
};

/**
 * Confirmacion de borrado. Reemplaza al prompt() del navegador.
 *
 * Escribir el slug a mano es la unica barrera antes de un `docker compose
 * down -v`, asi que el boton se mantiene deshabilitado hasta que coincida
 * exacto: es una friccion buscada, no un descuido de usabilidad.
 */
export function DialogoBorrar({ tenant, alCerrar, alConfirmar }: Props) {
  const [escrito, setEscrito] = useState('');
  useEffect(() => { setEscrito(''); }, [tenant]);

  const coincide = !!tenant && escrito === tenant.slug;

  return (
    <Dialog open={!!tenant} onOpenChange={(a) => !a && alCerrar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-destructive/12">
            <TriangleAlert className="size-5 text-destructive" />
          </div>
          <DialogTitle>Borrar {tenant?.nombre}</DialogTitle>
          <DialogDescription>
            Esto elimina los contenedores, los <strong>volúmenes con todos los datos</strong>,
            el sitio de nginx y el certificado. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Se toma un respaldo de la base antes de destruir nada.
        </p>

        <div className="grid gap-2">
          <Label htmlFor="confirmar">
            Escribe <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{tenant?.slug}</code> para confirmar
          </Label>
          <Input
            id="confirmar" value={escrito} autoComplete="off"
            onChange={(e) => setEscrito(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={alCerrar}>Cancelar</Button>
          <Button
            variant="destructive"
            disabled={!coincide}
            onClick={() => tenant && alConfirmar(tenant.slug)}
          >
            Borrar definitivamente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
