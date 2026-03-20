import type { Tile } from "../formatters/ItemFormatter";

const SERIES_BASE = import.meta.env.VITE_SERIES_BASE_URL || "http://192.168.1.46:5000";

type RawSeries = {
  series_id?: string | number;
  name?: string;
  cover?: string;
  plot?: string;
  overview?: string;
  backdrop_path?: string | string[];
  youtube_trailer?: string;
  genre?: string;
  tmdb?: string | number;
};

function normalizeSeries(payload: unknown): RawSeries[] {
  if (Array.isArray(payload)) return payload as RawSeries[];
  if (Array.isArray((payload as any)?.data)) return (payload as any).data;
  if (Array.isArray((payload as any)?.results)) return (payload as any).results;
  return [];
}

function backdropFor(item: RawSeries) {
  if (Array.isArray(item.backdrop_path)) return item.backdrop_path[0] || item.cover || "";
  return item.backdrop_path || item.cover || "";
}

export default function seriesCategoryProvider(categoryId: string) {
  return async (_pageIndex: number): Promise<Tile[]> => {
    const response = await fetch(`${SERIES_BASE}/series-category/${categoryId}/series`);
    if (!response.ok) {
      throw new Error(`Failed to load series (${response.status})`);
    }
    const payload = await response.json();
    return normalizeSeries(payload)
      .map((item, index) => {
        const id = item.series_id ?? index + 1;
        const title = item.name || `Series ${index + 1}`;
        const overview = item.plot || item.overview || item.genre || "";
        return {
          src: item.cover || "./assets/fallback.png",
          tileSrc: item.cover || "./assets/fallback.png",
          backdrop: backdropFor(item),
          href: `/series/show/${id}`,
          shortTitle: title,
          title,
          overview,
          item,
          entityInfo: {
            type: "series",
            id: String(id)
          },
          heroContent: {
            title,
            description: overview
          }
        } as Tile;
      })
      .filter((item) => item.title && item.title.trim().length);
  };
}
