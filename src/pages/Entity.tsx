import {
  ElementNode,
  Text,
  View,
  Show,
  assertTruthy,
} from "@lightningtv/solid";
import { Column, Row } from "@lightningtv/solid/primitives";

import { createEffect, createMemo, createResource, on, createSignal } from "solid-js";
import { TileRow, Button } from "../components";
import { setGlobalBackground } from "../state";
import ContentBlock from "../components/ContentBlock";
import { useNavigate, useParams } from "@solidjs/router";
import styles from "../styles";
import { getImageUrl } from "../api";
import { getWatchedProgress, type WatchedMap } from "../api/providers/watchProgress";
import { setPendingPlayerMetadata } from "../utils/playerMetadata";
//import * as player from "../video";
const Entity = (props) => {
  const [backdropAlpha, setBackdropAlpha] = createSignal(0);
  const [playFocused, setPlayFocused] = createSignal(false);
  const [playMessage, setPlayMessage] = createSignal("");
  const navigate = useNavigate();
  const params = useParams();
  const [watched] = createResource<WatchedMap>(getWatchedProgress);

  createEffect(
    on(
      props.data.entity,
      (data) => {
        setGlobalBackground(data.backgroundImage);
      },
      { defer: true }
    )
  );

  const columnY = 640;

  const Backdrop = {
    colorTop: "#0E1218",
    colorBottom: "#1A1F27",
    alpha: 0,
    width: 1900,
    height: 1080,
    x: -180,
    y: columnY
  };

  function onRowFocus(this: ElementNode) {
    this.children[this.selected || 0].setFocus();
    columnRef.y = columnY;
    backdropRef.y = columnY;
    backdropRef.alpha = 0;
  }

  function onRowFocusAnimate(this: ElementNode) {
    this.children[this.selected || 0].setFocus();
    columnRef.y = 180;
    backdropRef.y = 0;
    backdropRef.alpha = 0.99;
  }

  function onEnter(this: ElementNode) {
    let entity = this.children.find((c) => c.states.has("focus"));
    assertTruthy(entity && entity.item?.href);
    navigate(entity.item.href as string);
  }

  function onEscape() {
    //closeVideo();
    // Set focus back to lightning app
    document.getElementsByTagName("canvas")[0].focus();
    entityActions.setFocus();
    setBackdropAlpha(0);
  }

  function getQueryParam(key: string) {
    const search = window.location.search || "";
    if (search.includes(key)) {
      return new URLSearchParams(search).get(key);
    }
    const hash = window.location.hash || "";
    const queryIndex = hash.indexOf("?");
    if (queryIndex === -1) return null;
    const hashQuery = hash.slice(queryIndex + 1);
    return new URLSearchParams(hashQuery).get(key);
  }

  const streamId = createMemo(() => getQueryParam("stream_id") || "");
  const ext = createMemo(() => getQueryParam("ext") || "mp4");
  const watchedEntry = createMemo(() => watched()?.[streamId()] || null);
  const watchedPct = createMemo(() => {
    const pct = Number(watchedEntry()?.watched_pct || 0);
    return Math.max(0, Math.min(100, pct));
  });
  const resumeMs = createMemo(() => Number(watchedEntry()?.elapsed_time || 0));
  const playerMetadata = createMemo(() => {
    const data = props.data.entity?.();
    if (!data) return null;

    return {
      mediaType: "movie" as const,
      media_id: streamId(),
      tmdbId: params.id || "",
      title: data.heroContent?.title || data.title || "",
      overview: data.heroContent?.description || data.overview || "",
      posterUrl: data.poster_path ? getImageUrl(data.poster_path) : "",
      backdropUrl: data.backgroundImage || "",
      containerExtension: ext()
    };
  });

  function onEnterTrailer() {
    console.log("Enter Trailer");
    setPlayMessage("");
    console.log("Streamid " + streamId());
    console.log("Ext " + ext());

    if (streamId()) {
      const metadata = playerMetadata();
      if (metadata) {
        setPendingPlayerMetadata(streamId(), {
          mediaType: metadata.mediaType,
          mediaId: metadata.media_id,
          tmdbId: metadata.tmdbId,
          title: metadata.title,
          overview: metadata.overview,
          posterUrl: metadata.posterUrl,
          backdropUrl: metadata.backdropUrl,
          containerExtension: metadata.containerExtension
        });
      }
      navigate(`/player/${streamId()}?ext=${ext()}&type=movie`);
      return;
    }

    const message = "No stream_id found on entity route";
    console.warn(message, {
      href: window.location.href,
      hash: window.location.hash,
      search: window.location.search
    });
    setPlayMessage(message);
  }

  function onResumeTrailer() {
    setPlayMessage("");
    if (!streamId()) {
      setPlayMessage("No stream_id found on entity route");
      return;
    }
    const metadata = playerMetadata();
    if (metadata) {
      setPendingPlayerMetadata(streamId(), {
        mediaType: metadata.mediaType,
        mediaId: metadata.media_id,
        tmdbId: metadata.tmdbId,
        title: metadata.title,
        overview: metadata.overview,
        posterUrl: metadata.posterUrl,
        backdropUrl: metadata.backdropUrl,
        containerExtension: metadata.containerExtension
      });
    }
    navigate(`/player/${streamId()}?ext=${ext()}&type=movie&seek_time=${resumeMs()}`);
  }

  let columnRef, backdropRef, entityActions;

  /**
   * I used to have keyed on Show - This would cause the entire tree to be destroyed and recreated. Without keyed, the data is diffed and the nodes are reused and passed in new props.
   * Only one element gets deleted and recreated - a text node for reviews.
   *
   * However this causes problems with elements which have internal state like Row & Column because the selected does not get reset.
   */
  return (
    <Show when={props.data.entity()}>
      <View
        x={170}
        onUp={() => entityActions.setFocus()}
        onEscape={onEscape}
        announce={[
          props.data.entity().heroContent.title,
          "PAUSE-1",
          props.data.entity().heroContent.description
        ]}
        announceContext="Press LEFT or RIGHT to review items, press UP or DOWN to review categories, press CENTER to select"
      >
        <ContentBlock
          y={260}
          marquee={playFocused()}
          content={props.data.entity().heroContent}
        ></ContentBlock>
        <Row
          ref={entityActions}
          y={500}
          scroll="none"
          height={90}
          width={640}
          gap={40}
          onDown={() => columnRef.setFocus()}
        >
          <Button
            width={300}
            autofocus={props.data.entity()}
            onFocusChanged={setPlayFocused}
            onEnter={onEnterTrailer}
          >
            Play
          </Button>
          <View
            width={300}
            height={90}
            announce={["Resume", "button"]}
            forwardStates
            onEnter={onResumeTrailer}
            color="#31585a"
            borderRadius={12}
            alpha={streamId() ? 1 : 0.55}
            $focus={{ color: "#4f8688" }}
          >
            <Show when={watchedPct() > 0}>
              <View
                width={Math.max(12, Math.round((watchedPct() / 100) * 300))}
                height={90}
                borderRadius={12}
                colorTop="#f5d25f"
                colorBottom="#db8e24"
                alpha={0.95}
              />
            </Show>
            <Text
              x={150}
              y={28}
              width={300}
              mountX={0.5}
              textAlign="center"
              fontSize={26}
              fontWeight="bold"
              color="#ffffff"
            >
              {watchedPct() > 0 ? `Resume ${watchedPct()}%` : "Resume"}
            </Text>
          </View>
        </Row>

        <Show when={playMessage()}>
          <Text x={170} y={610} fontSize={24} color="#ffcc66">
            {playMessage()}
          </Text>
        </Show>

        <Column
          ref={columnRef}
          x={0}
          y={columnY}
          style={styles.Column}
          height={880}
          scroll="none"
          zIndex={5}
        >
          <Show when={props.data.recommendations() && props.data.credits()}>
            <Text skipFocus style={styles.RowTitle}>
              Recommendations
            </Text>
            <TileRow
              onFocus={onRowFocus}
              onEnter={onEnter}
              announce={"Recommendations"}
              items={props.data.recommendations()}
              width={1620}
            />
            <Text skipFocus style={styles.RowTitle}>
              Cast and Crew
            </Text>
            <TileRow
              announce={"Cast and Crew"}
              onFocus={onRowFocusAnimate}
              onEnter={onEnter}
              items={props.data.credits()}
              width={1620}
            />
          </Show>
        </Column>
        <View
          ref={backdropRef}
          style={Backdrop}
          transition={{ alpha: true, y: true }}
        />
      </View>
      <View
        alpha={backdropAlpha()}
        colorTop={"#0E1218"}
        colorBottom={"#1A1F27"}
        skipFocus
        zIndex={200}
        transition={{ alpha: true }}
      />
    </Show>
  );
};

export default Entity;
