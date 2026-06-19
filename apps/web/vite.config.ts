import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const hipiServerUrl = env.VITE_HIPIPLAY_SERVER_URL || 'http://127.0.0.1:4000';

  return {
    base: '/pwa/',
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        // Servidor remoto de carreras
        '/hipiplay-server': {
          target: hipiServerUrl,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/hipiplay-server/, '')
        },

        // Backend local de la PWA: login, usuarios, wallet, historial interno, etc.
        '/api': {
          target: 'http://127.0.0.1:4001',
          changeOrigin: true,
          secure: false
        }
      }
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      strictPort: true,
      allowedHosts: true
    }
  };
});


