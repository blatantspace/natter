import Corestore from 'corestore'
import Hyperdrive from 'hyperdrive'
import Hyperswarm from 'hyperswarm'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'queueue-rec-'))
const secret = crypto.randomBytes(32)
const encryptionKey = crypto.hash([secret, b4a.from('queueue:enc')])
const topic = crypto.hash([secret, b4a.from('queueue:topic')])

const sa = new Corestore(path.join(root, 'a'))
const sb = new Corestore(path.join(root, 'b'))
const wa = new Hyperswarm(); const wb = new Hyperswarm()
wa.on('connection', (c) => sa.replicate(c))
wb.on('connection', (c) => sb.replicate(c))

const a = new Hyperdrive(sa.namespace('me'), { encryptionKey })
await a.ready()
await a.putEntry('/posts/p1', { metadata: { id: 'p1', title: 'Dune', n: 3 } })
await a.put('/files/p1/readme.txt', b4a.from('spice'))

wa.join(topic); wb.join(topic)
await wa.flush()

const b = new Hyperdrive(sb, a.key, { encryptionKey })
await b.ready()
const t0 = Date.now()
while (b.version < 3 && Date.now() - t0 < 30000) {
  await b.update({ wait: true })
  if (b.version < 3) await new Promise((r) => setTimeout(r, 250))
}
for await (const e of b.list('/posts')) console.log('record', e.key, JSON.stringify(e.value.metadata))
console.log('blob', b4a.toString(await b.get('/files/p1/readme.txt')))

const wrong = new Hyperdrive(new Corestore(path.join(root, 'c')), a.key, { encryptionKey: crypto.randomBytes(32) })
await wrong.ready()
console.log('raw core block is ciphertext:', !b4a.toString((await sb.get({ key: a.key }).get(1)) || b4a.alloc(0)).includes('Dune'))

await wa.destroy(); await wb.destroy()
process.exit(0)
