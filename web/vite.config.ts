import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    allowedHosts: ['.netbird.cloud'],
    proxy: {
      '/api': 'http://localhost:7778',
      '/ws': { target: 'ws://localhost:7778', ws: true },
    },
  },
});
