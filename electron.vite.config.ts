import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const alias = { '@core': resolve(__dirname, 'core') }

export default defineConfig({
  main: {
    resolve: { alias },
    build: { rolldownOptions: { input: { index: resolve(__dirname, 'electron/main.ts') } } }
  },
  preload: {
    resolve: { alias },
    build: { rolldownOptions: { input: { index: resolve(__dirname, 'electron/preload.ts') } } }
  },
  renderer: {
    root: resolve(__dirname, 'src'),
    resolve: { alias: { ...alias, '@': resolve(__dirname, 'src') } },
    plugins: [react(), tailwindcss()],
    build: { rolldownOptions: { input: { index: resolve(__dirname, 'src/index.html') } } }
  }
})
