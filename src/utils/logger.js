export function createFallbackLogger(level = 'info') {
  const rank = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, fatal: 60 }
  const min = rank[level] ?? rank.info
  const log = (name, value) => {
    if ((rank[name] ?? 30) < min) return
    const prefix = `[RepanXTEnka:${name}]`
    if (value instanceof Error) console.error(prefix, value.stack || value.message)
    else if (typeof value === 'object') console.log(prefix, JSON.stringify(value))
    else console.log(prefix, value)
  }
  return Object.fromEntries(Object.keys(rank).map(name => [name, (...args) => log(name, args.length > 1 ? args : args[0])]))
}

export async function createLogger(options = {}) {
  if (options.logger) return options.logger
  try {
    const { default: pino } = await import('pino')
    return pino({ level: options.logLevel ?? 'info' })
  } catch {
    return createFallbackLogger(options.logLevel ?? 'info')
  }
}
