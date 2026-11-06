import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        registerType: 'autoUpdate',
        injectRegister: 'script',
        manifest: {
          name: 'Splitty',
          short_name: 'Splitty',
          description: 'Split expenses with friends',
          // The app's dark background, in both themes: Android colours its
          // bottom navigation bar (and the launch splash) from these, and a
          // manifest cannot hold a light and a dark variant. A dark bar under
          // light mode looks fine; a white one under dark mode does not.
          // The status bar follows the page's live theme-color meta instead.
          theme_color: '#1C1714',
          background_color: '#1C1714',
          display: 'standalone',
          viewport: 'width=device-width, initial-scale=1.0, viewport-fit=cover',
          start_url: '/',
          scope: '/',
          orientation: 'portrait',
          icons: [
            {
              src: '/cat-icon-192.png',
              sizes: '192x192',
              type: 'image/png',
            },
            {
              src: '/cat-icon-512.png',
              sizes: '512x512',
              type: 'image/png',
            },
            {
              src: '/cat-icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/cat-icon-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],

    build: {
      rolldownOptions: {
        output: {
          // MapLibre's worker (imported with ?url in basemap.js) is an .mjs
          // file. nginx's mime.types has no .mjs, and a module worker served
          // as application/octet-stream is refused (nosniff), so it ships as .js.
          assetFileNames: info => (info.names?.[0] ?? '').endsWith('.mjs')
            ? 'assets/[name]-[hash].js'
            : 'assets/[name]-[hash][extname]',
        },
      },
    },

    server: {
      host: '0.0.0.0',
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://api:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ''),
        },
      },
    },
  }
})