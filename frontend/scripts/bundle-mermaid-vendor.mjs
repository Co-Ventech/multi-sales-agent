/**
 * Prebuild: mermaid → public/vendor + src/vendor (same file).
 * public/ = prod static copy; src/ = dev import (Vite cannot import from public/).
 */
import * as esbuild from 'esbuild'
import { mkdirSync, existsSync, copyFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'node_modules/mermaid/dist/mermaid.core.mjs')
const publicOut = join(root, 'public/vendor/mermaid.bundle.mjs')
const srcOut = join(root, 'src/vendor/mermaid.bundle.mjs')

function syncSrcFromPublic() {
  if (!existsSync(publicOut)) return
  mkdirSync(dirname(srcOut), { recursive: true })
  copyFileSync(publicOut, srcOut)
}

if (existsSync(publicOut) && process.env.FORCE_MERMAID_VENDOR !== '1') {
  syncSrcFromPublic()
  console.log('Mermaid vendor bundle exists — skip (set FORCE_MERMAID_VENDOR=1 to rebuild)')
  process.exit(0)
}

if (!existsSync(entry)) {
  if (existsSync(publicOut)) {
    syncSrcFromPublic()
    console.log('Synced src/vendor from public/vendor')
    process.exit(0)
  }
  console.error('Missing mermaid. Run: npm install')
  process.exit(1)
}

mkdirSync(dirname(publicOut), { recursive: true })

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['es2020'],
  outfile: publicOut,
  minify: true,
  legalComments: 'none'
})

syncSrcFromPublic()
console.log('Wrote', publicOut, 'and', srcOut)
