import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    // El build cae directo en el directorio que ya sirve el servidor Node, para
    // que desplegar sea `npm run build` y nada mas: sin copiar, sin symlinks.
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` levanta Vite con recarga en caliente y manda /api al panel
    // real, asi se puede maquetar contra datos de verdad.
    proxy: { '/api': 'http://127.0.0.1:3200' },
  },
});
