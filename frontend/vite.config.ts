import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { cutiaDesktopIntegration } from './src/renderer/editing/vite-integration'

const integration = cutiaDesktopIntegration(import.meta.dirname)
export default defineConfig({
  base: './',
  resolve: { alias: integration.aliases },
  esbuild: { jsx: 'automatic' },
  plugins: [integration.plugin, tailwindcss()],
  build: { outDir: '../editor_dist', emptyOutDir: true, chunkSizeWarningLimit: 5000 }
})
