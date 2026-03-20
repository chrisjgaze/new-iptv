import * as s from "solid-js";
import seriesCategoriesProvider from "./providers/seriesCategories";

export function seriesCategoriesPreload() {
  let seeded = false;
  return s.createMemo((p) => {
    if (p && seeded) {
      return p;
    }
    const provider = seriesCategoriesProvider();
    provider(1);
    seeded = true;
    return provider;
  });
}
