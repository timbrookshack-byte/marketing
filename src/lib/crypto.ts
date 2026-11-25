/**
 * Credential storage. Tokens are encrypted at rest with AES-256-GCM so a leaked
 * database file is not a leaked set of ad accounts.
 *
 * Web Crypto rather than node:crypto, because Workers has no node:crypto. The
 * stored format is unchanged — iv.tag.ciphertext, each base64 — so credentials
 * written by the previous implementation still decrypt. Web Crypto returns the
 * authentication tag appended to the ciphertext rather than separately, so it
 * is split back out on the way in and rejoined on the way out.
 *
 * The cost of the move is that these are now async. There is no synchronous
 * subtle crypto anywhere, on any runtime.
 */

const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

let cachedKey: Promise<CryptoKey> | null = null;

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromHex(value: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * The development fallback.
 *
 * The previous implementation derived this with scrypt, which Web Crypto does
 * not have; PBKDF2 is the nearest thing it does. The derived key therefore
 * differs, so anything encrypted under the old development key cannot be read
 * and the account has to be reconnected. That only affects installs which never
 * set CREDENTIALS_KEY — and those were already storing tokens under a key
 * published in this file, which is why it warns.
 */
async function developmentKey(): Promise<CryptoKey> {
  console.warn(
    "[crypto] CREDENTIALS_KEY not set — using an insecure development key. " +
      "Set CREDENTIALS_KEY before connecting real ad accounts.",
  );
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("marketing-360-dev-key"),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode("marketing-360-dev"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function resolveKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;

  cachedKey = (async () => {
    const raw = process.env.CREDENTIALS_KEY;
    if (raw) {
      const bytes = /^[0-9a-f]{64}$/i.test(raw) ? fromHex(raw) : fromBase64(raw);
      if (bytes.length !== KEY_LENGTH) {
        throw new Error(
          "CREDENTIALS_KEY must decode to exactly 32 bytes (use `openssl rand -base64 32`)",
        );
      }
      return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
    }

    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "CREDENTIALS_KEY is required in production. Generate one with `openssl rand -base64 32`.",
      );
    }
    return developmentKey();
  })();

  return cachedKey;
}

export async function encryptJson(value: unknown): Promise<string> {
  const iv = new Uint8Array(new ArrayBuffer(IV_LENGTH));
  crypto.getRandomValues(iv);

  const sealed = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      await resolveKey(),
      new TextEncoder().encode(JSON.stringify(value)),
    ),
  );

  // Web Crypto appends the tag; the stored format keeps it separate.
  const ciphertext = sealed.slice(0, sealed.length - TAG_LENGTH);
  const tag = sealed.slice(sealed.length - TAG_LENGTH);
  return [toBase64(iv), toBase64(tag), toBase64(ciphertext)].join(".");
}

export async function decryptJson<T>(payload: string): Promise<T> {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload");
  }

  const ciphertext = fromBase64(dataB64);
  const tag = fromBase64(tagB64);
  const sealed = new Uint8Array(new ArrayBuffer(ciphertext.length + tag.length));
  sealed.set(ciphertext);
  sealed.set(tag, ciphertext.length);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivB64) },
    await resolveKey(),
    sealed,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/** Opaque, unguessable state value for the OAuth handshake. */
export function randomToken(bytes = 24): string {
  const value = new Uint8Array(new ArrayBuffer(bytes));
  crypto.getRandomValues(value);
  return toBase64(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE pair for the connectors that require it. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomToken(48);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
  );
  const challenge = toBase64(digest).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { verifier, challenge };
}
