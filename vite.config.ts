import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The app's version is package.json's, injected as `__APP_VERSION__` (src/version.ts) so the
// splash, the About dialog and the packaged installers all say the same thing. CI rewrites
// package.json before building, so a `latest` build carries its own prerelease string.
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // Where the site is served from: GitHub Pages under a repository path needs `/scm-js/`,
  // a custom domain and the desktop app want `/`. The build workflow sets it.
  base: process.env.SCMJS_BASE || '/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    // The desktop build never carries a default game-data address, whatever .env says: it
    // looks on the user's disk and otherwise asks (src/gamedata/source.ts).
    ...(mode === 'desktop' ? { 'import.meta.env.VITE_GAME_DATA_URL': '""' } : {}),
  },
}))
