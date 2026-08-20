// Build aparte del formulario de onboarding.
//
// Va aparte del panel por dos razones. La primera es de peso: quien llena esto
// es el dueño de un negocio, muchas veces desde el celular y con datos, y no
// tiene por que descargar los 640 KB del panel para responder preguntas. La
// segunda es de superficie: el bundle del panel lleva dentro las pantallas de
// administracion de todos los tenants, y esto se sirve sin sesion de panel.
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Se sirve bajo /f/<token>, que es una ruta de un solo nivel variable: con
  // base relativa los assets se pedirian a /f/assets y ahi no hay nada.
  base: '/formulario/',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: '../public/formulario',
    emptyOutDir: true,
    rollupOptions: { input: path.resolve(__dirname, './formulario.html') },
  },
});
