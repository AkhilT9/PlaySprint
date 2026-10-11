import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`       -> http://localhost:5173 (camera works on localhost)
// `npm run dev:phone` -> https://<your-LAN-IP>:5173 so phones on the same Wi-Fi can use the camera
export default defineConfig(({ mode }) => ({
  root: 'client',
  base: process.env.VITE_BASE || '/',
  plugins: [react(), ...(mode === 'phone' ? [basicSsl()] : [])],
  server: {
    host: mode === 'phone' ? true : 'localhost',
    port: 5173,
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 2000 },
}));
