import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Where the site is served from: GitHub Pages under a repository path needs `/scm-js/`,
  // a custom domain and the desktop app want `/`. The build workflow sets it.
  base: process.env.SCMJS_BASE || '/',
  // The desktop build never carries a default game-data address, whatever .env says: it
  // looks on the user's disk and otherwise asks (src/gamedata/source.ts).
  define: mode === 'desktop' ? { 'import.meta.env.VITE_GAME_DATA_URL': '""' } : {},
}))
