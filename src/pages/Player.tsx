import {
  IntrinsicNodeStyleProps,
  IntrinsicTextNodeStyleProps,
  Text,
  View,
  hexColor
} from "@lightningtv/solid";
import { createSignal, onCleanup, onMount } from "solid-js";
import { setGlobalBackground } from "../state";
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
  getBackend,
  getLastError,
  getDebugEvents
} from "../video";
import { useNavigate } from "@solidjs/router";
import { useParams } from "@solidjs/router";

const Player = () => {
  let parent;
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
  const streamBase =
    import.meta.env.VITE_STREAM_BASE_URL || "http://YOUR_BASE_URL";
  const streamUser = import.meta.env.VITE_STREAM_USERNAME || "YOUR_USERNAME";
  const streamPass = import.meta.env.VITE_STREAM_PASSWORD || "YOUR_PASSWORD";
  const proxyBase =
    import.meta.env.VITE_PROXY_BASE_URL || "http://192.168.1.46:8080";

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

  const ext = getQueryParam("ext") || "mp4";
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

  async function exitPlayer() {
    console.log("Player exit requested", {
      routeId: params.id,
      state: getState()
    });
    await destroy();
    navigate(-1);
    return true;
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
      console.log("Player mount", {
        routeId: params.id,
        ext
      });
      setGlobalBackground("#000000");
      parent = document.querySelector('[data-testid="player"]') as HTMLElement;
      console.log("Player mount target", {
        hasParent: !!parent
      });
      console.log("Player before init");
      init(parent);
      console.log("Player after init");
      const streamId = params.id;
      console.log("Player stream id", {
        streamId
      });
      const streamUrl = `${streamBase}/movie/${streamUser}/${streamPass}/${streamId}.${ext}`;
      //const proxyUrl = `${proxyBase}/p/?u=${encodeURIComponent(streamUrl)}`;
      const proxyUrl = `${streamUrl}`;
      console.log("Playing stream URL:", proxyUrl);
      void load({ streamUrl: proxyUrl }).catch((error) => {
        console.error("Player load promise rejected", error);
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : JSON.stringify(error);
      console.error("Player mount failed", error);
      setDebugError(`Player mount failed: ${message}`);
    }
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
    setDebugError(
      lastError
        ? `${lastError.at} ${lastError.message}`
        : ""
    );
    setDebugEvents(
      (getDebugEvents?.() || [])
        .slice(-5)
        .reverse()
        .map((entry) => `${entry.at.slice(11, 19)} ${entry.message}`)
    );
    const timeSec = getCurrentTime?.() || 0;
    setCurrentTimeSec(timeSec);
    setDebugTime(formatTime(timeSec));
    setDurationSec(getVideoDuration?.() || 0);
    const bufInfo = getBufferingInfo?.();
    if (bufInfo?.lastBufferDurationMs != null) {
      setDebugLastBufferMs(bufInfo.lastBufferDurationMs);
    }
    if (buffering || preparing) {
      setControlsVisible(true);
    }
  }, 300);

  const frames = ["|", "/", "-", "\\"];
  let frameIndex = 0;
  const spinnerTimer = setInterval(() => {
    frameIndex = (frameIndex + 1) % frames.length;
    setSpinnerFrame(frames[frameIndex]);
  }, 120);

  onCleanup(() => {
    clearInterval(stateTimer);
    clearInterval(spinnerTimer);
    if (controlsHideTimer) clearTimeout(controlsHideTimer);
    if (numericSeekTimer) clearTimeout(numericSeekTimer);
    destroy();
  });

  const progressWidth = 1240;

  return (
    <View
      autofocus
      onBack={exitPlayer}
      onEnter={togglePlayPause}
      onUp={revealControls}
      onDown={revealControls}
      onLeft={() => seekBy(-SEEK_STEP_SECONDS)}
      onRight={() => seekBy(SEEK_STEP_SECONDS)}
      onKeyPress={handleNumericSeek}
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
      {controlsVisible() && (
        <View x={80} y={860} width={1760} height={170} color={0x101820e6}>
          <Text x={40} y={24} fontSize={32} fontWeight="bold">
            {debugState() === "PAUSED" ? "Paused" : "Playing"}
          </Text>
          <Text x={250} y={28} fontSize={22}>
            {`Backend ${debugBackend()}  Left/Right seek ${SEEK_STEP_SECONDS}s`}
          </Text>
          <Text x={520} y={28} fontSize={22}>
            {`Enter ${debugState() === "PAUSED" ? "Play" : "Pause"}`}
          </Text>
          {pendingSeekMinutes() && (
            <Text x={860} y={28} fontSize={22}>
              {`Jump to ${pendingSeekMinutes()} min`}
            </Text>
          )}
          {seekNotice() && (
            <Text x={860} y={54} fontSize={20}>
              {seekNotice()}
            </Text>
          )}
          <Text x={40} y={74} fontSize={24}>
            {debugTime()}
          </Text>
          <Text x={1600} y={74} fontSize={24}>
            {formatTime(durationSec())}
          </Text>
          <View x={40} y={118} width={progressWidth} height={12} color={0x49515cff}>
            <View
              width={Math.max(
                0,
                Math.min(
                  progressWidth,
                  durationSec()
                    ? Math.round((currentTimeSec() / durationSec()) * progressWidth)
                    : 0
                )
              )}
              height={12}
              color={0xf0cb00ff}
            />
          </View>
          <View
            x={
              40 +
              Math.max(
                0,
                Math.min(
                  progressWidth - 10,
                  durationSec()
                    ? Math.round((currentTimeSec() / durationSec()) * progressWidth) - 5
                    : 0
                )
              )
            }
            y={110}
            width={20}
            height={28}
            color={0xffffffff}
          />
          <Text x={40} y={142} fontSize={20}>
            {`Buffering: ${debugBuffering()}  Preparing: ${debugPreparing()}  Last buffer: ${debugLastBufferMs()} ms`}
          </Text>
          <Text x={860} y={142} fontSize={20}>
            {lastKey()}
          </Text>
        </View>
      )}
      {controlsVisible() && (
        <>
          <View x={40} y={40} width={1840} height={96} color={0x00000000}>
            <Text fontSize={24}>
              {`State: ${debugState()}  URL: ${debugUrl()}`}
            </Text>
          </View>
          {debugError() && (
            <View x={40} y={120} width={1840} height={120} color={0x5a0000dd}>
              <Text x={20} y={20} width={1800} fontSize={22} contain="width">
                {`Error: ${debugError()}`}
              </Text>
            </View>
          )}
          <View x={40} y={250} width={900} height={150} color={0x00000088}>
            <Text x={20} y={16} fontSize={22}>
              AVPlay events
            </Text>
            <Text x={20} y={48} width={860} fontSize={18} contain="width">
              {debugEvents().join(" | ")}
            </Text>
          </View>
        </>
      )}
    </View>
  );
};

export default Player;
