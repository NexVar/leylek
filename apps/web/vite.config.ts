import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Vite 8 (Rolldown bundler by default) + React 19 + Tailwind v4.
// Tailwind v4 uses CSS-first config — there is no tailwind.config.js.
// All theme tokens live inside src/index.css under @theme once DESIGN.md lands.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: false,
  },
});
