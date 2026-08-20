import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

/**
 * Public landing site: a single-page download entry (index.html). BASE_PATH
 * defaults to `/` for local dev and can be set by the deployment workflow.
 */
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
})
