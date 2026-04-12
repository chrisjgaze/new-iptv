export type PendingPlayerMetadata = {
  mediaType?: "movie" | "series";
  mediaId?: string;
  tmdbId?: string;
  title?: string;
  subtitle?: string;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  containerExtension?: string;
};

function storageKey(streamId: string) {
  return `player-metadata:${streamId}`;
}

export function setPendingPlayerMetadata(
  streamId: string,
  metadata: PendingPlayerMetadata
) {
  if (!streamId) return;
  try {
    window.sessionStorage.setItem(storageKey(streamId), JSON.stringify(metadata));
  } catch (error) {
    console.warn("Failed to store player metadata", error);
  }
}

export function getPendingPlayerMetadata(streamId: string): PendingPlayerMetadata {
  if (!streamId) return {};
  try {
    const raw = window.sessionStorage.getItem(storageKey(streamId));
    if (!raw) return {};
    return JSON.parse(raw) as PendingPlayerMetadata;
  } catch (error) {
    console.warn("Failed to read player metadata", error);
    return {};
  }
}
