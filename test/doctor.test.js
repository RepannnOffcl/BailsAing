import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { doctor } from '../src/doctor.js'

test('doctor reports auth directory health', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'baileys-doctor-'))
  const report = await doctor({ authDir: dir })
  assert.equal(report.authExists, true)
  assert.equal(report.writable, true)
  await fs.rm(dir, { recursive: true, force: true })
})
