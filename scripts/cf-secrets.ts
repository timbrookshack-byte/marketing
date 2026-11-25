/**
 * Pushes the secrets the Worker needs from .env to Cloudflare.
 *
 * Entering these by hand went wrong twice in the same way: dragging the .env
 * file onto the terminal inserts its *path*, so the stored secret became
 * "C:\\Users\\...\\.env". That is a plausible-looking string, so nothing caught
 * it until Google and Meta each rejected the client id. Reading the file
 * directly removes the step where that can happen.
 *
 * Values are written to the wrangler process on stdin and never printed. The
 * output names secrets only, so it is safe to paste into a chat or an issue.
 *
 *   npm run cf:secrets           push every secret listed below that .env has
 *   npm run cf:secrets -- NAME   push just one
 */
import { spawnSync } from "node:child_process";

import { parseEnvFile } from "./doctor-common";

/**
 * What the deployed Worker reads. Deliberately not "everything in .env":
 * most of that file is for connectors this portal does not use, and an unused
 * secret on the Worker is a liability with no benefit.
 *
 * Shopify is absent on purpose — its credentials are entered per connection in
 * the portal and read from the database, never from the environment.
 */
const WORKER_SECRETS = [
  "CREDENTIALS_KEY",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "META_ADS_CLIENT_ID",
  "META_ADS_CLIENT_SECRET",
  "META_AD_LIBRARY_TOKEN",
  "ANTHROPIC_API_KEY",
] as const;

/** Values that are almost certainly a mistake rather than a credential. */
export function suspect(name: string, value: string): string | null {
  if (value === "") return "empty";
  if (/^[A-Za-z]:[\\/]/.test(value) || value.includes("\\")) {
    return "looks like a Windows file path";
  }
  if (value.startsWith("/") && value.includes("/")) return "looks like a file path";
  if (/^(your|xxx|changeme|placeholder|todo)/i.test(value)) return "looks like a placeholder";
  if (name.endsWith("_CLIENT_ID") && value.length < 6) return "too short to be a client id";
  return null;
}

export function main(argv: string[], envFile = ".env", dryRun = false): number {
  const requested = argv.filter((a) => !a.startsWith("-"));
  const wanted = requested.length > 0 ? requested : [...WORKER_SECRETS];

  const env = parseEnvFile(envFile);
  if (!env.found) {
    console.error("No .env file in this directory. Run this from the project folder.");
    return 1;
  }

  if (env.duplicated.length > 0) {
    console.log(`Note: .env sets these more than once, last wins: ${env.duplicated.join(", ")}\n`);
  }

  let pushed = 0;
  let skipped = 0;
  let failed = 0;

  for (const name of wanted) {
    const value = env.values.get(name);

    if (value === undefined) {
      console.log(`skip     ${name}  (not in .env)`);
      skipped += 1;
      continue;
    }

    const problem = suspect(name, value);
    if (problem) {
      console.log(`REFUSED  ${name}  (${problem})`);
      failed += 1;
      continue;
    }

    if (dryRun) {
      console.log(`would push  ${name}  (${value.length} characters)`);
      pushed += 1;
      continue;
    }

    const result = spawnSync("npx", ["wrangler", "secret", "put", name], {
      input: value,
      stdio: ["pipe", "ignore", "inherit"],
      shell: process.platform === "win32",
    });

    if (result.status === 0) {
      console.log(`pushed   ${name}  (${value.length} characters)`);
      pushed += 1;
    } else {
      console.log(`FAILED   ${name}  (wrangler exited ${result.status})`);
      failed += 1;
    }
  }

  console.log(`\n${pushed} pushed, ${skipped} skipped, ${failed} failed.`);
  return failed > 0 ? 1 : 0;
}

// Only when run as a command, so the checks above can be imported and tested.
if (process.argv[1]?.includes("cf-secrets")) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  process.exit(main(args.filter((a) => a !== "--dry-run"), ".env", dryRun));
}
