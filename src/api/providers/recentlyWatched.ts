import type { Tile } from "../formatters/ItemFormatter";
import { getRecentlyWatched, type RecentEntry } from "./watchProgress";
import { proxyRemoteImage } from "../index";

function hrefFor(item: RecentEntry) {
  const ext = item.container_extension || "mp4";
  const mediaId = item.media_id || "";
  const elapsed = Number(item.elapsed_time || 0);

  if (item.media_type === "series") {
    return mediaId ? `/series/show/${mediaId}` : "";
  }

  if (item.tmdb_id) {
    return `/entity/movie/${item.tmdb_id}?stream_id=${mediaId}&ext=${ext}`;
  }

  const query = new URLSearchParams({
    ext,
    type: "movie",
    media_type: "movie",
    media_id: mediaId,
    title: item.title || "",
    overview: item.overview || "",
    poster_url: item.poster_url || "",
    backdrop_url: item.backdrop_url || "",
    container_extension: ext,
    seek_time: String(elapsed)
  });
  return `/player/${mediaId}?${query.toString()}`;
}

function toTile(item: RecentEntry, index: number): Tile | null {
  const title = item.title || item.subtitle || `Recent ${index + 1}`;
  if (!title.trim()) return null;

  const poster = proxyRemoteImage(item.poster_url || "") || "./assets/fallback.png";
  const backdrop = proxyRemoteImage(item.backdrop_url || "") || poster;
  const watchedPct = Math.max(0, Math.min(100, Number(item.watched_pct || 0)));
  const subtitle = item.media_type === "series"
    ? item.subtitle
      ? `Last episode: ${item.subtitle}`
      : "Series"
    : watchedPct > 0
      ? `Resume ${watchedPct}%`
      : "Movie";

  return {
    src: poster,
    tileSrc: poster,
    backdrop,
    href: hrefFor(item),
    shortTitle: title,
    title,
    overview: item.overview || subtitle || "",
    item,
    entityInfo: {
      type: item.media_type,
      id: item.tmdb_id || item.media_id
    },
    heroContent: {
      title,
      description: subtitle || item.overview || ""
    }
  } as Tile;
}

export default function recentlyWatchedProvider() {
  return async (_pageIndex: number): Promise<Tile[]> => {
    const results = await getRecentlyWatched();
    return results
      .map(toTile)
      .filter((item): item is Tile => Boolean(item?.title));
  };
}
