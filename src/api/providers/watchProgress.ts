const WATCH_PROGRESS_BASE =
  import.meta.env.VITE_WATCH_PROGRESS_BASE_URL || "http://192.168.1.46:5000";

export type WatchedEntry = {
  watched_pct?: number;
  elapsed_time?: number;
};

export type WatchedMap = Record<string, WatchedEntry>;

export type RecentEntry = {
  recent_key: string;
  media_type: "movie" | "series";
  media_id: string;
  episode_id?: string;
  tmdb_id?: string;
  title?: string;
  subtitle?: string;
  overview?: string;
  poster_url?: string;
  backdrop_url?: string;
  container_extension?: string;
  elapsed_time?: number;
  watched_pct?: number;
  updated_at?: string;
};

export type LiveHlsPayload = {
  status?: string;
  stream_url?: string;
  playlist_url?: string;
  error?: string;
};

function normalizeWatchedMap(payload: unknown): WatchedMap {
  if (!payload || typeof payload !== "object") return {};
  return payload as WatchedMap;
}

export async function getWatchedProgress(): Promise<WatchedMap> {
  const response = await fetch(`${WATCH_PROGRESS_BASE}/watched-episodes`);
  if (!response.ok) {
    throw new Error(`Failed to load watched progress (${response.status})`);
  }
  return normalizeWatchedMap(await response.json());
}

export async function updateWatchProgress(params: {
  episodeId: string;
  elapsedTimeSec: number;
  totalDurationSec: number;
  mediaType?: "movie" | "series";
  mediaId?: string;
  tmdbId?: string;
  title?: string;
  subtitle?: string;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  containerExtension?: string;
}) {
  const {
    episodeId,
    elapsedTimeSec,
    totalDurationSec,
    mediaType,
    mediaId,
    tmdbId,
    title,
    subtitle,
    overview,
    posterUrl,
    backdropUrl,
    containerExtension
  } = params;
  if (!episodeId || elapsedTimeSec < 0 || totalDurationSec <= 0) return;

  await fetch(`${WATCH_PROGRESS_BASE}/update_watch_progress`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      episode_id: episodeId,
      elapsed_time: Math.floor(elapsedTimeSec),
      total_duration: Math.floor(totalDurationSec),
      media_type: mediaType,
      media_id: mediaId,
      tmdb_id: tmdbId,
      title,
      subtitle,
      overview,
      poster_url: posterUrl,
      backdrop_url: backdropUrl,
      container_extension: containerExtension
    })
  });
}

export async function startLiveHlsStream(params: {
  streamId: string;
  containerExtension?: string;
}): Promise<LiveHlsPayload> {
  const { streamId, containerExtension } = params;
  if (!streamId) {
    throw new Error("Missing live stream id");
  }

  const response = await fetch(`${WATCH_PROGRESS_BASE}/api/live/hls`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      stream_id: streamId,
      container_extension: containerExtension || "ts"
    })
  });

  const payload = (await response.json()) as LiveHlsPayload;
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to start live HLS (${response.status})`);
  }
  if (!payload?.playlist_url) {
    throw new Error("Live HLS response missing playlist_url");
  }
  return payload;
}

export async function getRecentlyWatched(): Promise<RecentEntry[]> {
  const response = await fetch(`${WATCH_PROGRESS_BASE}/api/recently-watched`);
  if (!response.ok) {
    throw new Error(`Failed to load recently watched (${response.status})`);
  }
  const payload = await response.json();
  return Array.isArray(payload?.results) ? payload.results : [];
}

export async function deleteRecentEntry(recentKey: string) {
  if (!recentKey) return false;
  const response = await fetch(`${WATCH_PROGRESS_BASE}/api/recently-watched/delete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      recent_key: recentKey
    })
  });
  if (!response.ok) {
    throw new Error(`Failed to delete recent entry (${response.status})`);
  }
  const payload = await response.json();
  return Boolean(payload?.deleted);
}
