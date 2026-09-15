import crypto from "node:crypto";

/**
 * Credential storage. Tokens are encrypted at rest with AES-256-GCM so a leaked
 * database file is not a leaked set of ad accounts.
 *
 * The key comes from CREDENTIALS_KEY (32 bytes, base64 or hex). In development
 * we fall back to a key derived from a fixed string so the app runs without
 * setup — startup logs a warning and refuses that fallback when NODE_ENV is
 * production.
 */

const ALGO = "aes-256-gcm";

let cachedKey: Buffer | null = null;

function resolveKey(): Buffer {
  if (cachedKey) return cachedKey;

  const raw = process.env.CREDENTIALS_KEY;
  if (raw) {
    const buf = /^[0-9a-f]{64}$/i.test(raw)
      ? Buffer.from(raw, "hex")
      : Buffer.from(raw, "base64");
    if (buf.length !== 32) {
      throw new Error(
        "CREDENTIALS_KEY must decode to exactly 32 bytes (use `openssl rand -base64 32`)",
      );
    }
    cachedKey = buf;
    return buf;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CREDENTIALS_KEY is required in production. Generate one with `openssl rand -base64 32`.",
    );
  }

  console.warn(
    "[crypto] CREDENTIALS_KEY not set — using an insecure development key. " +
      "Set CREDENTIALS_KEY before connecting real ad accounts.",
  );
  cachedKey = crypto.scryptSync("marketing-360-dev-key", "marketing-360-dev", 32);
  return cachedKey;
}

export function encryptJson(value: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, resolveKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(".");
}

export function decryptJson<T>(payload: string): T {
  const [ivB64, tagB64, dataB64] = payload.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload");
  }
  const decipher = crypto.createDecipheriv(ALGO, resolveKey(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

/** Opaque, unguessable state value for the OAuth handshake. */
export function randomToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("base64url");
}

/** PKCE pair for the connectors that require it. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
