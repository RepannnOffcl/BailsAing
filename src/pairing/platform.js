const CompanionWebClientType = Object.freeze({
  UNKNOWN: 0,
  CHROME: 1,
  EDGE: 2,
  FIREFOX: 3,
  IE: 4,
  OPERA: 5,
  SAFARI: 6,
  ELECTRON: 7,
  UWP: 8,
  OTHER_WEB_CLIENT: 9
})

const browserMap = Object.freeze({ Chrome: 1, Edge: 2, Firefox: 3, IE: 4, Opera: 5, Safari: 6 })
export const DEFAULT_PUBLIC_BROWSER = Object.freeze(['Ubuntu', 'Chrome', '1.0'])

export function normalizeBrowserTuple(browser) {
  if (!Array.isArray(browser) || browser.length < 2) return [...DEFAULT_PUBLIC_BROWSER]
  const [os = DEFAULT_PUBLIC_BROWSER[0], browserName = DEFAULT_PUBLIC_BROWSER[1], version = DEFAULT_PUBLIC_BROWSER[2]] = browser
  return [String(os || DEFAULT_PUBLIC_BROWSER[0]), String(browserName || DEFAULT_PUBLIC_BROWSER[1]), String(version || DEFAULT_PUBLIC_BROWSER[2])]
}

export function getCompanionPlatformId(browser = DEFAULT_PUBLIC_BROWSER) {
  const [os = '', browserName = 'Chrome'] = Array.isArray(browser) ? browser : ['', String(browser)]
  if (browserName === 'Desktop') return String(os === 'Windows' ? CompanionWebClientType.UWP : CompanionWebClientType.ELECTRON)
  return String(browserMap[browserName] ?? CompanionWebClientType.OTHER_WEB_CLIENT)
}

export function getCompanionPlatformDisplay(browser = DEFAULT_PUBLIC_BROWSER, fallback = 'Chrome (Ubuntu)') {
  const normalized = normalizeBrowserTuple(browser)
  const [os = 'Ubuntu', browserName = 'Chrome'] = normalized
  if (browserName === 'Desktop') return `${browserName} (${os})`
  return `${browserName} (${os})`
}

export { CompanionWebClientType }
