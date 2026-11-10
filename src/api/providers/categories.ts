import type { Tile } from "../formatters/ItemFormatter";
import { backendBase } from "../backend";

// .env's VITE_CATEGORIES_URL first, then the main backend (the Pi), which serves the same
// /get_categories route. Previously only the .env address was tried, and it pointed at a
// different machine (192.168.1.46) from every other request (192.168.1.242).
const CATEGORY_URLS = [import.meta.env.VITE_CATEGORIES_URL, `${backendBase}/get_categories`]
  .filter((u, i, all) => Boolean(u) && all.indexOf(u) === i) as string[];
const CATEGORIES_TIMEOUT_MS = 10000;

function fetchJson(url: string) {
  const request = fetch(url).then((response) => {
    if (!response.ok) throw new Error(`Failed to load categories (${response.status}) from ${url}`);
    return response.json();
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Categories timed out: ${url}`)), CATEGORIES_TIMEOUT_MS)
  );
  return Promise.race([request, timeout]);
}

async function loadFirstWorking(): Promise<unknown> {
  let lastError: unknown = null;
  for (const url of CATEGORY_URLS) {
    try {
      const payload = await fetchJson(url);
      if (normalizeCategories(payload).length) return payload;
      lastError = new Error(`No categories from ${url}`);
    } catch (e) {
      lastError = e;
      console.warn("Categories source failed", url, e);
    }
  }
  throw lastError || new Error("No categories source configured");
}

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

    pending = loadFirstWorking()
      .then((payload) => {
        cachedTiles = toTiles(normalizeCategories(payload));
        return cachedTiles;
      })
      .catch((e) => {
        // Don't cache the failure: opening Movies again retries.
        console.warn("Could not load movie categories", e);
        return [] as Tile[];
      })
      .finally(() => {
        pending = null;
      });

    return pending;
  };
}
