import type { Tile } from "../formatters/ItemFormatter";
import { backendBase } from "../backend";

type RawLiveCategory = {
  category_id?: string | number;
  category_name?: string;
  name?: string;
  title?: string;
};

function normalizeCategories(payload: unknown): RawLiveCategory[] {
  if (Array.isArray(payload)) return payload as RawLiveCategory[];
  if (Array.isArray((payload as any)?.categories))
    return (payload as any).categories;
  if (Array.isArray((payload as any)?.data)) return (payload as any).data;
  return [];
}

let cachedTiles: Tile[] | null = null;
let pending: Promise<Tile[]> | null = null;

export default function liveCategoriesProvider() {
  return async (pageIndex: number): Promise<Tile[]> => {
    if (pageIndex > 1) return [];
    if (cachedTiles) return cachedTiles;
    if (pending) return pending;

    pending = fetch(`${backendBase}/get_live_categories`)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load live categories (${response.status})`
          );
        }
        return response.json();
      })
      .then((payload) => {
        cachedTiles = normalizeCategories(payload)
          .map((item, index) => {
            const id = item.category_id ?? index + 1;
            const title =
              item.category_name ||
              item.name ||
              item.title ||
              `Live Category ${index + 1}`;
            return {
              src: "./assets/fallback.png",
              tileSrc: "./assets/fallback.png",
              backdrop: "",
              href: `/tv/${id}`,
              shortTitle: title,
              title,
              overview: "",
              item,
              entityInfo: { type: "live-category", id: String(id) },
              heroContent: { title, description: "Live TV category" }
            } as Tile;
          })
          .filter((item) => item.title && item.title.trim().length);
        return cachedTiles;
      })
      .finally(() => {
        pending = null;
      });

    return pending;
  };
}
