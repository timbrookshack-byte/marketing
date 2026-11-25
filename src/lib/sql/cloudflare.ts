/**
 * Installs D1 as the database, resolved per request.
 *
 * The binding lives on the request's environment rather than on the module, so
 * this registers a lookup rather than a handle. getCloudflareContext is how
 * OpenNext exposes that environment to application code; outside a request
 * there is nothing to return, which is why nothing here runs at import time.
 */

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { D1Database, type D1Like } from "./d1";
import { setDatabaseResolver } from "./index";

interface Bindings {
  DB?: D1Like;
}

export function installD1(): void {
  setDatabaseResolver(() => {
    const binding = (getCloudflareContext().env as Bindings).DB;
    if (!binding) {
      throw new Error(
        "No D1 binding named DB is attached to this Worker. It is declared in wrangler.jsonc " +
          "under d1_databases; if that entry is missing or its database_id is wrong, the Worker " +
          "deploys and then fails on the first query rather than at build time.",
      );
    }
    return new D1Database(binding);
  });
}
