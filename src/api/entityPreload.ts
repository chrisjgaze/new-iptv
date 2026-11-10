import { createResource } from "solid-js";
import * as provider from "./providers/entity";
import type { Tile } from "./formatters/ItemFormatter";

export function entityPreload({ params, location, intent }) {
  const query = new URLSearchParams((location && location.search) || "");
  const source = () => ({ ...params, title: query.get("title") || "", poster: query.get("poster") || "" });
  const [entity] = createResource(source, provider.getInfo);

  if (intent === "preload") {
    return;
  }

  const [credits] = createResource<any, Tile[]>(
    () => ({ ...params }),
    provider.getCredits
  );
  const [recommendations] = createResource<any, Tile[]>(
    () => ({ ...params }),
    provider.getRecommendations
  );

  return { entity, credits, recommendations };
}
