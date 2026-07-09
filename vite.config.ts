import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Permette l'accesso tramite il tunnel https (host casuale trycloudflare.com)
    allowedHosts: true,
    // HMR (aggiornamento live) attraverso il tunnel https sulla porta 443
    hmr: { clientPort: 443 },
  },
  preview: {
    host: true,
    allowedHosts: true,
  },
})
