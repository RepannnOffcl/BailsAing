import { readBanner } from '../src/banner.js'

export const BAILEYS_BANNER = await readBanner()
console.log(BAILEYS_BANNER)
