import API_KEY_V4 from "./key";
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

export function proxyRemoteImage(url?: string) {
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) return url;
  if (!remoteImageProxyBase) return url;

  const proxyBase = remoteImageProxyBase.endsWith("/")
    ? remoteImageProxyBase.slice(0, -1)
    : remoteImageProxyBase;

  return `${proxyBase}/p/?u=${encodeURIComponent(url)}`;
}

export function getImageUrl(path: string, posterSize: string = basePosterSize) {
  if (!path) return "";
  const base = imageProxyBase ? normalizeBase(imageProxyBase) : baseImageUrl;
  return base + posterSize + path;
}

function get(path: string, params: RequestInit = {}) {
  if (tmdbConfig) {
    return _get(path, params);
  } else {
    return loadConfig().then(() => _get(path, params));
  }
}

function _get(path: string, params: RequestInit = {}) {
  return fetch(API_BASE + path, {
    ...defaultFetchParams,
    ...params
  }).then((r) => r.json());
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
