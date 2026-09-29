import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const failures = []
const read = async file => fs.readFile(path.join(root, file), 'utf8')
const exists = async file => fs.stat(path.join(root, file)).then(() => true).catch(() => false)
const pkg = JSON.parse(await read('package.json'))
if (pkg.version !== '1.5.2') failures.push(`version must remain 1.5.2, got ${pkg.version}`)
if (pkg.dependencies?.ws || pkg.dependencies?.bufferutil || pkg.dependencies?.['utf-8-validate'] || pkg.dependencies?.sharp || pkg.dependencies?.['node-gyp']) failures.push('native/runtime addon dependency detected')
if (!pkg.files.includes('scripts/audit.mjs')) failures.push('scripts/audit.mjs missing from npm files')
for (const file of ['README.md','AUDIT.md','COMPATIBILITY.md']) { const text = await read(file); if (/dependency runtime .*only .*\bws\b/i.test(text) || /runtime dependency is .*\bws\b/i.test(text)) failures.push(`${file}: stale ws dependency claim`) }
if (pkg.dependencies?.['qrcode-terminal'] !== '0.12.0') failures.push('qrcode-terminal 0.12.0 missing')
for (const file of ['assets/banner.txt','src/auth/state.js','src/auth/file-store.js','src/auth/companion.js','src/pairing/code.js','src/pairing/qr.js','src/protocol/native-engine.js','src/protocol/signal/store.js','examples/start.mjs']) if (!await exists(file)) failures.push(`missing required file: ${file}`)
if (!(await read('src/pairing/code.js')).includes('code.length !== 8')) failures.push('pairing code validator is not strict 8 characters')
if (!(await read('src/protocol/native-engine.js')).includes('this.nodes.send(request)')) failures.push('pairing code transport send path missing')
if (!(await read('src/index.js')).includes('requestPairingCodeCustom')) failures.push('public custom pairing API missing')
if (!(await read('src/index.js')).includes('renderTerminalQR')) failures.push('terminal QR integration missing')
if (!(await read('src/banner.js')).includes('5000')) failures.push('five-second banner default missing')
async function auditLocalImportTargets() {
  const files = []
  const walk = async dir => {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (/\.(?:js|mjs|cjs)$/.test(entry.name)) {
        files.push(full)
      }
    }
  }
  await walk(path.join(root, 'src'))
  const localImport = /\b(?:import|export)\s+(?:(?:[^'\"]*?)\s+from\s+)?['\"](\.[^'\"]+)['\"]|\bimport\(\s*['\"](\.[^'\"]+)['\"]\s*\)/g
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8')
    let match
    while ((match = localImport.exec(source))) {
      const specifier = match[1] ?? match[2]
      const base = path.resolve(path.dirname(file), specifier)
      const candidates = [
        base,
        `${base}.js`, `${base}.mjs`, `${base}.cjs`,
        path.join(base, 'index.js'), path.join(base, 'index.mjs'), path.join(base, 'index.cjs')
      ]
      if (!candidates.length || !(await Promise.all(candidates.map(candidate => fs.stat(candidate).then(() => true).catch(() => false))).then(results => results.some(Boolean)))) {
        failures.push(`missing local import target: ${path.relative(root, file)} -> ${specifier}`)
      }
    }
  }
}
await auditLocalImportTargets()
const schema = await import(new URL('./../src/messaging/schema.js', import.meta.url))
const fields = Object.entries(schema.MESSAGE_FIELD_MAP)
const seen = new Set(); for (const [k,v] of fields) { if (seen.has(v)) failures.push(`duplicate message field mapping: ${v}`); seen.add(v); }
try { execFileSync('node', ['--check', 'src/index.js'], { cwd: root, stdio: 'ignore' }) } catch { failures.push('src/index.js syntax check failed') }
if (await exists('.gitignore')) {
  const gi = await read('.gitignore')
  if (/^auth\/$/m.test(gi)) failures.push('dangerous auth/ gitignore pattern can hide src/auth')
}
if (failures.length) {
  console.error('AUDIT FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('AUDIT PASS')
console.log(`package=${pkg.name}@${pkg.version}`)
console.log(`dependencies=${Object.keys(pkg.dependencies ?? {}).join(',') || 'none'}`)
console.log(`messageMappings=${fields.length}`)
