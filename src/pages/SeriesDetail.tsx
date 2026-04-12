import { Text, View, hexColor } from "@lightningtv/solid";
import { Row, VirtualGrid } from "@lightningtv/solid/primitives";
import { createEffect, createMemo, createResource, createSignal, For, onMount, Show } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import { setGlobalBackground } from "../state";
import { getWatchedProgress, type WatchedMap } from "../api/providers/watchProgress";
import { setPendingPlayerMetadata } from "../utils/playerMetadata";

const seasonButtonStyles = {
  width: 220,
  height: 72,
  color: hexColor("1b1f28"),
  borderRadius: 12,
  alpha: 0.88,
  border: {
    color: hexColor("243040"),
    width: 2
  },
  $focus: {
    color: hexColor("f0cb00"),
    alpha: 1,
    border: {
      color: hexColor("ffffff"),
      width: 4
    }
  }
} as const;

const episodeCardStyles = {
  width: 360,
  height: 220,
  color: hexColor("141922"),
  borderRadius: 12,
  alpha: 0.92,
  $focus: {
    color: hexColor("1f2a3a"),
    border: {
      color: hexColor("f0cb00"),
      width: 4
    }
  }
} as const;

const progressTrackStyles = {
  width: 320,
  height: 8,
  color: hexColor("263341"),
  borderRadius: 999
} as const;

