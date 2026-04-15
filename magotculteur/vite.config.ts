import { defineConfig } from 'vite'
import { createReadStream, existsSync } from 'node:fs'
import { resolve, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir       = fileURLToPath(new URL('.', import.meta.url))  // magotculteur/
const parentDir = resolve(dir, '..')                             // calleau-utils/

const MIME: Record<string, string> = {
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
}

export default defineConfig({
  root: '.',
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  worker: {
    format: 'es',
  },
  plugins: [
    {
      // En dev uniquement : sert les fichiers statiques du répertoire parent
      // (theme.css, theme-toggle.js, …) qui ne sont pas dans la racine Vite.
      name: 'serve-parent-statics',
      apply: 'serve',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = (req.url ?? '').split('?')[0]
          const ext = extname(url)
          if (!MIME[ext]) return next()

          const filePath = resolve(parentDir, url.slice(1))

          // Vérification cross-platform : le fichier doit être dans parentDir
          const rel = relative(parentDir, filePath)
          if (rel.startsWith('..') || rel.includes(':')) return next()
          if (!existsSync(filePath)) return next()

          res.setHeader('Content-Type', MIME[ext])
          createReadStream(filePath).pipe(res as any)
        })
      },
    },
  ],
})
