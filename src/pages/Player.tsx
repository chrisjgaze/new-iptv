import {
  IntrinsicNodeStyleProps,
  IntrinsicTextNodeStyleProps,
  Text,
  View,
  hexColor
} from "@lightningtv/solid";
import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { setGlobalBackground } from "../state";
import {
  updateWatchProgress
} from "../api/providers/watchProgress";
import { getPendingPlayerMetadata, setPendingPlayerMetadata } from "../utils/playerMetadata";
import { getProviderUrl } from "../api/backend";
import {
  init,
  load,
  play,
  pause,
  seekTo,
  destroy,
  getBuffering,
  getPreparing,
  getState,
  getCurrentTime,
  getCurrentUrl,
  getBufferingInfo,
  getVideoDuration,
  getVolume,
  getMuted,
  adjustVolume,
  getBackend,
  getLastError,
  getDebugEvents,
  getSubtitleTracks,
  setSubtitleTrack,
  getSubtitleText
} from "../video";

// Remote keys: Yellow (405) or CC/Caption (10221) cycle subtitles; Red (403) shows/hides the
// technical info. "c" and "d" do the same on a computer keyboard for browser testing.
const SUBTITLE_KEYCODES = new Set([405, 10221]);
const DEBUG_KEYCODES = new Set([403]);
const SUBTITLE_PREF_KEY = "cjgflix.subtitleLanguage"; // "off" or a language code / track label

function readSubtitlePref(): string {
  try {
    return window.localStorage.getItem(SUBTITLE_PREF_KEY) || "off";
  } catch (e) {
    return "off";
  }
}
function writeSubtitlePref(value: string) {
  try {
    window.localStorage.setItem(SUBTITLE_PREF_KEY, value);
  } catch (e) {
    /* storage unavailable: keep the choice for this session only */
  }
}
import { useLocation, useNavigate, useParams } from "@solidjs/router";

const SUBTITLE_LINE_HEIGHT = 56;
const MINI_BAR_WIDTH = 200;
// Series: show the "Next episode" card from 95% through, start the next episode at 98%.
const NEXT_CARD_AT = 0.95;
const NEXT_AUTOPLAY_AT = 0.98;

type NextEpisode = { id: string; ext: string; label: string; title: string };

/** The episode after `episodeId` in the series: next in the season, else the next season's first. */
async function findNextEpisode(seriesId: string, episodeId: string): Promise<NextEpisode | null> {
  const { getSeriesInfo } = await import("../api/providers/seriesInfo");
  const info: any = await getSeriesInfo(seriesId);
  const ordered: { season: string; ep: any }[] = [];
  for (const season of info.seasonKeys || []) {
    const eps = [...(info.episodes?.[season] || [])].sort(
      (a, b) => (Number(a.episode_num) || 0) - (Number(b.episode_num) || 0)
    );
    eps.forEach((ep) => ordered.push({ season, ep }));
  }
  const index = ordered.findIndex((e) => String(e.ep.id) === String(episodeId));
  const next = index >= 0 ? ordered[index + 1] : undefined;
  if (!next || !next.ep.id) return null;
  return {
    id: String(next.ep.id),
    ext: next.ep.container_extension || "mp4",
    label: `S${next.season} E${next.ep.episode_num ?? ""}`.trim(),
    title: next.ep.title || ""
  };
}
// Controls bar layout (1920x1080)
const BAR_X = 80;
const BAR_W = 1760;
const BAR_H = 222;
const BAR_Y = 1080 - BAR_H - 40;
const TRACK_X = 170;
const TRACK_W = BAR_W - TRACK_X - 190;

// Hide login details that appear inside stream URLs: /movie/<user>/<pass>/123.mp4
function maskUrl(text: string) {
  return String(text || "").replace(
    /\/(movie|series|live)\/[^/\s]+\/[^/\s]+\//g,
    "/$1/***/***/"
  );
}
// One short line for the controls bar; the full message is in the red-button panel.
function shortError(text: string) {
  const t = maskUrl(text).replace(/^\S+T\S+Z\s+/, ""); // drop the ISO timestamp
  return t.length > 110 ? t.slice(0, 107) + "..." : t;
}
// Rough line count for sizing the subtitle band: explicit breaks plus wrapping at ~58 characters.
function subtitleLineCount(text: string) {
  return text
    .split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 58)), 0);
}

