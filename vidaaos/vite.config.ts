import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// Preact + Vite. Norigin core ships its own web key adapter (listens on window),
// so no custom key wiring is needed at the Vite level.
export default defineConfig({
  plugins: [preact()],
  server: {
    port: 5173,
    https: undefined,
    // Dev: forward /vix/* and /prov to the backend proxy on 8788 so the app
    // calls both same-origin (no CORS, no mixed-content — works from localhost,
    // a LAN IP, or the TV). VixcloudClient + httpGet build relative URLs in dev.
    proxy: {
      '/vix': {
        target: process.env.PROXY_ORIGIN || 'http://localhost:8788',
        changeOrigin: true
      },
      '/prov': {
        target: process.env.PROXY_ORIGIN || 'http://localhost:8788',
        changeOrigin: true
      },
      '/warp': {
        target: process.env.PROXY_ORIGIN || 'http://localhost:8788',
        changeOrigin: true
      },
      // SPA routes also live under /anime (e.g. /anime, /anime/:id/:slug). Proxy
      // ONLY the actual API calls so that reloading a SPA path falls back to
      // index.html instead of hitting the proxy with GET /anime.
      '^/anime/(browse|search|episodes|embed)(/|$)': {
        target: process.env.PROXY_ORIGIN || 'http://localhost:8788',
        changeOrigin: true
      }
    }
  },
  build: {
    target: 'es2020',
    outDir: 'dist'
  }
});
