import type { Tile } from "../formatters/ItemFormatter";

const SEARCH_BASE = import.meta.env.VITE_SEARCH_URL || "http://192.168.1.46:5000/api/search";

type RawSearchItem = {
  media_type?: string;
  stream_id?: string | number;
  series_id?: string | number;
  tmdb?: string | number;
  tmdb_id?: string | number;
  name?: string;
  title?: string;
  plot?: string;
  overview?: string;
  description?: string;
  stream_icon?: string;
  cover?: string;
  cover_big?: string;
  backdrop?: string;
  backdrop_path?: string;
  backdrop_path_tmdb?: string;
  category_id?: string | number;
  container_extension?: string;
};

type SearchPayload = {
  results?: RawSearchItem[];
  movies?: RawSearchItem[];
  series?: RawSearchItem[];
  data?: RawSearchItem[];
};

function getSearchUrl(query: string) {
  const separator = SEARCH_BASE.includes("?") ? "&" : "?";
  return `${SEARCH_BASE}${separator}query=${encodeURIComponent(query)}&type=all`;
}

function normalizeResults(payload: SearchPayload): RawSearchItem[] {
  if (Array.isArray(payload?.results)) return payload.results;
  if (Array.isArray(payload?.data)) return payload.data;

  const movies = Array.isArray(payload?.movies)
    ? payload.movies.map((item) => ({ ...item, media_type: item.media_type || "movie" }))
    : [];
  const series = Array.isArray(payload?.series)
    ? payload.series.map((item) => ({ ...item, media_type: item.media_type || "series" }))
    : [];
  return [...movies, ...series];
}

function imageFor(item: RawSearchItem) {
  return item.stream_icon || item.cover_big || item.cover || "./assets/fallback.png";
}

function backdropFor(item: RawSearchItem, poster: string) {
  return item.backdrop_path_tmdb || item.backdrop_path || item.backdrop || item.cover_big || poster || "";
}

function hrefFor(item: RawSearchItem, tmdbId: string, fallbackId: string, ext: string) {
  if (item.media_type === "series") {
    return `/series/show/${fallbackId}`;
  }
  if (!tmdbId) return "";
  return `/entity/movie/${tmdbId}?stream_id=${fallbackId}&ext=${ext}`;
}

function entityTypeFor(item: RawSearchItem) {
  return item.media_type === "series" ? "tv" : "movie";
}

function toTile(item: RawSearchItem, index: number): Tile | null {
  const title = item.name || item.title || `Result ${index + 1}`;
  if (!title.trim()) return null;

  const poster = imageFor(item);
  const backdrop = backdropFor(item, poster);
  const tmdbId = String(item.tmdb_id || item.tmdb || "");
  const fallbackId = String(item.stream_id || item.series_id || index + 1);
  const ext = item.container_extension || "mp4";

  return {
    src: poster,
    tileSrc: poster,
    backdrop,
    href: hrefFor(item, tmdbId, fallbackId, ext),
    shortTitle: title,
    title,
    overview: item.plot || item.overview || item.description || "",
    item,
    entityInfo: {
      type: entityTypeFor(item),
      id: tmdbId || fallbackId
    },
    heroContent: {
      title,
      description: item.plot || item.overview || item.description || ""
    }
  } as Tile;
}

export default async function searchProvider(query: string): Promise<Tile[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const response = await fetch(getSearchUrl(trimmed));
  if (!response.ok) {
    throw new Error(`Failed to search (${response.status})`);
  }

  const payload = (await response.json()) as SearchPayload;
  return normalizeResults(payload)
    .map(toTile)
    .filter((item): item is Tile => Boolean(item?.title));
}
