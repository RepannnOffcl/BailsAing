import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
let chalkPromise = null
const getChalk = () => {
  chalkPromise ??= import('chalk').then(mod => mod.default).catch(() => null)
  return chalkPromise
}

const BANNER_FILE = fileURLToPath(new URL('../assets/banner.txt', import.meta.url))
let bannerTextPromise = null
let bannerRun = null

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export async function readBanner() {
  bannerTextPromise ??= fs.readFile(BANNER_FILE, 'utf8').catch(() => 'RepanOffcl Baileys 1.5.2')
  return bannerTextPromise
}

function shouldShowBanner(options = {}) {
  if (options.banner === false) return false
  if (String(process.env.BAILEYS_BANNER ?? '').trim() === '0') return false
  if (options.bannerInNonTTY === true) return true
  return Boolean(process.stdout?.isTTY)
}

function terminalSize() {
  const columns = Math.max(40, Number(process.stdout?.columns ?? 80) || 80)
  const rows = Math.max(12, Number(process.stdout?.rows ?? 24) || 24)
  return { columns, rows }
}

function compressLine(line, columns) {
  const chars = Array.from(String(line))
  const limit = Math.max(20, columns - 2)
  if (chars.length <= limit) return String(line)
  const stride = chars.length / limit
  let out = ''
  for (let i = 0; i < limit; i += 1) out += chars[Math.min(chars.length - 1, Math.floor(i * stride))]
  return out
}

function fitBanner(text) {
  const { columns, rows } = terminalSize()
  const lines = String(text).replace(/\r/g, '').replace(/\s+$/g, '').split('\n')
  const fitted = lines.map(line => compressLine(line, columns))
  const availableRows = Math.max(8, rows - 2)
  if (fitted.length <= availableRows) return fitted
  const stride = fitted.length / availableRows
  const sampled = []
  for (let i = 0; i < availableRows; i += 1) sampled.push(fitted[Math.min(fitted.length - 1, Math.floor(i * stride))])
  return sampled
}

export async function showStartupBanner(options = {}) {
  if (!shouldShowBanner(options)) return false
  if (!bannerRun) {
    bannerRun = (async () => {
      const durationMs = Math.min(10_000, Math.max(0, Number(options.bannerDurationMs ?? 5000)))
      const text = await readBanner()
      const chalk = await getChalk()
      const out = process.stdout
      const render = fitBanner(text)
      const color = (code, value) => chalk ? chalk[code](value) : `\x1b[${code === 'cyanBright' ? '96' : '97'}m${value}\x1b[0m`
      const styled = render.map((line, index) => color(index === render.length - 1 ? 'whiteBright' : 'cyanBright', line)).join('\n')

      // Alternate screen prevents startup logs from scrolling the banner off-screen.
      // Cursor + wrap are restored in finally so a crash/cancel never leaves the terminal broken.
      out.write('\x1b[?1049h\x1b[?25l\x1b[?7l\x1b[2J\x1b[H')
      try {
        out.write(styled + '\n')
        if (durationMs > 0) await sleep(durationMs)
      } finally {
        out.write('\x1b[0m\x1b[?7h\x1b[?25h\x1b[2J\x1b[H\x1b[?1049l')
      }
      return true
    })().catch(() => false)
  }
  return bannerRun
}

export function resetStartupBannerForTests() {
  bannerRun = null
}
