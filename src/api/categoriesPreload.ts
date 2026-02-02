import * as s from "solid-js";
import categoriesProvider from "./providers/categories";

export function categoriesPreload(props) {
  let seeded = false;
  return s.createMemo((p) => {
    if (p && seeded) {
      return p;
    }
    const provider = categoriesProvider();
    provider(1);
    seeded = true;
    return provider;
  });
}
