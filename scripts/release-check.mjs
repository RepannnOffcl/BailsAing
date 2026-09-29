import fs from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'))
const failures = []
if (pkg.name !== '@repanxtenka/baileys') failures.push(`package.name=${pkg.name}`)
if (pkg.version !== '1.5.2') failures.push(`package.version=${pkg.version}`)
if (pkg.repository?.url !== 'git+https://github.com/RepannnOffcl/BailsAing.git') failures.push(`repository=${pkg.repository?.url}`)
if (pkg.homepage !== 'https://github.com/RepannnOffcl/BailsAing') failures.push(`homepage=${pkg.homepage}`)
const forbidden = [
  ['@akuliketenka/', 'bail' + 'ss'].join(''),
  ['@akuliketenka/', 'baileys'].join(''),
  ['@repanoffcl/', 'bail' + 'ss'].join(''),
  ['@repanoffcl/', 'baileys'].join(''),
  ['@repanxtenka/', 'b' + 'ai' + 'keys'].join(''),
  ['@repanxtenka/', 'bail' + 'ss'].join(''),
  ['github.com/', 'repanxtenka/baileys'].join('')
]
for (const token of forbidden) {
  let hit = ''
  try { hit = execFileSync('grep', ['-RIn', '--exclude-dir=.git', '--exclude-dir=node_modules', '--exclude=release-check.mjs', token, 'package.json', 'README.md', 'COMPATIBILITY.md', 'CHANGELOG.md', 'SECURITY.md', 'src', 'examples', 'test', '.github'], { cwd: root, encoding: 'utf8' }) } catch {}
  if (hit.trim()) failures.push(`stale reference: ${token}`)
}
let trackedAuth = ''
try { trackedAuth = execFileSync('git', ['ls-files', 'auth'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }) } catch {}
if (trackedAuth.trim()) failures.push(`tracked auth files: ${trackedAuth.trim()}`)
if (!pkg.files.includes('COMPATIBILITY.md')) failures.push('COMPATIBILITY.md is not in npm files')
if (pkg.dependencies?.ws) failures.push('ws dependency must not be a runtime dependency')
if (pkg.dependencies?.sharp || pkg.dependencies?.bufferutil || pkg.dependencies?.['utf-8-validate'] || pkg.dependencies?.['node-gyp']) failures.push('native addon/build dependency must not be a runtime dependency')
if (pkg.dependencies?.['qrcode-terminal'] !== '0.12.0') failures.push('qrcode-terminal dependency missing or unexpected version')
if (!pkg.scripts?.start) failures.push('npm start script missing')
if (!pkg.scripts?.audit) failures.push('npm audit script missing')
if (!await fs.stat(path.join(root, '.gitignore')).then(() => true).catch(() => false)) failures.push('.gitignore missing')
if (failures.length) {
  console.error('RELEASE CHECK FAILED')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}
console.log('RELEASE CHECK PASS')
console.log(`npm: ${pkg.name}@${pkg.version}`)
console.log('github: RepannnOffcl/BailsAing')
