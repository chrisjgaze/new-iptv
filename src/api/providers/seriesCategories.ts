import type { Tile } from "../formatters/ItemFormatter";

const SERIES_CATEGORIES_URL = import.meta.env.VITE_SERIES_CATEGORIES_URL || "http://192.168.1.46:5000/get_series_categories";

type RawSeriesCategory = {
  category_id?: string | number;
  category_name?: string;
  name?: string;
  title?: string;
};

function normalizeCategories(payload: unknown): RawSeriesCategory[] {
  if (Array.isArray(payload)) return payload as RawSeriesCategory[];
  if (Array.isArray((payload as any)?.categories)) return (payload as any).categories;
  if (Array.isArray((payload as any)?.data)) return (payload as any).data;
  return [];
}

export default function seriesCategoriesProvider() {
  return async (_pageIndex: number): Promise<Tile[]> => {
    const response = await fetch(SERIES_CATEGORIES_URL);
    if (!response.ok) {
      throw new Error(`Failed to load series categories (${response.status})`);
    }
    const payload = await response.json();
    return normalizeCategories(payload)
      .map((item, index) => {
        const id = item.category_id ?? index + 1;
        const title = item.category_name || item.name || item.title || `Series Category ${index + 1}`;
        return {
          src: "./assets/fallback.png",
          tileSrc: "./assets/fallback.png",
          backdrop: 0x0b0b0fff,
          href: `/series/${id}`,
          shortTitle: title,
          title,
          overview: "",
          item,
          entityInfo: {
            type: "series-category",
            id: String(id)
          },
          heroContent: {
            title,
            description: "Series category"
          }
        } as Tile;
      })
      .filter((item) => item.title && item.title.trim().length);
  };
}
