// AccountVault WebDAV End-to-End Crypto & TOTP (MV3 Service Worker compatible)
// Matches src-tauri/src/vault.rs: Scrypt(N=32768, r=8, p=1, dkLen=32) + AES-256-GCM (AAD="AccountVault:1")

const AAD_BYTES = new TextEncoder().encode("AccountVault:1");

export function hexToBytes(hex) {
  const clean = (hex || "").trim();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += bytes[i].toString(16).padStart(2, "0");
  }
  return s;
}

function bytesToBase64(bytes) {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

async function pbkdf2Sha256(passwordBytes, saltBytes, lengthBytes) {
  const key = await crypto.subtle.importKey("raw", passwordBytes, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: saltBytes, iterations: 1, hash: "SHA-256" },
    key,
    lengthBytes * 8
  );
  return new Uint8Array(bits);
}

function salsa20_8(B) {
  const x = new Int32Array(16);
  for (let i = 0; i < 16; i++) x[i] = B[i];
  const R = (a, b) => (a << b) | (a >>> (32 - b));
  for (let i = 8; i > 0; i -= 2) {
    x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
    x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
    x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
    x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
    x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
    x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
    x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
    x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
  }
  for (let i = 0; i < 16; i++) B[i] = (B[i] + x[i]) | 0;
}

function blockMix(src, dst, r) {
  const X = new Int32Array(16);
  const lastOff = (2 * r - 1) * 16;
  for (let i = 0; i < 16; i++) X[i] = src[lastOff + i];
  for (let i = 0; i < 2 * r; i++) {
    const bOff = i * 16;
    for (let j = 0; j < 16; j++) X[j] ^= src[bOff + j];
    salsa20_8(X);
    const destOff = ((i >> 1) + (i & 1) * r) * 16;
    for (let j = 0; j < 16; j++) dst[destOff + j] = X[j];
  }
}

export async function scryptDeriveKey(password, saltBytes) {
  const N = 32768;
  const r = 8;
  const dkLen = 32;
  const pwdBytes = new TextEncoder().encode(password);
  const B = await pbkdf2Sha256(pwdBytes, saltBytes, 128 * r);
  const dv = new DataView(B.buffer, B.byteOffset, B.byteLength);
  const blockWords = 32 * r;

  const X = new Int32Array(blockWords);
  const Y = new Int32Array(blockWords);
  for (let i = 0; i < blockWords; i++) {
    X[i] = dv.getInt32(i * 4, true);
  }

  const V = new Int32Array(N * blockWords);
  for (let i = 0; i < N; i++) {
    V.set(X, i * blockWords);
    blockMix(X, Y, r);
    X.set(Y);
  }

  for (let i = 0; i < N; i++) {
    const j = (X[(2 * r - 1) * 16] >>> 0) & (N - 1);
    const vOff = j * blockWords;
    for (let k = 0; k < blockWords; k++) {
      X[k] ^= V[vOff + k];
    }
    blockMix(X, Y, r);
    X.set(Y);
  }

  const outB = new Uint8Array(blockWords * 4);
  const outDv = new DataView(outB.buffer);
  for (let i = 0; i < blockWords; i++) {
    outDv.setInt32(i * 4, X[i], true);
  }

  return pbkdf2Sha256(pwdBytes, outB, dkLen);
}

export async function decryptVaultEnvelope(blobText, masterPassword) {
  const env = JSON.parse(blobText);
  if (!env || !env.salt || !env.nonce || !env.data) {
    throw new Error("云端保险库格式无效");
  }
  const saltBytes = hexToBytes(env.salt);
  const nonceBytes = hexToBytes(env.nonce);
  const cipherBytes = base64ToBytes(env.data);

  const keyBytes = await scryptDeriveKey(masterPassword, saltBytes);
  const aesKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);

  let plainBuf;
  try {
    plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonceBytes, additionalData: AAD_BYTES },
      aesKey,
      cipherBytes
    );
  } catch {
    throw new Error("主密码错误，或云端数据已损坏");
  }

  const records = JSON.parse(new TextDecoder().decode(plainBuf));
  return { records, keyHex: bytesToHex(keyBytes), saltHex: env.salt };
}

export async function encryptVaultEnvelope(records, keyHex, saltHex) {
  const keyBytes = hexToBytes(keyHex);
  const nonceBytes = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const rawBytes = new TextEncoder().encode(JSON.stringify(records));
  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonceBytes, additionalData: AAD_BYTES },
    aesKey,
    rawBytes
  );
  return JSON.stringify(
    {
      version: 1,
      salt: saltHex,
      nonce: bytesToHex(nonceBytes),
      data: bytesToBase64(new Uint8Array(cipherBuf))
    },
    null,
    2
  );
}

function mergeKey(r) {
  const id = (r.id || "").trim();
  if (id) return id;
  return (r.email || "").trim().toLowerCase();
}

export function smartMergeRecords(localRecords, remoteRecords) {
  const map = new Map();
  for (const r of localRecords || []) {
    map.set(mergeKey(r), r);
  }
  for (const rem of remoteRecords || []) {
    const k = mergeKey(rem);
    const loc = map.get(k);
    if (!loc) {
      map.set(k, rem);
    } else {
      const remTime = rem.deleted_at ?? rem.updated_at ?? 0;
      const locTime = loc.deleted_at ?? loc.updated_at ?? 0;
      if (remTime > locTime) {
        map.set(k, rem);
      }
    }
  }
  return Array.from(map.values());
}

function decodeBase32(input) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  const out = [];
  let buffer = 0;
  let bitsLeft = 0;
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    buffer = (buffer << 5) | idx;
    bitsLeft += 5;
    if (bitsLeft >= 8) {
      out.push((buffer >>> (bitsLeft - 8)) & 0xff);
      bitsLeft -= 8;
    }
  }
  return new Uint8Array(out);
}

export async function generateTotp(rawSecret) {
  if (!rawSecret || !rawSecret.trim()) return { code: "", remaining: 0 };
  try {
    let secret = rawSecret.trim();
    if (secret.toLowerCase().startsWith("otpauth://")) {
      const m = secret.match(/[?&]secret=([^&]+)/i);
      if (m) secret = decodeURIComponent(m[1]);
    }
    const keyBytes = decodeBase32(secret);
    if (keyBytes.length === 0) return { code: "", remaining: 0 };

    const nowSec = Math.floor(Date.now() / 1000);
    const step = Math.floor(nowSec / 30);
    const remaining = 30 - (nowSec % 30);

    const msg = new Uint8Array(8);
    const dv = new DataView(msg.buffer);
    dv.setUint32(0, Math.floor(step / 0x100000000), false);
    dv.setUint32(4, step >>> 0, false);

    const hmacKey = await crypto.subtle.importKey(
      "raw",
      keyBytes,
      { name: "HMAC", hash: "SHA-1" },
      false,
      ["sign"]
    );
    const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, msg));
    const offset = sig[sig.length - 1] & 0x0f;
    const binary =
      ((sig[offset] & 0x7f) << 24) |
      ((sig[offset + 1] & 0xff) << 16) |
      ((sig[offset + 2] & 0xff) << 8) |
      (sig[offset + 3] & 0xff);
    const otp = (binary % 1000000).toString().padStart(6, "0");
    return { code: otp, remaining };
  } catch {
    return { code: "", remaining: 0 };
  }
}
