import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: true,
    port: 5173,
    // Telegram Mini Apps must be served over HTTPS — use a tunnel (ngrok/Cloudflare)
    // or `vite --https` with a local cert when testing inside Telegram itself.
  },
});
