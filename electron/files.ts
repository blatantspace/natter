import fs from "node:fs";
import crypto from "hypercore-crypto";
import c from "compact-encoding";
import b4a from "b4a";

export const CHUNK = 1024 * 1024;
export const HASH_BYTES = 32;

export const chunkCount = (size: number) => Math.ceil(size / CHUNK);

export interface ChunkRequest {
  rid: number;
  post: string;
  file: number;
  index: number;
}

export interface ChunkData {
  rid: number;
  data: Buffer;
}

export const chunkDataEncoding = {
  preencode(state: any, m: ChunkData) {
    c.uint.preencode(state, m.rid);
    c.buffer.preencode(state, m.data);
  },
  encode(state: any, m: ChunkData) {
    c.uint.encode(state, m.rid);
    c.buffer.encode(state, m.data);
  },
  decode(state: any): ChunkData {
    return { rid: c.uint.decode(state), data: c.buffer.decode(state) };
  },
};

export const hashChunk = (data: Buffer): Buffer => crypto.hash(data);

export async function readChunk(abs: string, size: number, index: number): Promise<Buffer> {
  const start = index * CHUNK;
  const length = Math.min(CHUNK, size - start);
  if (length <= 0) throw new Error("Chunk out of range");
  const fh = await fs.promises.open(abs, "r");
  try {
    const buf = Buffer.alloc(length);
    const { bytesRead } = await fh.read(buf, 0, length, start);
    if (bytesRead !== length) throw new Error("File is shorter than expected");
    return buf;
  } finally {
    await fh.close();
  }
}

export async function hashFiles(files: { abs: string; size: number }[], onBytes: (n: number) => void): Promise<Buffer> {
  const out: Buffer[] = [];
  const buf = Buffer.alloc(CHUNK);
  for (const f of files) {
    const fh = await fs.promises.open(f.abs, "r");
    try {
      for (let i = 0; i < chunkCount(f.size); i++) {
        const length = Math.min(CHUNK, f.size - i * CHUNK);
        const { bytesRead } = await fh.read(buf, 0, length, i * CHUNK);
        if (bytesRead !== length) throw new Error(`${f.abs} changed while sharing`);
        out.push(hashChunk(buf.subarray(0, length)));
        onBytes(length);
      }
    } finally {
      await fh.close();
    }
  }
  return b4a.concat(out);
}
