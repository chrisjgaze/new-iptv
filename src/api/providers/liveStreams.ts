import type { Tile } from "../formatters/ItemFormatter";
import { backendBase } from "../backend";
import { proxyRemoteImage } from "../index";

type RawLiveStream = {
  stream_id?: string | number;
  name?: string;
  stream_icon?: string;
  epg_channel_id?: string;
};

function normalizeStreams(payload: unknown): RawLiveStream[] {
  if (Array.isArray(payload)) return payload as RawLiveStream[];
  if (Array.isArray((payload as any)?.streams)) return (payload as any).streams;
  if (Array.isArray((payload as any)?.data)) return (payload as any).data;
  return [];
}

export default function liveStreamsProvider(categoryId: string) {
  return async (pageIndex: number): Promise<Tile[]> => {
    if (!categoryId || pageIndex > 1) return [];

    const response = await fetch(
      `${backendBase}/live-category/${encodeURIComponent(categoryId)}/streams`
    );
    if (!response.ok) {
      throw new Error(`Failed to load live streams (${response.status})`);
    }

    return normalizeStreams(await response.json())
      .map((item, index) => {
        const id = item.stream_id ?? index + 1;
        const title = item.name || `Channel ${index + 1}`;
        const icon =
          proxyRemoteImage(item.stream_icon) || "./assets/fallback.png";
        return {
          src: icon,
          tileSrc: icon,
          backdrop: "",
          href: `/player/${id}?type=live&ext=ts`,
          shortTitle: title,
          title,
          overview: "",
          item,
          entityInfo: { type: "live", id: String(id) },
          heroContent: { title, description: item.epg_channel_id || "Live TV" }
        } as Tile;
      })
      .filter((item) => item.title && item.title.trim().length);
  };
}
