import API_KEY_V4 from "./key";
import { backendBase } from "./backend";
const API_BASE = "https://api.themoviedb.org/3";
let tmdbConfig;
let baseImageUrl;
const urlParams = new URLSearchParams(window.location.search);
const basePosterSize = urlParams.get("posterSize") || "w185";
const imageProxyBase = import.meta.env.VITE_TMDB_IMAGE_PROXY;
const remoteImageProxyBase =
  import.meta.env.VITE_IMAGE_PROXY_BASE_URL ||
  import.meta.env.VITE_PROXY_BASE_URL ||
  "";

const defaultFetchParams = {
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer " + API_KEY_V4
  }
};



function normalizeBase(base?: string) {
  if (!base) return "";
  return base.endsWith("/") ? base : `${base}/`;
}

// Images go through the Pi's /img cache (image_cache.py), which shrinks each one to the
// width asked for and keeps it on disk. Posters ~342px, backdrops 1280px.
// Set VITE_IMAGE_CACHE_URL to point elsewhere, or "off" to load images directly.
const imageCacheBase = (import.meta.env.VITE_IMAGE_CACHE_URL || `${backendBase}/img`).replace(/\/+$/, "");

export function proxyRemoteImage(url?: string, width = 342) {
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) return url;
  if (imageCacheBase !== "off") {
    return `${imageCacheBase}?w=${width}&u=${encodeURIComponent(url)}`;
  }
  if (!remoteImageProxyBase) return url;

  const proxyBase = remoteImageProxyBase.endsWith("/")
    ? remoteImageProxyBase.slice(0, -1)
    : remoteImageProxyBase;

  return `${proxyBase}/p/?u=${encodeURIComponent(url)}`;
}

export function getImageUrl(path: string, posterSize: string = basePosterSize) {
  if (!path) return "";
  const base = imageProxyBase ? normalizeBase(imageProxyBase) : baseImageUrl;
  if (!base) return "";
  return base + posterSize + path;
}

function get(path: string, params: RequestInit = {}) {
  if (tmdbConfig) {
    return _get(path, params);
  } else {
    return loadConfig().then(() => _get(path, params));
  }
}

const TMDB_TIMEOUT_MS = 10000;

function _get(path: string, params: RequestInit = {}) {
  // No AbortController on 2019 TVs (Chromium 63), so race a timer instead.
  const request = fetch(API_BASE + path, {
    ...defaultFetchParams,
    ...params
  }).then((r) => {
    if (!r.ok) throw new Error(`TMDB ${r.status} for ${path}`);
    return r.json();
  });
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`TMDB timed out for ${path}`)), TMDB_TIMEOUT_MS)
  );
  return Promise.race([request, timeout]);
}

function loadConfig() {
  return _get("/configuration").then((data) => {
    tmdbConfig = data;
    baseImageUrl = data.images?.secure_base_url;
    return data;
  });
}

export default {
  get,
  loadConfig
};
