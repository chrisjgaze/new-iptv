import type { Tile } from "../formatters/ItemFormatter";

const CATEGORIES_URL =
  import.meta.env.VITE_CATEGORIES_URL || "/get_categories";

type RawCategory = {
  category_id?: string | number;
  category_name?: string;
  name?: string;
  title?: string;
};

function normalizeCategories(payload: unknown): RawCategory[] {
  if (Array.isArray(payload)) return payload as RawCategory[];
  if (Array.isArray((payload as any)?.categories)) return (payload as any).categories;
  if (Array.isArray((payload as any)?.data)) return (payload as any).data;
  return [];
}

function toTiles(items: RawCategory[]): Tile[] {
  const basePosterSize =
    new URLSearchParams(window.location.search).get("posterSize") || "w185";
  const fallbackSrc = `https://image.tmdb.org/t/p/${basePosterSize}/q2lTO2j4Nzn3zLab0xMHeBya5sw.jpg`;
  return items
    .map((item, index) => {
      const title =
        item.category_name ||
        item.name ||
        item.title ||
        `Category ${index + 1}`;
      const id = item.category_id ?? index + 1;
      return {
        src: fallbackSrc,
        tileSrc: fallbackSrc,
        backdrop: 0x0b0b0fff,
        href: "/categories",
        shortTitle: title,
        title,
        overview: "",
        item,
        entityInfo: {
          type: "category",
          id: String(id)
        },
        heroContent: {
          title,
          description: "Category"
        }
      } as Tile;
    })
    .filter((item) => item.title && item.title.trim().length);
}

let cachedTiles: Tile[] | null = null;
let pending: Promise<Tile[]> | null = null;

export default function categoriesProvider() {
  return async (pageIndex: number): Promise<Tile[]> => {
    if (pageIndex > 1 && cachedTiles) return [];
    if (cachedTiles) return cachedTiles;
    if (pending) return pending;

    pending = fetch(CATEGORIES_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(`Failed to load categories (${response.status})`);
        }
        return response.json();
      })
      .then((payload) => {
        cachedTiles = toTiles(normalizeCategories(payload));
        return cachedTiles;
      })
      .finally(() => {
        pending = null;
      });

    return pending;
  };
}
