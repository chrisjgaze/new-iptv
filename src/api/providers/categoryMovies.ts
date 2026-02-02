import type { Tile } from "../formatters/ItemFormatter";

const CATEGORY_MOVIES_BASE =
  import.meta.env.VITE_CATEGORY_MOVIES_BASE || "/categories";

type RawMovie = {
  stream_id?: string | number;
  name?: string;
  stream_icon?: string;
  rating?: string | number;
  category_id?: string | number;
};

function normalizeMovies(payload: unknown): RawMovie[] {
  if (Array.isArray(payload)) return payload as RawMovie[];
  if (Array.isArray((payload as any)?.data)) return (payload as any).data;
  return [];
}

function proxyImage(src?: string) {
  if (!src) return "";
  const proxyBase = import.meta.env.VITE_TMDB_IMAGE_PROXY;
  if (!proxyBase) return src;
  if (!src.includes("image.tmdb.org/t/p/")) return src;
  const base = proxyBase.endsWith("/") ? proxyBase : `${proxyBase}/`;
  return src.replace("https://image.tmdb.org/t/p/", base);
}

function toTiles(items: RawMovie[]): Tile[] {
  return items
    .map((item, index) => {
      const title = item.name || `Movie ${index + 1}`;
      const id = item.stream_id ?? index + 1;
      const img = proxyImage(item.stream_icon);
      const rating = item.rating ? `Rating ${item.rating}` : "";
      return {
        src: img,
        tileSrc: img,
        backdrop: img || 0x0b0b0fff,
        href: "",
        shortTitle: title,
        title,
        overview: "",
        item,
        entityInfo: {
          type: "movie",
          id: String(id)
        },
        heroContent: {
          title,
          description: rating
        }
      } as Tile;
    })
    .filter((item) => item.title && item.title.trim().length);
}

export default function categoryMoviesProvider(categoryId: string) {
  return async (pageIndex: number): Promise<Tile[]> => {
    if (pageIndex > 1) return [];
    const response = await fetch(`${CATEGORY_MOVIES_BASE}/${categoryId}/movies`);
    if (!response.ok) {
      throw new Error(`Failed to load category movies (${response.status})`);
    }
    const payload = await response.json();
    return toTiles(normalizeMovies(payload));
  };
}
