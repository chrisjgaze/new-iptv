/**
 * Link to a movie's page. The page fills in details from TMDB when it can, but it must
 * also work without TMDB (no TMDB id from the provider, wrong id, or TMDB unreachable),
 * so the provider's own title and poster travel with the link.
 */
export function movieHref(opts: {
  tmdbId?: string | number | null;
  streamId: string | number;
  ext?: string;
  title?: string;
  poster?: string;
}) {
  const tmdb = opts.tmdbId && String(opts.tmdbId) !== "0" ? String(opts.tmdbId) : "0";
  const q = new URLSearchParams({
    stream_id: String(opts.streamId),
    ext: opts.ext || "mp4",
    title: opts.title || "",
    poster: opts.poster || ""
  });
  return `/entity/movie/${tmdb}?${q.toString()}`;
}
