import sodium from "sodium-universal";
import crypto from "hypercore-crypto";
import b4a from "b4a";
import type { KeyPair } from "./config";

function curvePublic(edPublic: Buffer): Buffer {
  const out = b4a.alloc(sodium.crypto_box_PUBLICKEYBYTES);
  sodium.crypto_sign_ed25519_pk_to_curve25519(out, edPublic);
  return out;
}

export function sealTo(message: Buffer, edPublic: Buffer): Buffer {
  const out = b4a.alloc(message.length + sodium.crypto_box_SEALBYTES);
  sodium.crypto_box_seal(out, message, curvePublic(edPublic));
  return out;
}

export function openSealed(sealed: Buffer, kp: KeyPair): Buffer | null {
  if (sealed.length <= sodium.crypto_box_SEALBYTES) return null;
  const sk = b4a.alloc(sodium.crypto_box_SECRETKEYBYTES);
  sodium.crypto_sign_ed25519_sk_to_curve25519(sk, kp.secretKey);
  const out = b4a.alloc(sealed.length - sodium.crypto_box_SEALBYTES);
  const ok = sodium.crypto_box_seal_open(out, sealed, curvePublic(kp.publicKey), sk);
  return ok ? out : null;
}

export const signJson = (value: unknown, kp: KeyPair): string => b4a.toString(crypto.sign(b4a.from(JSON.stringify(value)), kp.secretKey), "hex");

export function verifyJson(value: unknown, sigHex: string, publicHex: string): boolean {
  try {
    return crypto.verify(b4a.from(JSON.stringify(value)), b4a.from(sigHex, "hex"), b4a.from(publicHex, "hex"));
  } catch {
    return false;
  }
}

export function safetyCode(token: Buffer, a: Buffer, b: Buffer): string {
  const [x, y] = b4a.compare(a, b) < 0 ? [a, b] : [b, a];
  const h = crypto.hash([token, x, y]);
  const n = h.readUInt32BE(0) % 1_000_000;
  const s = String(n).padStart(6, "0");
  return `${s.slice(0, 3)} ${s.slice(3)}`;
}
