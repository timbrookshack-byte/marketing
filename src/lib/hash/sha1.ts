/**
 * SHA-1, synchronously, in plain TypeScript.
 *
 * stableId derives every primary key in the database from this hash, so it has
 * to keep producing exactly what node:crypto produced — a different digest
 * means new ids for rows that already exist, and every campaign, ad group and
 * ad in the database orphaned from its metrics.
 *
 * It also has to stay synchronous. Ids are built inline, inside object
 * literals, in dozens of places; Web Crypto's digest is async and making
 * stableId async would spread awaits through code that has nothing to do with
 * hashing. Workers has no node:crypto, so the implementation comes here.
 *
 * SHA-1 is not used for anything security-bearing: these are identifiers, not
 * signatures or password hashes.
 */

function rotl(value: number, bits: number): number {
  return (value << bits) | (value >>> (32 - bits));
}

export function sha1(input: string): Uint8Array {
  const bytes = new TextEncoder().encode(input);

  // Message + 0x80 + zero padding + 64-bit big-endian bit length.
  const bitLength = bytes.length * 8;
  const padded = new Uint8Array(((bytes.length + 8) >> 6) * 64 + 64);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, bitLength >>> 0, false);
  new DataView(padded.buffer).setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32), false);

  let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  const words = new Uint32Array(80);
  const view = new DataView(padded.buffer);

  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i += 1) {
      words[i] = rotl(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
    }

    let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
    for (let i = 0; i < 80; i += 1) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (rotl(a, 5) + f + e + k + words[i]) >>> 0;
      [e, d, c, b, a] = [d, c, rotl(b, 30) >>> 0, a, temp];
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
  }

  const digest = new Uint8Array(20);
  const out = new DataView(digest.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => out.setUint32(i * 4, h, false));
  return digest;
}

/** base64url, matching what node:crypto's digest("base64url") produced. */
export function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
