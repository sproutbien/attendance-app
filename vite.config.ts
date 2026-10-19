import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// VITE_BASE lets the app live in a sub-folder (e.g. /attendance/ on sproutbien.com); Vercel builds keep '/'
export default defineConfig(({ mode }) => ({
  base: loadEnv(mode, '.', '').VITE_BASE || '/',
  plugins: [react()],
}))
