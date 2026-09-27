/**
 * Client-side WebCrypto AES-GCM-256 Engine.
 * Keys are derived locally and never leave the browser.
 * Servers and network relays only see ciphertext and initialization vectors.
 */

const DEFAULT_SALT = "natter-sovereign-canadian-lounge-v1";

export async function deriveKeyFromPassphrase(passphrase: string, saltStr: string = DEFAULT_SALT): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: enc.encode(saltStr),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptText(text: string, key: CryptoKey): Promise<{ ciphertext: string; iv: string }> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = enc.encode(text);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    iv: bytesToBase64(iv),
  };
}

export async function decryptText(ciphertextB64: string, ivB64: string, key: CryptoKey): Promise<string> {
  const dec = new TextDecoder();
  const iv = base64ToBytes(ivB64);
  const data = base64ToBytes(ciphertextB64);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    data
  );

  return dec.decode(decrypted);
}

export async function encryptFile(file: File, key: CryptoKey): Promise<{ encryptedBlob: Blob; iv: string; originalName: string; mimeType: string; size: number }> {
  const buffer = await file.arrayBuffer();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    buffer
  );

  return {
    encryptedBlob: new Blob([encrypted], { type: "application/octet-stream" }),
    iv: bytesToBase64(iv),
    originalName: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };
}

export async function decryptFile(encryptedBuffer: ArrayBuffer, ivB64: string, mimeType: string, key: CryptoKey): Promise<Blob> {
  const iv = base64ToBytes(ivB64);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encryptedBuffer
  );

  return new Blob([decrypted], { type: mimeType });
}

export function generateRandomRoomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
