import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    allowedHosts: ['.netbird.cloud'],
    proxy: {
      '/api': `http://localhost:${process.env.DS_SERVER_PORT ?? 7778}`,
      '/ws': { target: `ws://localhost:${process.env.DS_SERVER_PORT ?? 7778}`, ws: true },
    },
  },
});
