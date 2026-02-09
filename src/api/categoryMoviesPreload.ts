import * as s from "solid-js";
import categoryMoviesProvider from "./providers/categoryMovies";

export function categoryMoviesPreload(props) {
  let lastId: string | null = null;
  return s.createMemo((p) => {
    const params = props.params;
    if (!params?.id) {
      return p || (() => Promise.resolve([]));
    }
    if (p && params?.id && lastId === params.id) {
      return p;
    }
    const provider = categoryMoviesProvider(params.id);
    provider(1);
    lastId = params.id;
    return provider;
  });
}
