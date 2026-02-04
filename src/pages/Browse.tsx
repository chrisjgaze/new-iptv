import {
  createEffect,
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
import {
  useNavigate,
  usePreloadRoute,
  useMatch,
  useLocation
} from "@solidjs/router";
import { Thumbnail, TileRow } from "../components";
import { Text, hexColor } from "@lightningtv/solid";
import styles from "../styles";
import { setGlobalBackground } from "../state";
import { createInfiniteScroll } from "../components/pagination";
import ContentBlock from "../components/ContentBlock";
import { debounce } from "@solid-primitives/scheduled";
import api, { getImageUrl } from "../api";

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
  const plotBase = import.meta.env.VITE_PLOT_URL;
  //const plotBase = import.meta.env.VITE_PLOT_URL || "/get_plot";
  const plotDebug = (() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get("plotDebug") === "true") return true;
    const hash = window.location.hash || "";
    return hash.includes("plotDebug=true");
  })();
  const bgDebug = (() => {
    const search = new URLSearchParams(window.location.search);
    if (search.get("bgDebug") === "true") return true;
    const hash = window.location.hash || "";
    return hash.includes("bgDebug=true");
  })();
  const [debugLine, setDebugLine] = createSignal("");
  const [debugPlotUrl, setDebugPlotUrl] = createSignal("");
  const [debugCount, setDebugCount] = createSignal(0);
  const [bgDebugLine, setBgDebugLine] = createSignal("");
  const plotCache = new Map<string, string>();
  const plotInFlight = new Map<string, Promise<string>>();
  const backdropCache = new Map<string, string>();
  const backdropInFlight = new Map<string, Promise<string>>();
  const backdropSearchCache = new Map<string, string>();
  const backdropSearchInFlight = new Map<string, Promise<string>>();
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
    console.log("cleanup");
  });

  const provider = createMemo(() => {
    return createInfiniteScroll(props.data());
  });

  const delayedBackgrounds = debounce((img: string | number) => {
    if (bgDebug) {
      setBgDebugLine(`bg=item.backdrop ${img}`);
    }
    setGlobalBackground(img);
  }, 800);
  const delayedTmdbBackgrounds = debounce((img: string) => {
    if (bgDebug) {
      setBgDebugLine(`bg=tmdb ${img}`);
    }
    setGlobalBackground(img);
  }, 800);
  const delayedHero = debounce(
    (content: {}) => setHeroContent(content || {}),
    600
  );

  function setBackgroundDirect(img: string | number, source: string) {
    if (bgDebug) {
      setBgDebugLine(`bg=${source} ${typeof img === "string" ? img : "color"}`);
    }
    setGlobalBackground(img);
  }

  function fetchBackdrop(tmdbId: string): Promise<string> {
    if (backdropCache.has(tmdbId)) {
      return Promise.resolve(backdropCache.get(tmdbId) || "");
    }
    if (backdropInFlight.has(tmdbId)) {
      return backdropInFlight.get(tmdbId)!;
    }
    const request = api
      .get(`/movie/${tmdbId}`)
      .then((data: any) => getImageUrl(data?.backdrop_path, "w1280") || "")
      .then((url) => {
        backdropCache.set(tmdbId, url);
        backdropInFlight.delete(tmdbId);
        return url;
      })
      .catch(() => {
        backdropCache.set(tmdbId, "");
        backdropInFlight.delete(tmdbId);
        return "";
      });
    backdropInFlight.set(tmdbId, request);
    return request;
  }

  function fetchBackdropByTitle(title: string): Promise<string> {
    const key = title.trim().toLowerCase();
    if (!key) return Promise.resolve("");
    if (backdropSearchCache.has(key)) {
      return Promise.resolve(backdropSearchCache.get(key) || "");
    }
    if (backdropSearchInFlight.has(key)) {
      return backdropSearchInFlight.get(key)!;
    }

    const request = api
      .get(`/search/movie?query=${encodeURIComponent(title)}`)
      .then(
        (data: any) =>
          getImageUrl(data?.results?.[0]?.backdrop_path, "w1280") || ""
      )
      .then((url) => {
        backdropSearchCache.set(key, url);
        backdropSearchInFlight.delete(key);
        return url;
      })
      .catch(() => {
        backdropSearchCache.set(key, "");
        backdropSearchInFlight.delete(key);
        return "";
      });

    backdropSearchInFlight.set(key, request);
    return request;
  }

  function applySelection(item: any, immediate = false) {
    if (!item) {
      if (isCategoryMovies()) {
        if (immediate) {
          setBackgroundDirect(0x0b0b0fff, "fallback");
        } else {
          delayedBackgrounds(0x0b0b0fff);
        }
        setHeroContent({
          title: "Category Movies",
          description: ""
        });
      }
      return;
    }

    const backdrop = item.backdrop;
    const hasImageBackdrop =
      typeof backdrop === "string" && backdrop.trim().length > 0;

    if (hasImageBackdrop) {
      if (immediate) {
        setBackgroundDirect(backdrop, "item.backdrop");
      } else {
        delayedBackgrounds(backdrop);
      }
    } else if (isCategoryMovies() && (item.tmdb || item.item?.tmdb)) {
      const tmdbId = item.tmdb || item.item?.tmdb;
      fetchBackdrop(String(tmdbId)).then((url) => {
        if (!url) {
          if (immediate) {
            setBackgroundDirect(0x0b0b0fff, "fallback");
          } else {
            delayedBackgrounds(0x0b0b0fff);
          }
          return;
        }
        if (immediate) {
          setBackgroundDirect(url, "tmdb");
        } else {
          delayedTmdbBackgrounds(url);
        }
      });
    } else if (isCategoryMovies() && item.title) {
      fetchBackdropByTitle(String(item.title)).then((url) => {
        if (!url) {
          if (immediate) {
            setBackgroundDirect(0x0b0b0fff, "fallback");
          } else {
            delayedBackgrounds(0x0b0b0fff);
          }
          return;
        }
        if (immediate) {
          setBackgroundDirect(url, "tmdb-search");
        } else {
          delayedTmdbBackgrounds(url);
        }
      });
    } else if (isCategoryMovies()) {
      if (immediate) {
        setBackgroundDirect(0x0b0b0fff, "fallback");
      } else {
        delayedBackgrounds(0x0b0b0fff);
      }
    }

    const setHero = immediate ? setHeroContent : delayedHero;

    const ratingValue = Number(item.item?.rating ?? item.rating);
    const hasRating = Number.isFinite(ratingValue);

    if (item.item?.stream_id && item.title && (item.tmdb || item.item?.tmdb)) {
      const tmdbId = item.tmdb || item.item?.tmdb;
      const token = ++plotToken;
      const url = `${plotBase}/${tmdbId}`;
      if (plotDebug) {
        console.log("plot request", { tmdbId, title: item.title, url });
        setDebugLine(
          `plot=${url} title=${item.title || ""} tmdb=${tmdbId || ""}`
        );
        setDebugPlotUrl(url);
      }
      setHero({
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
        setHero({
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
      setHero(item.heroContent);
      return;
    }
    if (isCategoryMovies() && item.title) {
      setHero({
        title: item.title,
        description: hasRating ? `Rating ${ratingValue}` : "Movie"
      });
      return;
    }
    if (isCategoryMovies()) {
      setHero({
        title: "Category Movies",
        description: ""
      });
      return;
    }
    if (isCategoriesList() && item.title) {
      setHero({ title: item.title, description: "Category" });
    }
  }

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
      applySelection(item, true);
      // preload(`/browse/tv`, { preloadData: true });
      // preload(`/browse/movie`, { preloadData: true });
      firstRun = false;
      return;
    }

    if (item.href) {
      // preload(item.href, { preloadData: true });
    }

    applySelection(item, false);
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

  createEffect(() => {
    const pages = provider().pages();
    if (!firstRun || !pages.length) return;
    applySelection(pages[0], true);
    firstRun = false;
  });

  return (
    <Show when={provider().pages().length}>
      <ContentBlock
        y={360}
        x={162}
        content={heroContent()}
        forwardFocus={() => vgRef.setFocus()}
      />
      {(plotDebug || bgDebug) && (
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
          <Text
            x={162}
            y={360}
            width={1400}
            contain="width"
            fontSize={18}
            color={hexColor("ffcc00")}
          >
            {bgDebugLine()}
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
          each={provider().pages()}
        >
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
