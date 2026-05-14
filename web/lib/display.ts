/**
 * Pure display helpers — safe to import from client components.
 *
 * Kept separate from lib/db.ts because lib/db.ts imports node:fs and therefore
 * cannot be referenced from anywhere webpack might try to bundle for the
 * browser. This module has zero Node dependencies.
 */

/** Prefer the English product name when set; fall back to the canonical (anchor-country) name. */
export function displayName(p: {
  product_name_en?: string | null;
  product_name?: string;
  name_en?: string | null;
  name?: string;
}): string {
  return (
    (p.product_name_en && p.product_name_en.trim()) ||
    (p.name_en && p.name_en.trim()) ||
    p.product_name ||
    p.name ||
    ""
  );
}
