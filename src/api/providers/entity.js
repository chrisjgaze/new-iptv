import api, { getImageUrl } from "..";
import { convertItemsToTiles } from "../formatters/ItemFormatter";

export function minutesToHMM(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return (
    hours + "h " + (remainingMinutes < 10 ? "0" : "") + remainingMinutes + "min"
  );
}

function formatDate(dateString) {
  if (!dateString) return "";
  const parts = String(dateString).split("-");
  if (parts.length < 3) return String(dateString);
  return parts[1] + "/" + parts[2] + "/" + parts[0];
}

/** Movie page built from the provider's own data, used when TMDB has nothing or fails. */
function fallbackInfo({ title, poster }, reason) {
  if (reason) console.warn("Movie details unavailable, using provider data:", reason);
  return {
    backgroundImage: poster || "",
    poster_path: "",
    fallback: true,
    heroContent: {
      title: title || "Untitled",
      description: "No details available for this title.",
      badges: [],
      voteAverage: 0,
      voteCount: 0,
      metaText: "",
      reviews: {}
    }
  };
}

function justYear(dateString) {
  const parts = dateString?.split("-") || [];
  return parts[0] || "";
}

export function ensureItems(items, minCount) {
  const remainingCount = minCount - items.length;
  if (remainingCount > 0) {
    return items.concat(Array(remainingCount).fill({}));
  }
  return items;
}

// Rows below the Play button are extras: on any failure they are simply left out ([]).
export function getRecommendations({ type, id }) {
  if (!id || id === "0") return Promise.resolve([]);
  return api
    .get(`/${type}/${id}/recommendations`)
    .then(({ results } = {}) => {
      if (results && results.length) {
        return ensureItems(convertItemsToTiles(results.slice(0, 7)), 7);
      }
      return api
        .get(`/trending/${type}/week?page=1`)
        .then(({ results: trending } = {}) =>
          trending && trending.length ? ensureItems(convertItemsToTiles(trending.slice(0, 7)), 7) : []
        );
    })
    .catch((e) => {
      console.warn("Recommendations unavailable", e);
      return [];
    });
}

export function getCredits({ type, id }) {
  if (!id || id === "0") return Promise.resolve([]);
  return api
    .get(`/${type}/${id}/credits`)
    .then(({ cast } = {}) => (cast && cast.length ? ensureItems(convertItemsToTiles(cast.slice(0, 7)), 7) : []))
    .catch((e) => {
      console.warn("Credits unavailable", e);
      return [];
    });
}

export function getInfo({ type, id, title, poster }) {
  if (!id || id === "0") return Promise.resolve(fallbackInfo({ title, poster }, "no TMDB id"));
  let rt =
    type === "movie"
      ? {
          rtCrit: 86,
          rtFan: 92
        }
      : {};

  return api
    .get(`/${type}/${id}`)
    .then((data) => {
      if (!data || data.success === false || !(data.title || data.name)) {
        return fallbackInfo({ title, poster }, `TMDB has no ${type} ${id}`);
      }
      return buildInfo(type, data, rt, { title, poster });
    })
    .catch((e) => fallbackInfo({ title, poster }, e));
}

function buildInfo(type, data, rt, provided) {
  return {
    backgroundImage: getImageUrl(data.backdrop_path, "w1280") || provided.poster || "",
    heroContent: {
      title: data.title || data.name || provided.title,
      description: data.overview || "",
      badges: ["HD", "CC"],
      voteAverage: data.vote_average,
      voteCount: data.vote_count,
      metaText:
        type === "movie"
          ? (data.runtime ? minutesToHMM(data.runtime) + "   " : "") + formatDate(data.release_date)
          : `${justYear(data.first_air_date)} - ${justYear(data.last_air_date)}`,
      reviews: rt
    },
    ...data
  };
}
