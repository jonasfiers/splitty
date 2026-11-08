import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { cpSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// pdf.js (the in-app file viewer, src/utils/pdf.js) loads fonts, character
// maps, colour profiles and image decoders at run time from /pdfjs/: copied
// from the package into the build, so they always match its version.
function copyPdfjsAssets() {
  let outDir
  return {
    name: 'copy-pdfjs-assets',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir },
    writeBundle() {
      const pkg = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
      for (const dir of ['cmaps', 'standard_fonts', 'iccs', 'wasm']) {
        cpSync(join(pkg, dir), join(outDir, 'pdfjs', dir), { recursive: true })
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [
      react(),
      copyPdfjsAssets(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        registerType: 'autoUpdate',
        injectRegister: 'script',
        // The app's own files, saved by the service worker so Splitty opens
        // without a connection (src/sw.js). pdf.js's fonts and character maps
        // (4 MB) are saved only once used.
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,woff2,svg,png,ico,webmanifest}'],
          globIgnores: ['pdfjs/**', 'cat-avatar-poc.html'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        },
        manifest: {
          name: 'Splitty',
          short_name: 'Splitty',
          description: 'Split expenses with friends',
          // The app's dark background, in both themes: Android colours its
          // bottom navigation bar (and the launch splash) from these. A dark bar
          // under light mode looks fine; a white one under dark mode does not.
          // The status bar follows the page's live theme-color meta instead.
          // Tried 2026-11-08 on QA: light colours + a dark variant, both as
          // `color_scheme_dark` and as `user_preferences.color_scheme.dark`.
          // Chrome on Android read neither (chrome://webapks "Dark theme color"
          // stayed empty) and the bar went light under dark mode.
          theme_color: '#1C1714',
          background_color: '#1C1714',
          display: 'standalone',
          viewport: 'width=device-width, initial-scale=1.0, viewport-fit=cover',
          start_url: '/',
          scope: '/',
          orientation: 'any',
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
          // MapLibre's and pdf.js's workers (imported with ?url) are .mjs
          // files. nginx's mime.types has no .mjs, and a module worker served
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