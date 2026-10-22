import * as s from "solid-js";
import liveCategoriesProvider from "./providers/liveCategories";

export function liveCategoriesPreload() {
  let seeded = false;
  return s.createMemo((previous) => {
    if (previous && seeded) return previous;
    const provider = liveCategoriesProvider();
    provider(1);
    seeded = true;
    return provider;
  });
}