const SeriesDetail = () => {
  const params = useParams();
  const navigate = useNavigate();
  const [series] = createResource(
    () => params.id || "",
    (seriesId) =>
      import("../api/providers/seriesInfo").then((m) =>
        seriesId ? m.getSeriesInfo(seriesId) : null
      )
  );
  const [watched] = createResource<WatchedMap>(getWatchedProgress);
  const [selectedSeason, setSelectedSeason] = createSignal("");
  let seasonsRef;
  let episodesRef;

  const currentEpisodes = createMemo(() => {
    const data = series();
    const season = selectedSeason();
    if (!data || !season) return [];
    return data.episodes?.[season] || [];
  });

  function playEpisode(item: any) {
    const episodeId = item?.id;
    const ext = item?.container_extension || "mp4";
    const resumeMs = watched()?.[String(episodeId)]?.elapsed_time || 0;
    const data = series();
    if (!episodeId) return true;
    console.log("SeriesDetail playEpisode", {
      seriesId: params.id,
      episodeId,
      ext,
      resumeMs
    });
    setPendingPlayerMetadata(String(episodeId), {
      mediaType: "series",
      mediaId: params.id || "",
      title: data?.title || "",
      subtitle: item?.title || item?.info?.name || "",
      overview: data?.description || "",
      posterUrl: data?.coverImage || "",
      backdropUrl: data?.backgroundImage || "",
      containerExtension: ext
    });
    navigate(`/player/${episodeId}?ext=${ext}&type=series&seek_time=${resumeMs}`);
    return true;
  }

  function watchedLabel(item: any) {
    const watchedPct = watchedPercent(item);
    if (watchedPct >= 100) return "Completed";
    if (watchedPct > 0) return `Watched ${watchedPct}%`;
    const watched = series()?.watched_info?.[String(item?.id)]?.watched_pct;
    return watched ? `Watched ${watched}%` : "Ready";
  }

  function watchedPercent(item: any) {
    const entry = watched()?.[String(item?.id)];
    const pct = entry?.watched_pct ?? series()?.watched_info?.[String(item?.id)]?.watched_pct ?? 0;
    return Math.max(0, Math.min(100, Number(pct) || 0));
  }

  createEffect(() => {
    const season = selectedSeason();
    const episodes = currentEpisodes();
    const watchedMap = watched();
    if (!season || !episodes?.length) return;

    console.log("SeriesDetail watched check", {
      seriesId: params.id,
      season,
      episodeCount: episodes.length,
      watchedKeys: Object.keys(watchedMap || {}).slice(0, 20),
      episodes: episodes.map((episode: any) => {
        const episodeId = String(episode?.id || "");
        const watchedEntry =
          watchedMap?.[episodeId] ||
          series()?.watched_info?.[episodeId] ||
          null;

        return {
          episodeId,
          title: episode?.title || episode?.info?.name || null,
          watchedEntry
        };
      })
    });
  });

  function selectSeason(season: string) {
    setSelectedSeason(String(season));
    return true;
  }

  createEffect(() => {
    const data = series();
    if (!data) return;
    if (!selectedSeason() && data.seasonKeys?.length) {
      setSelectedSeason(data.seasonKeys[0]);
    }
    setGlobalBackground(data.backgroundImage || 0x0b0b0fff);
  });

  onMount(() => {
    setGlobalBackground(0x0b0b0fff);
  });

  return (
    <>
      <Show when={series.loading && !series()}>
        <Text x={160} y={120} fontSize={36}>Loading series...</Text>
      </Show>
      <Show when={series.error}>
        <Text x={160} y={120} fontSize={30} color={hexColor("ff7a7a")}>{String(series.error)}</Text>
      </Show>
      <Show when={series()}>
        <View width={1920} height={1080}>
          <Text x={160} y={84} fontSize={54} fontWeight="bold">{series()?.title}</Text>
          <Text x={160} y={146} width={1500} contain="width" fontSize={24} color={hexColor("c8d0da")}>{series()?.description}</Text>
          <Text x={160} y={190} fontSize={24} color={hexColor("66ffcc")}>Season {selectedSeason() || "-"}</Text>

          <Row
            ref={seasonsRef}
            x={160}
            y={240}
            gap={18}
            scroll="none"
            autofocus
          >
            <For each={series()?.seasonKeys || []}>
              {(season) => (
                <View
                  style={seasonButtonStyles}
                  forwardStates
                  onFocus={() => selectSeason(season)}
                  onDown={() => {
                    selectSeason(season);
                    episodesRef?.setFocus();
                    return true;
                  }}
                  onEnter={() => {
                    selectSeason(season);
                    episodesRef?.setFocus();
                    return true;
                  }}
                >
                  <Text x={24} y={20} fontSize={30} color={hexColor("f4f7fb")}>Season {season}</Text>
                </View>
              )}
            </For>
          </Row>

          <Show
            when={currentEpisodes().length}
            fallback={
              <Text x={520} y={360} fontSize={30} color={hexColor("d4d8df")}>
                No episodes found for season {selectedSeason() || "-"}
              </Text>
            }
          >
            <View x={160} y={340} width={1580} height={620} clipping>
            <VirtualGrid
              ref={episodesRef}
              width={1240}
              height={740}
              columns={3}
              rows={3}
              gap={28}
              each={currentEpisodes()}
              onUp={() => seasonsRef?.setFocus()}
              onLeft={() => seasonsRef?.setFocus()}
            >
              {(item) => (
                <View style={episodeCardStyles} item={item()} onEnter={() => playEpisode(item())}>
                  <Text x={20} y={18} width={320} contain="width" maxLines={2} fontSize={26} fontWeight="bold">
                    {item()?.title || `Episode ${item()?.episode_num || ""}`}
                  </Text>
                  <Text x={20} y={90} width={320} contain="width" maxLines={4} fontSize={20} color={hexColor("d4d8df")}>
                    {item()?.plot || item()?.overview || item()?.description || item()?.info?.plot || item()?.info?.overview || item()?.info?.description || "Episode ready to play"}
                  </Text>
                  <Text x={20} y={190} fontSize={18} color={hexColor("66ffcc")}>
                    {watchedLabel(item())}
                  </Text>
                  <Show when={watchedPercent(item()) > 0}>
                    <View x={20} y={170} style={progressTrackStyles}>
                      <View
                        width={Math.max(10, Math.round((watchedPercent(item()) / 100) * progressTrackStyles.width))}
                        height={progressTrackStyles.height}
                        borderRadius={999}
                        color={watchedPercent(item()) >= 100 ? hexColor("7fe8a6") : hexColor("f0cb00")}
                      />
                    </View>
                  </Show>
                </View>
              )}
            </VirtualGrid>
          </View>
          </Show>
        </View>
      </Show>
    </>
  );
};

export default SeriesDetail;
