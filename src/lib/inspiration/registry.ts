import { metaAdLibrarySource } from "./meta-ad-library";
import { tiktokCommercialSource } from "./tiktok-commercial";
import { linkedInAdLibrarySource } from "./linkedin-ad-library";
import { licensedProviderSource } from "./licensed-provider";
import { manualSource } from "./manual";
import type { InspirationSource, InspirationSourceId } from "./types";

/** Ordered by how much most teams will get out of them. */
export const inspirationSources: InspirationSource[] = [
  metaAdLibrarySource,
  tiktokCommercialSource,
  linkedInAdLibrarySource,
  licensedProviderSource,
  manualSource,
];

const byId = new Map<InspirationSourceId, InspirationSource>(
  inspirationSources.map((source) => [source.id, source]),
);

export function getInspirationSource(id: InspirationSourceId): InspirationSource {
  const source = byId.get(id);
  if (!source) throw new Error(`Unknown inspiration source: ${id}`);
  return source;
}

export function sourceLabel(id: InspirationSourceId | string): string {
  return byId.get(id as InspirationSourceId)?.displayName ?? String(id);
}

export interface SourceCatalogEntry {
  id: InspirationSourceId;
  displayName: string;
  summary: string;
  docsUrl: string;
  coverage: string;
  caveat: string | null;
  missingEnv: string[];
  configured: boolean;
  /** Searchable sources only; the manual source is added to, not queried. */
  searchable: boolean;
}

export function inspirationCatalog(): SourceCatalogEntry[] {
  return inspirationSources.map((source) => {
    const missingEnv = source.requiredEnv.filter((name) => !process.env[name]);
    return {
      id: source.id,
      displayName: source.displayName,
      summary: source.summary,
      docsUrl: source.docsUrl,
      coverage: source.capabilities.coverage,
      caveat: source.caveat ?? null,
      missingEnv,
      configured: missingEnv.length === 0,
      searchable: source.id !== "manual",
    };
  });
}
