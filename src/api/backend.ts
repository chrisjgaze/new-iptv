const DEFAULT_BACKEND_BASE = "http://192.168.1.242:5000";

export const backendBase =
  import.meta.env.VITE_API_BASE_URL ||
  import.meta.env.VITE_WATCH_PROGRESS_BASE_URL ||
  DEFAULT_BACKEND_BASE;

let providerUrlPromise: Promise<string> | null = null;

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

export function getProviderUrl(): Promise<string> {
  if (providerUrlPromise) return providerUrlPromise;

  providerUrlPromise = fetch(`${backendBase}/api/provider-url`)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load provider URL (${response.status})`);
      }
      const payload = await response.json();
      const url = typeof payload?.url === "string" ? payload.url.trim() : "";
      if (!url) throw new Error("Provider URL response missing url");
      return trimTrailingSlash(url);
    })
    .catch((error) => {
      providerUrlPromise = null;
      const fallback = import.meta.env.VITE_STREAM_BASE_URL;
      if (fallback) {
        console.warn("Using fallback provider URL", error);
        return trimTrailingSlash(fallback);
      }
      throw error;
    });

  return providerUrlPromise;
}
