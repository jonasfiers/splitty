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
          theme_color: '#F5F1EB',
          background_color: '#F5F1EB',
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