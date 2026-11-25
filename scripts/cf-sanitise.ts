/**
 * Strips local .env values out of the Cloudflare build output.
 *
 * `next build` reads .env, and the OpenNext adapter bakes what it finds into
 * the bundle two ways: a generated `cloudflare/next-env.mjs` exporting every
 * value, and a verbatim copy of .env beside the server handler. Both are
 * uploaded with the Worker.
 *
 * At runtime this does not change behaviour, because the adapter populates
 * process.env from the Cloudflare env first and only fills gaps from those
 * baked values (`process.env[key] ??= ...` in its init template). But it does
 * mean credentials sit in the deployed artifact, readable to anyone who can
 * view the Worker's code. Secrets belong in `wrangler secret put` alone.
 *
 * Removing them also makes a missing variable fail loudly instead of silently
 * falling back to whatever the developer's machine happened to have — the
 * difference between an obvious error and an OAuth redirect quietly pointing
 * at localhost.
 *
 * Runs as part of `npm run cf:build`, after the adapter and before deploy.
 */
import { readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = ".open-next";

/** Every file named `.env` or `.env.*` anywhere in the build output. */
function envFiles(dir: string): string[] {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const path = join(dir, entry);
    let isDirectory: boolean;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) {
      found.push(...envFiles(path));
    } else if (entry === ".env" || entry.startsWith(".env.")) {
      found.push(path);
    }
  }
  return found;
}

const removed: string[] = [];

for (const file of envFiles(ROOT)) {
  rmSync(file, { force: true });
  removed.push(relative(ROOT, file));
}

// Replace rather than delete: the worker imports this module unconditionally,
// so it has to exist and export the three modes the init template looks up.
const generated = join(ROOT, "cloudflare", "next-env.mjs");
let neutralised = false;
try {
  if (statSync(generated).isFile()) {
    writeFileSync(
      generated,
      [
        "// Emptied after build. Values come from the Worker's vars and secrets;",
        "// see scripts/cf-sanitise.ts.",
        "export const production = {};",
        "export const development = {};",
        "export const test = {};",
        "",
      ].join("\n"),
      "utf8",
    );
    neutralised = true;
  }
} catch {
  // Not produced by this adapter version; nothing to neutralise.
}

if (removed.length === 0 && !neutralised) {
  console.log("cf-sanitise: nothing to strip.");
} else {
  for (const file of removed) console.log(`cf-sanitise: removed ${file}`);
  if (neutralised) console.log("cf-sanitise: emptied cloudflare/next-env.mjs");
}
