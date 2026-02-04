import type { Tile } from "../formatters/ItemFormatter";

const CATEGORIES_URL = import.meta.env.VITE_CATEGORIES_URL;

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
  return items
    .map((item, index) => {
      const title =
        item.category_name ||
        item.name ||
        item.title ||
        `Category ${index + 1}`;
      const id = item.category_id ?? index + 1;
      return {
        src: "./assets/fallback.png",
        tileSrc: "./assets/fallback.png",
        backdrop: 0x0b0b0fff,
        href: `/categories/${id}`,
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
