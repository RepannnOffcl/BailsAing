(async () => {
  const { doctor } = await import('./doctor.js')
  const report = await doctor({ authDir: process.argv[2] || './auth/baileys' })
  console.log(JSON.stringify(report, null, 2))
})().catch(error => { console.error(error); process.exitCode = 1 })
