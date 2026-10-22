import * as s from "solid-js";
import liveStreamsProvider from "./providers/liveStreams";

export function liveStreamsPreload(props) {
  let lastId: string | null = null;
  return s.createMemo((previous) => {
    const id = props.params?.id;
    if (!id) return previous || (() => Promise.resolve([]));
    if (previous && lastId === id) return previous;
    const provider = liveStreamsProvider(id);
    provider(1);
    lastId = id;
    return provider;
  });
}
