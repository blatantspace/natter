const { app } = require('electron')
const { spawnSync } = require('node:child_process')

app.whenReady().then(async () => {
  try {
    await import('../spike/replicate.mjs')
  } catch (err) {
    console.error('ELECTRON SPIKE FAILED', err)
    app.exit(1)
  }
})
void spawnSync
