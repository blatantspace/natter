import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'queueue-spike-'))

async function peer (name) {
  const store = new Corestore(path.join(root, name))
  const swarm = new Hyperswarm()
  swarm.on('connection', (conn) => store.replicate(conn))
  return { store, swarm }
}

const a = await peer('a')
const b = await peer('b')

const driveA = new Hyperdrive(a.store)
await driveA.ready()
await driveA.put('/hello.txt', b4a.from('hello from queueue ' + Date.now()))
console.log('A wrote drive', b4a.toString(driveA.key, 'hex').slice(0, 12))

a.swarm.join(driveA.discoveryKey, { server: true, client: true })
await a.swarm.flush()

const driveB = new Hyperdrive(b.store, driveA.key)
await driveB.ready()
b.swarm.join(driveB.discoveryKey, { server: false, client: true })
const done = driveB.findingPeers()
b.swarm.flush().then(done, done)

const t0 = Date.now()
while (driveB.version < 2 && Date.now() - t0 < 30000) {
  await driveB.update({ wait: true })
  if (driveB.version < 2) await new Promise((r) => setTimeout(r, 250))
}
const buf = await driveB.get('/hello.txt', { wait: true, timeout: 30000 })
console.log('B read:', buf && b4a.toString(buf), `(${Date.now() - t0}ms)`)

await a.swarm.destroy(); await b.swarm.destroy()
await driveA.close(); await driveB.close()
await a.store.close(); await b.store.close()
fs.rmSync(root, { recursive: true, force: true })
process.exit(buf ? 0 : 1)
