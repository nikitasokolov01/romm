import type { RomioGame } from "@/services/api/romio";

export function hasExplicitCatalogQuery(
  query: string,
  category: string,
): boolean {
  return Boolean(query.trim() || category);
}

export function hasAttributedRating(game: RomioGame): boolean {
  return (
    typeof game.rating === "number" &&
    Number.isFinite(game.rating) &&
    game.rating >= 0 &&
    game.rating <= 100 &&
    Boolean(game.ratingSource?.trim())
  );
}
