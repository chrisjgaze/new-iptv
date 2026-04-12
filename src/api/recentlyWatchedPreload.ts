import * as s from "solid-js";
import recentlyWatchedProvider from "./providers/recentlyWatched";

export function recentlyWatchedPreload() {
  let seeded = false;
  return s.createMemo((p) => {
    if (p && seeded) {
      return p;
    }
    const provider = recentlyWatchedProvider();
    provider(1);
    seeded = true;
    return provider;
  });
}
