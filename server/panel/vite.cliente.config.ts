// Build aparte del configurador del cliente.
//
// Va aparte y no como segunda entrada del panel por el `base`: esta app se
// sirve bajo /bot/config/ del dominio del cliente, y con el base del panel los
// assets se pedirian a la raiz, que ahi es Chatwoot. El resultado serian
// pantallas en blanco sin un solo error legible.
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/bot/config/',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // Lo que hay aqui se copia tal cual: el inyector, que no pasa por el bundler
  // porque lo carga Chatwoot como script suelto.
  publicDir: path.resolve(__dirname, './publico-cliente'),
  build: {
    outDir: '../public/cliente',
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, './configurador.html') },
  },
});
