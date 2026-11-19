import type { Recipe, RecipeContext, RecipeResult } from "./types.js";
import { azbigmedia } from "./azbigmedia.js";
import { apsense } from "./apsense.js";
import { issuewire } from "./issuewire.js";
import { einnews } from "./einnews.js";

// Domains that get their own discovery path. To add one: write a recipe file
// in this folder and add a line here. Everything else in the crawl (reading
// posts, day window, limits, saving) is the normal pipeline.
export const RECIPES: Record<string, Recipe> = {
  "azbigmedia.com": azbigmedia,
  "apsense.com": apsense,
  "issuewire.com": issuewire,
  "einnews.com": einnews,
};

export function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/^www\./, "");
}

export function hasRecipe(domain: string, registry: Record<string, Recipe> = RECIPES): boolean {
  return Object.prototype.hasOwnProperty.call(registry, normalizeDomain(domain));
}

// Never throws. A recipe that fails, finds nothing, or is switched off
// (DISABLE_RECIPES=1) returns null and the normal discovery runs as usual.
export async function runRecipe(ctx: RecipeContext, registry: Record<string, Recipe> = RECIPES): Promise<RecipeResult | null> {
  if (process.env.DISABLE_RECIPES === "1") return null;
  if (!hasRecipe(ctx.domain, registry)) return null;
  const recipe = registry[normalizeDomain(ctx.domain)];
  try {
    const result = await recipe(ctx);
    if (!result || result.posts.length === 0) return null;
    return result;
  } catch (err) {
    console.warn(`[recipe] ${ctx.domain} failed, using normal discovery: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));
    return null;
  }
}
