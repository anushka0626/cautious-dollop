import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest, not generateSW: the generated worker precaches only what exists
      // as a file, which in dev is index.html and registerSW.js. src/sw.js adds runtime
      // caching for the modules Vite serves on demand, so an offline reload can boot.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      // The worker has to run in dev too: offline field capture cannot be
      // exercised otherwise without a production build every time. type: 'module'
      // lets Vite serve the worker's ESM imports untranspiled in dev.
      devOptions: { enabled: true, type: 'module', navigateFallback: 'index.html' },
      includeAssets: ['vite.svg', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
      manifest: {
        name: 'Veritas Ledger',
        short_name: 'Veritas',
        description: 'Digital evidence and custody chain management for Indian legal and investigation documents.',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        theme_color: '#0a0f1d',      // --canvas
        background_color: '#0a0f1d', // --canvas
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-maskable-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      // Precache the built shell. Evidence data is never cached: nothing under /api/
      // is precached here, and src/sw.js excludes it from every runtime route too.
      injectManifest: {
        globPatterns: ['**/*.{html,js,css,svg,woff2}'],
      },
    }),
  ],
})
