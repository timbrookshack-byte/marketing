/**
 * Runs once when the server starts, before it handles anything.
 *
 * This is where the local database is installed for a Node server. On Workers
 * the entry point installs D1 per request instead, and this file's import of
 * the native driver never executes because the runtime check fails first.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installSqlite } = await import("./lib/sql/node");
  installSqlite();
}
