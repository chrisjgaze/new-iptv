import {
  createMemo,
  createSignal,
  Show,
  onCleanup
} from "solid-js";
import {
  ElementNode,
  View,
  activeElement,
  assertTruthy
} from "@lightningtv/solid";
import { Column, VirtualGrid, Image } from "@lightningtv/solid/primitives";
import { useNavigate, usePreloadRoute, useMatch, useLocation } from "@solidjs/router";
import { Thumbnail, TileRow } from "../components";
import { Text, hexColor } from "@lightningtv/solid";
import styles from "../styles";
import { setGlobalBackground } from "../state";
import { createInfiniteScroll } from "../components/pagination";
import ContentBlock from "../components/ContentBlock";
import { debounce } from "@solid-primitives/scheduled";

const Browse = (props) => {
  const preload = usePreloadRoute();
  const [heroContent, setHeroContent] = createSignal({});
  const navigate = useNavigate();
  let firstRun = true;
  let vgRef;
  const location = useLocation();
  const isCategoriesList = () => location.pathname === "/categories";
  const isCategoryMovies = useMatch(() => "/categories/:id");
  const isCategoryRoute = useMatch(() => "/categories/*all");
  const plotBase = import.meta.env.VITE_PLOT_URL || "/get_plot";
  const plotDebug = (() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get("plotDebug") === "true") return true;
    const hash = window.location.hash || "";
    return hash.includes("plotDebug=true");
  })();
  const [debugLine, setDebugLine] = createSignal("");
  const [debugPlotUrl, setDebugPlotUrl] = createSignal("");
  const [debugCount, setDebugCount] = createSignal(0);
  const plotCache = new Map<string, string>();
  const plotInFlight = new Map<string, Promise<string>>();
  let plotToken = 0;

  function fetchPlot(tmdbId: string): Promise<string> {
    if (plotCache.has(tmdbId)) {
      return Promise.resolve(plotCache.get(tmdbId) || "");
    }
    if (plotInFlight.has(tmdbId)) {
      return plotInFlight.get(tmdbId)!;
    }
    const request = fetch(`${plotBase}/${tmdbId}`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Failed to load plot (${response.status})`);
        }
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          return (
            data?.plot ||
            data?.overview ||
            data?.description ||
            data?.data?.plot ||
            ""
          );
        }
        return response.text();
      })
      .then((text) => {
        plotCache.set(tmdbId, text);
        plotInFlight.delete(tmdbId);
        return text;
      })
      .catch((err) => {
        if (plotDebug) {
          console.log("plot error", err);
        }
        plotInFlight.delete(tmdbId);
        return "";
      });
    plotInFlight.set(tmdbId, request);
    return request;
  }

  onCleanup(() => {
    console.log('cleanup');
  })

  const provider = createMemo(() => {
    return createInfiniteScroll(props.data());
  });

  const delayedBackgrounds = debounce(
    (img: string) => setGlobalBackground(img),
    800
  );
  const delayedHero = debounce(
    (content: {}) => setHeroContent(content || {}),
    600
  );

  function updateContentBlock(_index, _col, elm) {
    if (!elm) {
      if (plotDebug) setDebugLine("updateContentBlock: no element");
      return;
    }

    const item = elm.item || ({} as any);
    if (plotDebug) {
      setDebugCount((c) => c + 1);
      setDebugLine(
        `route=${window.location.hash} title=${item.title || ""} tmdb=${item.tmdb || item.item?.tmdb || ""}`
      );
      console.log("selection", { item, hasItem: !!elm.item });
    }

    if (firstRun) {
      // no content set yet, set right away
      if (item.backdrop) {
        setGlobalBackground(item.backdrop);
      }

      if (item.item?.stream_id && item.title && (item.tmdb || item.item?.tmdb)) {
        const tmdbId = item.tmdb || item.item?.tmdb;
        const ratingValue = Number(item.item?.rating ?? item.rating);
        const hasRating = Number.isFinite(ratingValue);
        const token = ++plotToken;
        const url = `${plotBase}/${tmdbId}`;
        if (plotDebug) {
          console.log("plot request", { tmdbId, title: item.title, url });
          setDebugLine(
            `plot=${url} title=${item.title || ""} tmdb=${tmdbId || ""}`
          );
          setDebugPlotUrl(url);
        }
        setHeroContent({
          title: item.title,
          description: "Plot placeholder...",
          metaText: hasRating ? `Rating ${ratingValue}` : "",
          voteAverage: hasRating ? ratingValue : undefined,
          voteCount: hasRating ? 1 : undefined
        });
        fetchPlot(String(tmdbId)).then((plot) => {
          if (token !== plotToken || !plot) return;
          if (plotDebug) {
            console.log("plot response", { tmdbId, length: plot.length });
          }
          setHeroContent({
            title: item.title,
            description: plot,
            metaText: hasRating ? `Rating ${ratingValue}` : "",
            voteAverage: hasRating ? ratingValue : undefined,
            voteCount: hasRating ? 1 : undefined
          });
        });
      } else if (item.heroContent) {
        setHeroContent(item.heroContent);
      } else if (isCategoriesList() && item.title) {
        setHeroContent({ title: item.title, description: "Category" });
      }

      // preload(`/browse/tv`, { preloadData: true });
      // preload(`/browse/movie`, { preloadData: true });

      firstRun = false;
      return;
    }

    if (item.href) {
      // preload(item.href, { preloadData: true });
    }

    if (item.backdrop) {
      delayedBackgrounds(item.backdrop);
    }

    if (item.item?.stream_id && item.title && (item.tmdb || item.item?.tmdb)) {
      const tmdbId = item.tmdb || item.item?.tmdb;
      const ratingValue = Number(item.item?.rating ?? item.rating);
      const hasRating = Number.isFinite(ratingValue);
      const token = ++plotToken;
      const url = `${plotBase}/${tmdbId}`;
      if (plotDebug) {
        console.log("plot request", { tmdbId, title: item.title, url });
        setDebugLine(
          `plot=${url} title=${item.title || ""} tmdb=${tmdbId || ""}`
        );
        setDebugPlotUrl(url);
      }
      setHeroContent({
        title: item.title,
        description: "Plot placeholder...",
        metaText: hasRating ? `Rating ${ratingValue}` : "",
        voteAverage: hasRating ? ratingValue : undefined,
        voteCount: hasRating ? 1 : undefined
      });
      fetchPlot(String(tmdbId)).then((plot) => {
        if (token !== plotToken || !plot) return;
        if (plotDebug) {
          console.log("plot response", { tmdbId, length: plot.length });
        }
        setHeroContent({
          title: item.title,
          description: plot,
          metaText: hasRating ? `Rating ${ratingValue}` : "",
          voteAverage: hasRating ? ratingValue : undefined,
          voteCount: hasRating ? 1 : undefined
        });
      });
      return;
    }
    if (item.heroContent) {
      delayedHero(item.heroContent);
      return;
    }
    if (isCategoriesList() && item.title) {
      delayedHero({ title: item.title, description: "Category" });
      return;
    }
  }

  function onEndReached(this: ElementNode) {
    provider().setPage((p) => p + 1);
  }

  function onEnter(this: ElementNode) {
    this.display = "flex";
    let entity = this.children.find((c) =>
      c.states!.has("focus")
    ) as ElementNode;
    if (!entity?.item?.href) {
      return true;
    }
    navigate(entity.item.href);
    return true;
  }

  return (
    <Show when={provider().pages().length}>
      <ContentBlock y={360} x={162} content={heroContent()} forwardFocus={() => vgRef.setFocus()} />
      {plotDebug && (
        <>
          <Text
            x={162}
            y={320}
            width={1400}
            contain="width"
            fontSize={18}
            color={hexColor("ffcc00")}
          >
            {`sel=${debugCount()} ${debugLine()}`}
          </Text>
          <Text
            x={162}
            y={340}
            width={1400}
            contain="width"
            fontSize={18}
            color={hexColor("ffcc00")}
          >
            {debugPlotUrl()}
          </Text>
        </>
      )}
      <View clipping style={styles.itemsContainer}>
        <VirtualGrid
          y={24}
          x={160}
          id="BrowseGrid"
          ref={vgRef}
          scroll="always"
          announce={
            props.params?.filter
              ? `All Trending ${props.params.filter}`
              : isCategoriesList()
                ? "Categories"
                : isCategoryMovies()
                  ? "Category Movies"
                  : "Browse"
          }
          onEnter={onEnter}
          columns={7}
          gap={50}
          rows={2}
          buffer={2}
          onSelectedChanged={updateContentBlock}
          onEndReached={onEndReached}
          onEndReachedThreshold={22}
          width={1620}
          autofocus
          each={provider().pages()}>
          {(item) => {
            const current = item();
            if (isCategoriesList()) {
              return (
                <View
                  style={styles.Thumbnail}
                  color={hexColor("0b0b0f")}
                  forwardStates
                  display="flex"
                  justifyContent="center"
                  alignItems="center"
                  item={current}
                >
                  <Text
                    width={170}
                    contain="width"
                    fontSize={22}
                    textAlign="center"
                    color={hexColor("ffffff")}
                  >
                    {current.title}
                  </Text>
                </View>
              );
            }
            return <Thumbnail item={current} />;
          }}
        </VirtualGrid>
      </View>
    </Show>
  );
};

export default Browse;
