import type { Tile } from "../formatters/ItemFormatter";
import { getImageUrl } from "../index";

const CATEGORY_MOVIES_BASE =
  import.meta.env.VITE_CATEGORY_MOVIES_BASE ||
  "http://192.168.1.46:5000";

type RawMovie = {
  stream_id?: string | number;
  name?: string;
  stream_icon?: string;
  rating?: string | number;
  tmdb?: string | number;
  category_id?: string | number;
  container_extension?: string;
  backdrop_path?: string;
  backdrop?: string;
  background?: string;
  cover_big?: string;
  cover?: string;
  movie_image?: string;
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

function pickBackdrop(item: RawMovie, posterUrl: string) {
  const candidate =
    item.backdrop_path ||
    item.backdrop ||
    item.background ||
    item.movie_image ||
    item.cover_big ||
    item.cover;

  if (!candidate || candidate === item.stream_icon) return "";

  if (candidate.startsWith("http")) {
    return proxyImage(candidate);
  }

  if (candidate.startsWith("/")) {
    return getImageUrl(candidate, "w1280");
  }

  if (candidate === posterUrl) return "";

  return "";
}

const STREAM_BASE_URL =
  import.meta.env.VITE_STREAM_BASE_URL || "http://YOUR_BASE_URL";
const STREAM_USERNAME =
  import.meta.env.VITE_STREAM_USERNAME || "YOUR_USERNAME";
const STREAM_PASSWORD =
  import.meta.env.VITE_STREAM_PASSWORD || "YOUR_PASSWORD";

function buildStreamUrl(streamId: string | number, ext?: string) {
  if (!streamId || !ext) return "";
  return `${STREAM_BASE_URL}/movie/${STREAM_USERNAME}/${STREAM_PASSWORD}/${streamId}.${ext}`;
}

function toTiles(items: RawMovie[]): Tile[] {
  return items
    .map((item, index) => {
      const title = item.name || `Movie ${index + 1}`;
      const id = item.stream_id ?? index + 1;
      const tmdbId = item.tmdb ? String(item.tmdb) : "";
      const img = proxyImage(item.stream_icon);
      const backdrop = pickBackdrop(item, img);
      const rating = item.rating ? `Rating ${item.rating}` : "";
      const streamUrl = buildStreamUrl(id, item.container_extension);
      const ext = item.container_extension || "mkv";
      return {
        src: img,
        tileSrc: img,
        backdrop: backdrop || "",
        href: tmdbId
          ? `/entity/movie/${tmdbId}?stream_id=${id}&ext=${ext}`
          : "",
        shortTitle: title,
        title,
        overview: "",
        item: { ...item, streamUrl },
        entityInfo: {
          type: "movie",
          id: tmdbId || String(id)
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
    if (!categoryId) return [];
    if (pageIndex > 1) return [];
    console.log("Get category " +categoryId);
    //const response = await fetch(`${CATEGORY_MOVIES_BASE}/${categoryId}/movies`);
    const response = await fetch(`${CATEGORY_MOVIES_BASE}/category/${categoryId}/movies`);
    if (!response.ok) {
      throw new Error(`Failed to load category movies (${response.status})`);
    }
    const payload = await response.json();
    return toTiles(normalizeMovies(payload));
  };
}
