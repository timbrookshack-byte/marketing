/**
 * Runs once when the server starts, before it handles anything.
 *
 * Which database gets installed is decided by an explicit variable rather than
 * by sniffing the runtime. Under OpenNext a Worker looks enough like Node to
 * fool every check worth making, and a wrong guess here fails at the first
 * query rather than at startup.
 */
export async function register(): Promise<void> {
  if (process.env.RUNTIME === "cloudflare") {
    const { installD1 } = await import("./lib/sql/cloudflare");
    installD1();
    return;
  }

  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installSqlite } = await import("./lib/sql/node");
  installSqlite();
}
