import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy: {
      '/hipiplay-server': {
        target: 'http://uribepro2.ddns.net:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/hipiplay-server/, '')
      },
      '/api': {
        target: 'http://127.0.0.1:4000',
        changeOrigin: true,
        secure: false
      }
    }
  }
});

