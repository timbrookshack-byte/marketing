import { defineCloudflareConfig } from "@opennextjs/cloudflare";

/**
 * OpenNext adapts the Next build to the Workers runtime.
 *
 * No incremental cache is configured: every page in this portal is
 * force-dynamic and reads the database on each request, so there is nothing a
 * cache could serve that would not be stale.
 */
export default defineCloudflareConfig({});
