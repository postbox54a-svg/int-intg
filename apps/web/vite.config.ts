import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const ingest = `http://localhost:${process.env.INGEST_PORT ?? 8787}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': ingest,
      '/ws': { target: ingest.replace('http', 'ws'), ws: true },
    },
  },
});
