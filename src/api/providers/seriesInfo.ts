import { proxyRemoteImage } from "../index";

type Episode = {
  id?: string | number;
  title?: string;
  container_extension?: string;
  overview?: string;
  plot?: string;
  description?: string;
  episode_num?: string | number;
  movie_image?: string;
  info?: {
    movie_image?: string;
    plot?: string;
    overview?: string;
    description?: string;
    name?: string;
    duration_secs?: string | number;
  };
};

type SeriesInfoPayload = {
  info?: {
    name?: string;
    cover?: string;
    plot?: string;
    overview?: string;
    genre?: string;
  };
  episodes?: Record<string, Episode[]>;
  watched_info?: Record<string, { watched_pct?: number; elapsed_time?: number }>;
  backdrop_path?: string[] | string;
};

const SERIES_INFO_BASE = import.meta.env.VITE_SERIES_INFO_URL || "http://192.168.1.46:5000/api/series";

function backdropFor(payload: SeriesInfoPayload) {
  if (Array.isArray(payload.backdrop_path)) {
    return proxyRemoteImage(payload.backdrop_path[0] || payload.info?.cover || "");
  }
  return proxyRemoteImage(payload.backdrop_path || payload.info?.cover || "");
}

function normalizeEpisode(episode: Episode) {
  const info = episode.info || {};
  return {
    ...episode,
    title: episode.title || info.name || `Episode ${episode.episode_num || ""}`.trim(),
    plot:
      episode.plot ||
      episode.overview ||
      episode.description ||
      info.plot ||
      info.overview ||
      info.description ||
      "",
    movie_image: proxyRemoteImage(episode.movie_image || info.movie_image || "")
  };
}

export async function getSeriesInfo(seriesId: string) {
  const response = await fetch(`${SERIES_INFO_BASE}/${seriesId}`);
  if (!response.ok) {
    throw new Error(`Failed to load series info (${response.status})`);
  }

  const payload = (await response.json()) as SeriesInfoPayload;
  const normalizedEpisodes = Object.fromEntries(
    Object.entries(payload.episodes || {}).map(([season, episodeList]) => [
      season,
      (episodeList || []).map(normalizeEpisode)
    ])
  );
  const seasonKeys = Object.keys(normalizedEpisodes).sort((a, b) => Number(a) - Number(b));
  return {
    ...payload,
    episodes: normalizedEpisodes,
    title: payload.info?.name || `Series ${seriesId}`,
    description: payload.info?.plot || payload.info?.overview || payload.info?.genre || "",
    coverImage: proxyRemoteImage(payload.info?.cover || ""),
    backgroundImage: backdropFor(payload),
    seasonKeys
  };
}
