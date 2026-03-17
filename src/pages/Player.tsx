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
  getBuffering,
  getState,
  getCurrentTime,
  getCurrentUrl,
  getBufferingInfo
} from "../video";
import { useNavigate } from "@solidjs/router";
import { useParams } from "@solidjs/router";

const Player = () => {
  let parent;
  const navigate = useNavigate();
  const params = useParams();
  const [isReady, setIsReady] = createSignal(false);
  const [debugState, setDebugState] = createSignal("NONE");
  const [debugTime, setDebugTime] = createSignal("0:00");
  const [debugBuffering, setDebugBuffering] = createSignal(false);
  const [debugLastBufferMs, setDebugLastBufferMs] = createSignal(0);
  const [debugUrl, setDebugUrl] = createSignal("");
  const [spinnerFrame, setSpinnerFrame] = createSignal("|");
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

  onMount(async () => {
    setGlobalBackground("#000000");
    parent = document.querySelector('[data-testid="player"]') as HTMLElement;
    await init(parent);
    const streamId = params.id;
    const streamUrl = `${streamBase}/movie/${streamUser}/${streamPass}/${streamId}.${ext}`;
    //const proxyUrl = `${proxyBase}/p/?u=${encodeURIComponent(streamUrl)}`;
    const proxyUrl = `${streamUrl}`;
    console.log("Playing stream URL:", proxyUrl);
    load({ streamUrl: proxyUrl });
  });

  const stateTimer = setInterval(() => {
    const state = getState?.() || null;
    const ready = state ? READY_STATES.has(state) : false;
    const buffering = getBuffering?.() || false;
    setIsReady(ready && !buffering);
    setDebugState(state || "NONE");
    setDebugBuffering(buffering);
    setDebugUrl(getCurrentUrl?.() || "");
    const timeSec = getCurrentTime?.() || 0;
    const mins = Math.floor(timeSec / 60);
    const secs = Math.floor(timeSec % 60)
      .toString()
      .padStart(2, "0");
    setDebugTime(`${mins}:${secs}`);
    const bufInfo = getBufferingInfo?.();
    if (bufInfo?.lastBufferDurationMs != null) {
      setDebugLastBufferMs(bufInfo.lastBufferDurationMs);
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
  });

  return (
    <View autofocus onBack={() => navigate(-1)}>
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
      <View x={40} y={40} width={1840} height={200} color={0x00000000}>
        <Text fontSize={24}>
          {`State: ${debugState()}  Buffering: ${debugBuffering()}`}
        </Text>
        <Text y={30} fontSize={24}>
          {`Time: ${debugTime()}  Last buffer: ${debugLastBufferMs()} ms`}
        </Text>
        <Text y={60} fontSize={22}>
          {`--URL: ${debugUrl()}`}
        </Text>
      </View>
    </View>
  );
};

export default Player;
