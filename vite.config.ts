import { readFileSync } from 'node:fs'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The app's version is package.json's, injected as `__APP_VERSION__` (src/version.ts) so the
// splash, the About dialog and the packaged installers all say the same thing. CI rewrites
// package.json before building, so a nightly build carries its own prerelease string.
const version = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

/** src/version.ts#shortVersion, kept in step by hand. */
function shortVersion(v: string): string {
  const dash = v.indexOf('-')
  if (dash < 0) return v.split('+')[0]
  const channel = v.slice(dash + 1).split(/[.+]/)[0]
  return channel ? `${v.slice(0, dash)}-${channel}` : v.slice(0, dash)
}

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [
    react(),
    // `index.html` carries the boot splash (the markup that paints before the bundle
    // evaluates), and its version line has to say the same thing `src/version.ts` does.
    // Vite substitutes `%FOO%` in HTML only for env vars, so this does that one token.
    {
      name: 'scmjs-html-version',
      // The rule is `shortVersion` in src/version.ts (the release plus the channel it was
      // cut on, so a nightly does not read as a release nobody shipped) — copied rather
      // than imported, since this config is its own TypeScript project. Change both.
      transformIndexHtml: (html: string) =>
        html.replace(/%APP_VERSION_SHORT%/g, shortVersion(version)),
    },
  ],
  // Where the site is served from: GitHub Pages under a repository path needs `/scm-js/`,
  // a custom domain and the desktop app want `/`. The build workflow sets it.
  base: process.env.SCMJS_BASE || '/',
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
}))
