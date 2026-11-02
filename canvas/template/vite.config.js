import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import designStudio from './.designstudio/vite-plugin.js';

export default defineConfig({
  plugins: [designStudio(), react(), tailwindcss()],
});
