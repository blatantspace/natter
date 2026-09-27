// Drive a running queueue instance over Chrome DevTools Protocol.
// usage: node spike/cdp.mjs <port> eval "<js expression>"
//        node spike/cdp.mjs <port> shot <out.png>
import fs from 'node:fs'

const [port, cmd, arg] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('no page target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
let n = 0
const pending = new Map()
ws.onmessage = (e) => {
  const m = JSON.parse(e.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
}
const send = (method, params = {}) => new Promise((r) => { const id = ++n; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })) })

if (cmd === 'eval') {
  const res = await send('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true })
  if (res.result?.exceptionDetails) {
    console.error('ERR', res.result.exceptionDetails.exception?.description || JSON.stringify(res.result.exceptionDetails))
    process.exitCode = 1
  } else {
    const v = res.result?.result?.value
    console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2))
  }
} else if (cmd === 'shot') {
  const res = await send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(arg, Buffer.from(res.result.data, 'base64'))
  console.log('saved', arg)
}
ws.close()
