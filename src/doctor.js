import fs from 'node:fs/promises'
import path from 'node:path'

export async function doctor(options = {}) {
  const authDir = path.resolve(options.authDir ?? './auth/baileys')
  const report = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    authDir,
    authExists: false,
    writable: false,
    files: [],
    warnings: []
  }
  try {
    const stat = await fs.stat(authDir)
    report.authExists = stat.isDirectory()
    const entries = await fs.readdir(authDir)
    report.files = entries.slice(0, 100)
    const probe = path.join(authDir, `.doctor-${process.pid}`)
    await fs.writeFile(probe, 'ok')
    await fs.unlink(probe)
    report.writable = true
  } catch (error) {
    report.warnings.push(error.message)
  }
  if (process.version.match(/^v(1[0-9]|2[0-1])\./)) report.warnings.push('Node 22+ is recommended for current Baileys engine builds.')
  if (!report.authExists) report.warnings.push('Auth directory belum dibuat; normal untuk instalasi baru.')
  return report
}
