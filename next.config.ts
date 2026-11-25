import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // better-sqlite3 is a native module: keep it out of the bundler. It is also
  // loaded through a computed specifier in src/lib/sql/sqlite.ts, which is what
  // keeps it out of the traced standalone output — see the note there.
  serverExternalPackages: ["better-sqlite3"],
  typedRoutes: false,
};

export default nextConfig;