const Player = () => {
  let parent;
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const [isReady, setIsReady] = createSignal(false);
  const [debugState, setDebugState] = createSignal("NONE");
  const [debugBackend, setDebugBackend] = createSignal("none");
  const [debugTime, setDebugTime] = createSignal("0:00");
  const [debugBuffering, setDebugBuffering] = createSignal(false);
  const [debugPreparing, setDebugPreparing] = createSignal(false);
  const [debugLastBufferMs, setDebugLastBufferMs] = createSignal(0);
  const [debugUrl, setDebugUrl] = createSignal("");
  const [debugError, setDebugError] = createSignal("");
  const [debugEvents, setDebugEvents] = createSignal<string[]>([]);
  const [spinnerFrame, setSpinnerFrame] = createSignal("|");
  const [currentTimeSec, setCurrentTimeSec] = createSignal(0);
  const [durationSec, setDurationSec] = createSignal(0);
  const [controlsVisible, setControlsVisible] = createSignal(true);
  const [pendingSeekMinutes, setPendingSeekMinutes] = createSignal("");
  const [lastKey, setLastKey] = createSignal("");
  const [seekNotice, setSeekNotice] = createSignal("");
  const [playerInitialized, setPlayerInitialized] = createSignal(false);
  const [volumePercent, setVolumePercent] = createSignal(100);
  const [isMuted, setIsMuted] = createSignal(false);
  const [subtitleTracks, setSubtitleTracks] = createSignal<
    { index: number; language: string; label: string }[]
  >([]);
  const [subtitlePos, setSubtitlePos] = createSignal(-1); // position in subtitleTracks, -1 = off
  const [subtitleLine, setSubtitleLine] = createSignal("");
  // Always-on mini progress bar (bottom right). Stored in whole pixels so the screen is only
  // redrawn when the bar actually grows: about once every 30s for a 2-hour film.
  const [miniProgressPx, setMiniProgressPx] = createSignal(0);
  const [streamTitle, setStreamTitle] = createSignal("");
  const [streamSubtitle, setStreamSubtitle] = createSignal("");
  const [showDebug, setShowDebug] = createSignal(false); // red button
  const [nextEpisode, setNextEpisode] = createSignal<NextEpisode | null>(null);
  const [nextCardVisible, setNextCardVisible] = createSignal(false);
  const [nextCountdown, setNextCountdown] = createSignal(0);
  let nextDismissed = false;
  let advancing = false;
  let lastProgress = 0;

  const progressPx = () =>
    durationSec() > 0
      ? Math.round(Math.max(0, Math.min(1, currentTimeSec() / durationSec())) * TRACK_W)
      : 0;
  const statusChips = () => {
    const subs = subtitleTracks().length
      ? `Subtitles: ${subtitlePos() >= 0 ? subtitleName(subtitlePos()) : "Off"}`
      : "No subtitles";
    const vol = isMuted() ? "Muted" : `Volume ${volumePercent()}%`;
    return `${subs}    ${vol}`;
  };
  let subtitleTracksLoaded = false;
  const streamUser = import.meta.env.VITE_STREAM_USERNAME || "YOUR_USERNAME";
  const streamPass = import.meta.env.VITE_STREAM_PASSWORD || "YOUR_PASSWORD";
  const proxyBase =
    import.meta.env.VITE_PROXY_BASE_URL || "http://192.168.1.46:8080";

  function getQueryParam(key: string) {
    return new URLSearchParams(location.search).get(key);
  }

  function getCurrentStream() {
    const ext = getQueryParam("ext") || "mp4";
    const initialSeekMs = Number.parseInt(getQueryParam("seek_time") || "0", 10);
    const requestedType = getQueryParam("type");
    const streamType =
      requestedType === "series" || requestedType === "live"
        ? requestedType
        : "movie";
    const metadata = getPendingPlayerMetadata(params.id || "");

    return {
      streamId: params.id || "",
      ext,
      initialSeekMs: Number.isNaN(initialSeekMs) ? 0 : initialSeekMs,
      streamType,
      mediaType:
        metadata.mediaType ||
        (streamType === "series" ? "series" : streamType === "live" ? "movie" : "movie"),
      mediaId: metadata.mediaId || params.id || "",
      tmdbId: metadata.tmdbId || "",
      title: metadata.title || "",
      subtitle: metadata.subtitle || "",
      overview: metadata.overview || "",
      posterUrl: metadata.posterUrl || "",
      backdropUrl: metadata.backdropUrl || "",
      containerExtension: metadata.containerExtension || ext
    };
  }
  const OverviewContainer = {
    width: 900,
    height: 500,
    y: 350,
    x: 150,
    gap: 25,
    display: "block",
    position: "absolute",
    flexDirection: "column",
    justifyContent: "flexStart",
    color: hexColor("00000000")
  } satisfies IntrinsicNodeStyleProps;

  const styles = {
    detailPane: {
      x: 570,
      y: 63,
      width: 1326,
      height: 954,
      border: {
        color: "#535353",
        width: 1
      },
      borderRadius: 15,
      linearGradient: {
        colors: [0x2c2a3bff, 0x3a3847ff, 0x4c4859ff] as number[],
        angle: 4.1
      }
    },
    detailTitle: {
      x: 50,
      y: 27,
      fontSize: 30,
      fontWeight: "bold"
    },
    detailImage: {
      width: 570,
      height: 839,
      x: 50,
      y: 80,
      borderRadius: 15
    },
    detailDescriptionPane: {
      x: 679,
      y: 80,
      width: 602,
      height: 839,
      display: "flex",
      flexDirection: "column",
      gap: 30
    },
    detailDescription: {
      width: 602,
      display: "flex",
      flexDirection: "column"
    },
    detailDescriptionTitle: {
      width: 602,
      color: "#F0CB00",
      fontSize: 22,
      fontWeight: "bold"
    },
    detailDescriptionText: {
      width: 602,
      fontSize: 22,
      maxLines: 10
    }
  } as const;

  const SublineContainer = {
    width: 900,
    gap: 6,
    display: "flex",
    flexDirection: "row",
    justifyContent: "flexStart",
    color: "#00000000"
  } satisfies IntrinsicNodeStyleProps;

  const Title = {
    fontSize: 42,
    fontWeight: "bold"
  } as const;

  const SubTitle = {
    fontSize: 38,
    fontWeight: 500
  };

  const Overview = {
    width: OverviewContainer.width,
    fontSize: 26,
    fontWeight: "normal",
    contain: "width"
  } satisfies IntrinsicTextNodeStyleProps;

  const Subline = {
    fontSize: 26,
    fontWeight: 100
  };

  const READY_STATES = new Set(["READY", "PLAYING", "PAUSED"]);
  const SEEK_STEP_SECONDS = 15;
  let controlsHideTimer;
  let numericSeekTimer;
  let saveProgressTimer;
  let hasAppliedInitialSeek = false;
  let isSavingProgress = false;

  function formatTime(totalSeconds: number) {
    const safe = Math.max(0, Math.floor(totalSeconds || 0));
    const hours = Math.floor(safe / 3600);
    const mins = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    if (hours > 0) {
      return `${hours}:${mins.toString().padStart(2, "0")}:${secs
        .toString()
        .padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  }

  function scheduleControlsHide() {
    if (controlsHideTimer) clearTimeout(controlsHideTimer);
    controlsHideTimer = window.setTimeout(() => {
      if (!debugBuffering()) {
        setControlsVisible(false);
      }
    }, 4500);
  }

  function revealControls() {
    setControlsVisible(true);
    scheduleControlsHide();
  }

  function adjustPlayerVolume(delta: number) {
    revealControls();
    if (getBackend?.() !== "html5") return false;
    const nextVolume = adjustVolume(delta);
    setVolumePercent(Math.round(nextVolume * 100));
    setSeekNotice(`Volume ${Math.round(nextVolume * 100)}%`);
    return true;
  }

  function togglePlayPause() {
    revealControls();
    if (debugState() === "PAUSED") {
      play();
      return true;
    }
    if (debugState() === "PLAYING" || debugState() === "READY") {
      pause();
      return true;
    }
    return false;
  }

  function seekBy(deltaSeconds: number) {
    revealControls();
    const duration = durationSec();
    if (!duration) return false;
    const nextTime = Math.max(
      0,
      Math.min(currentTimeSec() + deltaSeconds, duration)
    );
    seekTo(nextTime);
    return true;
  }

  function commitPendingSeek() {
    const pending = pendingSeekMinutes();
    setPendingSeekMinutes("");
    if (!pending) return false;
    const minutes = Number.parseInt(pending, 10);
    if (Number.isNaN(minutes)) return false;
    const targetSeconds = minutes * 60;
    const targetMs = targetSeconds * 1000;
    const notice = `Seeking to ${minutes} min (${formatTime(targetSeconds)} / ${targetMs} ms)`;
    setSeekNotice(notice);
    console.log("Player pending seek string:", pending);
    console.log("Player seek target:", {
      minutes,
      targetSeconds,
      targetMs
    });
    seekTo(targetSeconds);
    revealControls();
    return true;
  }

  function schedulePendingSeek() {
    if (numericSeekTimer) clearTimeout(numericSeekTimer);
    numericSeekTimer = window.setTimeout(() => {
      commitPendingSeek();
    }, 2000);
  }

  function handleNumericSeek(event: KeyboardEvent) {
    if (event.repeat) return false;

    const key =
      typeof event?.key === "string" && /^\d$/.test(event.key)
        ? event.key
        : typeof event?.keyCode === "number" && event.keyCode >= 48 && event.keyCode <= 57
          ? String(event.keyCode - 48)
          : typeof event?.keyCode === "number" &&
              event.keyCode >= 96 &&
              event.keyCode <= 105
            ? String(event.keyCode - 96)
            : null;

    if (event?.key || event?.keyCode != null) {
      const label = `Key: ${event.key || "?"} Code: ${event.keyCode ?? "?"}`;
      setLastKey(label);
      console.log("Player keypress:", label);
    }

    if (key) {
      console.log("Player numeric seek input:", key);
      setPendingSeekMinutes((current) => {
        const next = `${current}${key}`;
        console.log("Player pending seek updated:", next);
        setSeekNotice(`Typed minutes: ${next}`);
        return next;
      });
      revealControls();
      schedulePendingSeek();
      return true;
    }
    if (event.key === "Backspace" && pendingSeekMinutes()) {
      setPendingSeekMinutes((current) => {
        const next = current.slice(0, -1);
        console.log("Player pending seek updated:", next);
        setSeekNotice(next ? `Typed minutes: ${next}` : "");
        return next;
      });
      revealControls();
      if (pendingSeekMinutes()) schedulePendingSeek();
      else if (numericSeekTimer) clearTimeout(numericSeekTimer);
      return true;
    }
    return false;
  }

  function subtitleName(pos: number) {
    const t = subtitleTracks()[pos];
    return t ? t.label : "Off";
  }

  function loadSubtitleTracks() {
    subtitleTracksLoaded = true;
    const tracks = getSubtitleTracks?.() || [];
    setSubtitleTracks(tracks);
    const pref = readSubtitlePref();
    if (pref === "off" || !tracks.length) return;
    const pos = tracks.findIndex(
      (t) => t.language.toLowerCase() === pref.toLowerCase() || t.label === pref
    );
    if (pos >= 0 && setSubtitleTrack(tracks[pos].index)) {
      setSubtitlePos(pos);
      setSeekNotice(`Subtitles: ${tracks[pos].label}`);
      revealControls();
    }
  }

  function cycleSubtitles() {
    if (!subtitleTracksLoaded && READY_STATES.has(getState?.() || "")) loadSubtitleTracks();
    if (!subtitleTracks().length) {
      setSeekNotice("No subtitles in this file");
      revealControls();
      return true;
    }
    const next = subtitlePos() + 1 >= subtitleTracks().length ? -1 : subtitlePos() + 1;
    const ok = setSubtitleTrack(next < 0 ? -1 : subtitleTracks()[next].index);
    if (ok) {
      setSubtitlePos(next);
      if (next < 0) setSubtitleLine("");
      writeSubtitlePref(next < 0 ? "off" : subtitleTracks()[next].language || subtitleTracks()[next].label);
      setSeekNotice(
        next < 0 ? "Subtitles off" : `Subtitles: ${subtitleName(next)} (${next + 1}/${subtitleTracks().length})`
      );
    } else {
      setSeekNotice("Couldn't change subtitles");
    }
    revealControls();
    return true;
  }

  function handlePlayerKey(event: KeyboardEvent) {
    if (!event.repeat && (SUBTITLE_KEYCODES.has(event.keyCode) || event.key === "c")) {
      return cycleSubtitles();
    }
    if (!event.repeat && (DEBUG_KEYCODES.has(event.keyCode) || event.key === "d")) {
      setShowDebug(!showDebug());
      revealControls();
      return true;
    }
    return handleNumericSeek(event);
  }

  function updateNextEpisode(state: string, timeSec: number, total: number) {
    const next = nextEpisode();
    if (!next || nextDismissed || advancing || exiting) return;
    const playing = state === "PLAYING" || state === "PAUSED" || state === "READY";
    if (playing && total > 0) {
      const pct = timeSec / total;
      lastProgress = pct;
      setNextCardVisible(pct >= NEXT_CARD_AT);
      setNextCountdown(Math.max(0, Math.ceil(total * NEXT_AUTOPLAY_AT - timeSec)));
      if (pct >= NEXT_AUTOPLAY_AT && state === "PLAYING") playNextEpisode();
    } else if (lastProgress >= NEXT_CARD_AT && (state === "NONE" || state === "IDLE")) {
      // The file ended before 98% was reached (short final segment): carry on anyway.
      playNextEpisode();
    }
  }

  function playNextEpisode() {
    const next = nextEpisode();
    if (!next || advancing) return true;
    advancing = true;
    setNextCardVisible(false);
    void saveWatchProgress();
    const current = getCurrentStream();
    setPendingPlayerMetadata(next.id, {
      mediaType: "series",
      mediaId: current.mediaId,
      title: current.title,
      subtitle: [next.label, next.title].filter(Boolean).join(" · "),
      overview: current.overview,
      posterUrl: current.posterUrl,
      backdropUrl: current.backdropUrl,
      containerExtension: next.ext
    });
    // replace: Back from the next episode returns to the series page, not to this episode.
    navigate(`/player/${next.id}?ext=${next.ext}&type=series&seek_time=0`, { replace: true });
    return true;
  }

  function handleEnter() {
    if (nextCardVisible()) return playNextEpisode();
    return togglePlayPause();
  }

  function handleBack() {
    if (nextCardVisible()) {
      // First Back hides the card and cancels the automatic start; Back again leaves.
      nextDismissed = true;
      setNextCardVisible(false);
      return true;
    }
    return exitPlayer();
  }

  let exiting = false;
  function exitPlayer() {
    if (exiting) return true;
    exiting = true;
    console.log("Player exit requested", {
      routeId: params.id,
      state: getState()
    });
    void saveWatchProgress();
    void destroy();
    navigate(-1);
    return true;
  }

  async function saveWatchProgress() {
    const stream = getCurrentStream();
    if (stream.streamType === "live") return;
    const episodeId = stream.streamId;
    const elapsedTime = Math.floor(currentTimeSec());
    const totalDuration = Math.floor(durationSec());
    if (!episodeId || !elapsedTime || !totalDuration || isSavingProgress) return;

    isSavingProgress = true;
    try {
      await updateWatchProgress({
        episodeId,
        elapsedTimeSec: elapsedTime,
        totalDurationSec: totalDuration,
        mediaType: stream.mediaType,
        mediaId: stream.mediaId,
        tmdbId: stream.tmdbId,
        title: stream.title,
        subtitle: stream.subtitle,
        overview: stream.overview,
        posterUrl: stream.posterUrl,
        backdropUrl: stream.backdropUrl,
        containerExtension: stream.containerExtension
      });
    } catch (error) {
      console.warn("Failed to update watch progress", error);
    } finally {
      isSavingProgress = false;
    }
  }

  async function loadCurrentStream(reason: string) {
    const stream = getCurrentStream();
    if (!stream.streamId) {
      console.log("Player load skipped", {
        reason,
        streamId: stream.streamId
      });
      return;
    }

    hasAppliedInitialSeek = false;
    setStreamTitle(stream.title);
    setStreamSubtitle(stream.subtitle);
    // Next episode (series only): look it up in the background, ignore if the film changed meanwhile.
    setNextEpisode(null);
    setNextCardVisible(false);
    nextDismissed = false;
    advancing = false;
    lastProgress = 0;
    if (stream.streamType === "series" && stream.mediaType === "series" && stream.mediaId) {
      const forId = stream.streamId;
      findNextEpisode(stream.mediaId, forId)
        .then((next) => {
          if (params.id === forId) setNextEpisode(next);
        })
        .catch((e) => console.warn("Next episode lookup failed", e));
    }
    subtitleTracksLoaded = false;
    setSubtitleTracks([]);
    setSubtitlePos(-1);
    setSubtitleLine("");
    setSeekNotice("");
    setPendingSeekMinutes("");
    setCurrentTimeSec(0);
    setDurationSec(0);
    setDebugTime("0:00");
    setDebugError("");

    try {
      const providerUrl = await getProviderUrl();
      const streamPath = stream.streamType === "live" ? "" : `/${stream.streamType}`;
      const streamUrl = `${providerUrl}${streamPath}/${streamUser}/${streamPass}/${stream.streamId}.${stream.ext}`;

      setDebugUrl(streamUrl);
      console.log("Player loadCurrentStream", {
        reason,
        ...stream,
        streamUrl
      });
      console.log("Playing stream URL:", streamUrl);
      await load({ streamUrl });
    } catch (error) {
      console.error("Player load promise rejected", error);
      setDebugError(
        error instanceof Error ? error.message : JSON.stringify(error)
      );
    }
  }

  onMount(async () => {
    const onWindowError = (event: ErrorEvent) => {
      const message = `window error: ${event.message || "unknown"}`;
      console.error(message, event.error);
      setDebugError(message);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason =
        typeof event.reason === "string"
          ? event.reason
          : event.reason?.message || JSON.stringify(event.reason);
      const message = `unhandled rejection: ${reason}`;
      console.error(message, event.reason);
      setDebugError(message);
    };

    window.addEventListener("error", onWindowError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    onCleanup(() => {
      window.removeEventListener("error", onWindowError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    });

    try {
      const stream = getCurrentStream();
      console.log("Player mount", {
        routeId: stream.streamId,
        ext: stream.ext,
        streamType: stream.streamType
      });
      setGlobalBackground("#000000");
      parent = document.querySelector('[data-testid="player"]') as HTMLElement;
      console.log("Player mount target", {
        hasParent: !!parent
      });
      console.log("Player before init");
      init(parent);
      console.log("Player after init");
      setPlayerInitialized(true); // the route effect below performs the first load
    } catch (error) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      console.error("Player mount failed", error);
      setDebugError(`Player mount failed: ${message}`);
    }
  });

  let lastLoadKey = "";
  createEffect(() => {
    const streamId = params.id;
    const routeSearch = location.search;
    if (!playerInitialized() || !streamId) return;
    const loadKey = `${streamId}${routeSearch}`;
    if (loadKey === lastLoadKey) return;
    lastLoadKey = loadKey;
    console.log("Player route update trigger", {
      streamId,
      routeSearch
    });
    void loadCurrentStream("route-update");
  });

  const stateTimer = setInterval(() => {
    const state = getState?.() || null;
    const ready = state ? READY_STATES.has(state) : false;
    const buffering = getBuffering?.() || false;
    const preparing = getPreparing?.() || false;
    const lastError = getLastError?.();
    setIsReady(ready && !buffering);
    setDebugState(state || "NONE");
    setDebugBackend(getBackend?.() || "none");
    setDebugBuffering(buffering);
    setDebugPreparing(preparing);
    setDebugUrl(getCurrentUrl?.() || "");
    setVolumePercent(Math.round((getVolume?.() || 0) * 100));
    setIsMuted(!!getMuted?.());
    setDebugError(
      lastError
        ? `${lastError.at} ${lastError.message}${lastError.detail ? ` — ${lastError.detail}` : ""}`
        : ""
    );
    setDebugEvents(
      (getDebugEvents?.() || [])
        .slice(-5)
        .reverse()
        .map((entry) => `${entry.at.slice(11, 19)} ${entry.message}`)
    );
    setSubtitleLine(subtitlePos() >= 0 ? getSubtitleText?.() || "" : "");
    // Track info is available once playing; read it once per film.
    if (!subtitleTracksLoaded && state === "PLAYING") loadSubtitleTracks();
    const timeSec = getCurrentTime?.() || 0;
    setCurrentTimeSec(timeSec);
    const total = durationSec();
    setMiniProgressPx(total > 0 ? Math.round(Math.min(1, Math.max(0, timeSec / total)) * MINI_BAR_WIDTH) : 0);
    updateNextEpisode(state || "", timeSec, total);
    setDebugTime(formatTime(timeSec));
    setDurationSec(getVideoDuration?.() || 0);
    const bufInfo = getBufferingInfo?.();
    if (bufInfo?.lastBufferDurationMs != null) {
      setDebugLastBufferMs(bufInfo.lastBufferDurationMs);
    }
    if (buffering || preparing) {
      setControlsVisible(true);
    }
    if (
      !hasAppliedInitialSeek &&
      getCurrentStream().streamType !== "live" &&
      getCurrentStream().initialSeekMs > 0 &&
      ready &&
      timeSec >= 0
    ) {
      hasAppliedInitialSeek = true;
      const seekSeconds = Math.floor(getCurrentStream().initialSeekMs / 1000);
      seekTo(seekSeconds);
      setSeekNotice(`Resumed from ${formatTime(seekSeconds)}`);
      revealControls();
    }
  }, 300);

  const frames = ["|", "/", "-", "\\"];
  let frameIndex = 0;
  const spinnerTimer = setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length;
    setSpinnerFrame(frames[frameIndex]);
  }, 120);

  saveProgressTimer = window.setInterval(() => {
    if (debugState() === "PLAYING" || debugState() === "PAUSED") {
      void saveWatchProgress();
    }
  }, 15000);

  onCleanup(() => {
    clearInterval(stateTimer);
    clearInterval(spinnerTimer);
    if (saveProgressTimer) clearInterval(saveProgressTimer);
    if (controlsHideTimer) clearTimeout(controlsHideTimer);
    if (numericSeekTimer) clearTimeout(numericSeekTimer);
    if (!exiting) {
      void saveWatchProgress();
      void destroy();
    }
  });


  return (
    <View
      autofocus
      onBack={handleBack}
      onEnter={handleEnter}
      onUp={() => adjustPlayerVolume(0.1) || (revealControls(), true)}
      onDown={() => adjustPlayerVolume(-0.1) || (revealControls(), true)}
      onLeft={() => seekBy(-SEEK_STEP_SECONDS)}
      onRight={() => seekBy(SEEK_STEP_SECONDS)}
      onKeyPress={handlePlayerKey}
    >
      {!isReady() && (
        <View x={0} y={0} width={1920} height={1080} color={0x000000cc}>
          <Text
            x={960}
            y={520}
            fontSize={36}
            textAlign="center"
            style={{ letterSpacing: 2 }}
          >
            LOADING {spinnerFrame()}
          </Text>
        </View>
      )}
      {!controlsVisible() && durationSec() > 0 && (
        <View x={1920 - 60 - MINI_BAR_WIDTH} y={1080 - 40} width={MINI_BAR_WIDTH} height={4} color={0xffffff33}>
          <View x={0} y={0} width={miniProgressPx()} height={4} color={0xffffffaa} />
        </View>
      )}
      {nextCardVisible() && nextEpisode() && (
        <View
          x={1920 - 60 - 600}
          y={controlsVisible() ? BAR_Y - 190 : 1080 - 60 - 170}
          width={600}
          height={170}
          borderRadius={24}
          color={0x0b0f16f0}
        >
          <Text x={32} y={24} fontSize={20} fontWeight="bold" color={0xf0cb00ff}>
            NEXT EPISODE
          </Text>
          <Text x={32} y={56} width={536} contain="width" maxLines={1} fontSize={30} fontWeight="bold">
            {`${nextEpisode()!.label}${nextEpisode()!.title ? ` · ${nextEpisode()!.title}` : ""}`}
          </Text>
          <Text x={32} y={110} width={536} contain="width" maxLines={1} fontSize={21} color={0xffffffb3}>
            {`${nextCountdown() > 0 ? `Starts in ${nextCountdown()}s` : "Starting..."}   ·   OK play now   ·   Back cancel`}
          </Text>
        </View>
      )}
      {subtitleLine() && (
        <View
          x={160}
          y={
            (controlsVisible() ? BAR_Y - 14 : 1020) -
            subtitleLineCount(subtitleLine()) * SUBTITLE_LINE_HEIGHT -
            24
          }
          width={1600}
          height={subtitleLineCount(subtitleLine()) * SUBTITLE_LINE_HEIGHT + 24}
          color={0x000000a0}
        >
          <Text
            x={0}
            y={12}
            width={1600}
            contain="width"
            textAlign="center"
            fontSize={44}
            lineHeight={SUBTITLE_LINE_HEIGHT}
            color={0xffffffff}
          >
            {subtitleLine()}
          </Text>
        </View>
      )}
      {controlsVisible() && (
        <View x={BAR_X} y={BAR_Y} width={BAR_W} height={BAR_H} color={0x0b0f16e8} borderRadius={28}>
          {/* Row 1: title (bold) + episode / subtitle line; status chips on the right */}
          <Text x={48} y={26} width={1080} contain="width" maxLines={1} fontSize={38} fontWeight="bold">
            {streamTitle() || "Now playing"}
          </Text>
          {streamSubtitle() && (
            <Text x={48} y={74} width={1080} contain="width" maxLines={1} fontSize={24} color={0xffffffb3}>
              {streamSubtitle()}
            </Text>
          )}
          <Text
            x={BAR_W - 48 - 560}
            y={32}
            width={560}
            contain="width"
            textAlign="right"
            fontSize={22}
            color={0xffffffb3}
          >
            {statusChips()}
          </Text>
          {debugState() === "PAUSED" && (
            <View x={BAR_W - 48 - 130} y={66} width={130} height={36} borderRadius={18} color={0xf0cb00ff}>
              <Text x={0} y={6} width={130} contain="width" textAlign="center" fontSize={20} fontWeight="bold" color={0x000000ff}>
                PAUSED
              </Text>
            </View>
          )}

          {/* Row 2: time, rounded progress track with a round knob, duration */}
          <Text x={48} y={126} fontSize={24}>
            {debugTime()}
          </Text>
          <View x={TRACK_X} y={137} width={TRACK_W} height={8} borderRadius={4} color={0xffffff33}>
            <View width={progressPx()} height={8} borderRadius={4} color={0xf0cb00ff} />
          </View>
          <View x={TRACK_X + progressPx() - 10} y={131} width={20} height={20} borderRadius={10} color={0xffffffff} />
          <Text x={BAR_W - 48 - 120} y={126} width={120} contain="width" textAlign="right" fontSize={24}>
            {formatTime(durationSec())}
          </Text>

          {/* Row 3: quiet key hints on the left; notices (or a short error) on the right */}
          {debugError() ? (
            <Text x={48} y={176} width={BAR_W - 96} contain="width" maxLines={1} fontSize={20} color={0xff7b72ff}>
              {`Can't play: ${shortError(debugError())}   (red button: details)`}
            </Text>
          ) : (
            <Text x={48} y={178} fontSize={19} color={0xffffff73}>
              {`OK ${debugState() === "PAUSED" ? "play" : "pause"}  ·  Left/Right ${SEEK_STEP_SECONDS}s  ·  Up/Down volume  ·  0-9 jump to minute  ·  Yellow subtitles  ·  Red info`}
            </Text>
          )}
          {(pendingSeekMinutes() || seekNotice()) && !debugError() && (
            <Text
              x={BAR_W - 48 - 520}
              y={176}
              width={520}
              contain="width"
              textAlign="right"
              fontSize={21}
              fontWeight="bold"
              color={0xf0cb00ff}
            >
              {pendingSeekMinutes() ? `Jump to ${pendingSeekMinutes()} min` : seekNotice()}
            </Text>
          )}
        </View>
      )}
      {/* Red button: technical details, hidden by default */}
      {showDebug() && (
        <View x={40} y={40} width={1840} height={360} color={0x000000c8} borderRadius={20}>
          <Text x={28} y={20} fontSize={22} fontWeight="bold" color={0xf0cb00ff}>
            Technical info (red button to hide)
          </Text>
          <Text x={28} y={56} width={1784} contain="width" maxLines={2} fontSize={19}>
            {`State ${debugState()}  ·  Backend ${debugBackend()}  ·  Buffering ${debugBuffering()}  ·  Preparing ${debugPreparing()}  ·  Last buffer ${debugLastBufferMs()} ms  ·  ${lastKey()}`}
          </Text>
          <Text x={28} y={110} width={1784} contain="width" maxLines={2} fontSize={18} color={0xffffffb3}>
            {`URL ${maskUrl(debugUrl())}`}
          </Text>
          {debugError() && (
            <Text x={28} y={162} width={1784} contain="width" maxLines={3} fontSize={19} color={0xff7b72ff}>
              {`Error: ${maskUrl(debugError())}`}
            </Text>
          )}
          <Text x={28} y={250} width={1784} contain="width" maxLines={4} fontSize={17} color={0xffffffb3}>
            {`Player events: ${debugEvents().join("  |  ")}`}
          </Text>
        </View>
      )}
    </View>
  );
};

export default Player;
