/**
 * video.js - Tizen Native AVPlay version
 */
let videoElement = null;
let currentUrl = null;
let lastBufferStartMs = null;
let lastBufferDurationMs = 0;
let lastError = null;
const debugEvents = [];
let transitionLock = Promise.resolve();
let backend = "none";
let debugOverlay = null;

export const state = {
  playingState: false,
  buffering: false,
  preparing: false,
  waitingForGesture: false
};

// Map AVPlay states to your app state
const STATES = {
  IDLE: "IDLE",
  PLAYING: "PLAYING",
  PAUSED: "PAUSED",
  READY: "READY"
};

const isActiveState = (state) =>
  state === STATES.READY ||
  state === STATES.PLAYING ||
  state === STATES.PAUSED;

const isTizenBackend = () => Boolean(window.webapis && window.webapis.avplay);

const ensureHtml5DebugOverlay = () => {
  if (debugOverlay) return debugOverlay;
  debugOverlay = document.getElementById("html5-debug-overlay");
  if (debugOverlay) return debugOverlay;

  debugOverlay = document.createElement("div");
  debugOverlay.id = "html5-debug-overlay";
  debugOverlay.style.cssText = [
    "position:fixed",
    "left:16px",
    "top:16px",
    "right:16px",
    "z-index:2000",
    "padding:12px 16px",
    "background:rgba(0,0,0,0.78)",
    "color:#ffffff",
    "font:16px/1.4 monospace",
    "white-space:pre-wrap",
    "pointer-events:none",
    "border:1px solid rgba(255,255,255,0.25)"
  ].join(";");
  document.body.appendChild(debugOverlay);
  return debugOverlay;
};

const updateHtml5DebugOverlay = () => {
  if (backend !== "html5") return;
  const overlay = ensureHtml5DebugOverlay();
  const stateLabel = !videoElement || !currentUrl
    ? "NONE"
    : state.preparing
      ? "PREPARING"
      : state.buffering
        ? "BUFFERING"
        : videoElement.ended
          ? "ENDED"
          : videoElement.paused
            ? videoElement.currentTime > 0
              ? "PAUSED"
              : "READY"
            : "PLAYING";
  const lines = [
    `Backend: ${backend}`,
    `State: ${stateLabel}`,
    `URL: ${currentUrl || ""}`,
    `Error: ${lastError ? lastError.message : ""}`
  ];
  overlay.textContent = lines.join("\n");
  document.title = `[${stateLabel}] ${currentUrl || "no-url"}`;
};


const resetPlaybackState = () => {
  currentUrl = null;
  lastBufferStartMs = null;
  lastBufferDurationMs = 0;
  lastError = null;
  state.playingState = false;
  state.buffering = false;
  state.preparing = false;
  state.waitingForGesture = false;
  if (debugOverlay) debugOverlay.textContent = "";
};

const pushDebugEvent = (message, details) => {
  const entry = {
    at: new Date().toISOString(),
    message,
    details
  };
  debugEvents.push(entry);
  if (debugEvents.length > 40) debugEvents.shift();
  if (details === undefined) console.log(`[AVPlay] ${message}`);
  else console.log(`[AVPlay] ${message}`, details);
  updateHtml5DebugOverlay();
  return entry;
};

const setLastError = (message, details) => {
  lastError = {
    at: new Date().toISOString(),
    message,
    details
  };
  if (details === undefined) console.error(`[AVPlay] ${message}`);
  else console.error(`[AVPlay] ${message}`, details);
  updateHtml5DebugOverlay();
};

const sleep = (ms) =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

const waitForIdleState = async (label, attempts = 10, delayMs = 100) => {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const currentState = getState();
    pushDebugEvent(`${label} state check`, { attempt, currentState });
    if (
      currentState == null ||
      currentState === STATES.IDLE ||
      currentState === "NONE"
    ) {
      return currentState;
    }
    await sleep(delayMs);
  }

  const finalState = getState();
  pushDebugEvent(`${label} state wait timed out`, { finalState });
  return finalState;
};

const runExclusiveTransition = async (label, fn) => {
  const previous = transitionLock;
  let release;
  transitionLock = new Promise((resolve) => {
    release = resolve;
  });

  await previous;
  pushDebugEvent(`${label} lock acquired`);
  try {
    return await fn();
  } finally {
    pushDebugEvent(`${label} lock released`);
    release();
  }
};

export const init = (element) => {
  backend = isTizenBackend() ? "tizen" : "html5";
  const playerId = backend === "tizen" ? "av-player" : "html5-player";
  const existingElement = document.getElementById(playerId);
  videoElement = existingElement;
  pushDebugEvent("init", {
    backend,
    hasElement: !!element,
    reusedExisting: !!existingElement
  });

  if (backend === "tizen") {
    videoElement = element || existingElement;
    if (!videoElement) {
      videoElement = document.createElement("div");
      videoElement.id = "av-player";
      videoElement.style.cssText =
        "position: absolute; top: 0; left: 0; width: 1px; height: 1px; z-index: -1;";
      document.body.insertBefore(videoElement, document.body.firstChild);
      pushDebugEvent("created av-player element");
    } else {
      videoElement.id = "av-player";
      videoElement.style.cssText =
        "position: absolute; top: 0; left: 0; width: 1px; height: 1px; z-index: -1;";
    }

    const duplicatePlayers = document.querySelectorAll("#av-player");
    if (duplicatePlayers.length > 1) {
      pushDebugEvent("removing duplicate av-player elements", {
        count: duplicatePlayers.length
      });
      for (let index = duplicatePlayers.length - 1; index >= 1; index -= 1) {
        const node = duplicatePlayers[index];
        if (node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
      videoElement = document.getElementById("av-player");
    }
  } else {
    if (!videoElement) {
      videoElement = document.createElement("video");
      videoElement.id = "html5-player";
      videoElement.setAttribute("playsinline", "true");
      videoElement.setAttribute("webkit-playsinline", "true");
      videoElement.controls = false;
      videoElement.autoplay = false;
      videoElement.preload = "auto";
      videoElement.disablePictureInPicture = true;
      videoElement.style.cssText =
        "position: fixed; inset: 0; width: 100vw; height: 100vh; background: #000; object-fit: contain; z-index: 1000;";
      document.body.appendChild(videoElement);
      pushDebugEvent("created html5 player element");
    } else {
      videoElement.style.display = "block";
    }
    ensureHtml5DebugOverlay();
    updateHtml5DebugOverlay();
  }

  pushDebugEvent("init complete", {
    backend,
    hasVideoElement: !!videoElement
  });
};

export const load = async (config) => {
  return runExclusiveTransition("load", async () => {
    const loadStartedAt = Date.now();
    state.preparing = true;

    if (!isTizenBackend()) {
      try {
        if (!videoElement) init();
        currentUrl = config.streamUrl;
        state.waitingForGesture = false;
        videoElement.pause();
        videoElement.removeAttribute("src");
        videoElement.load();
        videoElement.src = currentUrl;
        videoElement.currentTime = 0;
        videoElement.onloadstart = () => {
          pushDebugEvent("html5 loadstart", { url: currentUrl });
        };
        videoElement.onloadedmetadata = () => {
          pushDebugEvent("html5 loadedmetadata", {
            duration: videoElement.duration,
            readyState: videoElement.readyState
          });
        };
        videoElement.oncanplay = () => {
          pushDebugEvent("html5 canplay", {
            readyState: videoElement.readyState
          });
        };
        videoElement.onwaiting = () => {
          state.buffering = true;
          pushDebugEvent("html5 buffering start");
        };
        videoElement.onplaying = () => {
          state.preparing = false;
          state.buffering = false;
          state.playingState = true;
          state.waitingForGesture = false;
          updateHtml5DebugOverlay();
          pushDebugEvent("html5 playing");
        };
        videoElement.onpause = () => {
          state.playingState = false;
          updateHtml5DebugOverlay();
          pushDebugEvent("html5 paused");
        };
        videoElement.onended = () => {
          state.playingState = false;
          updateHtml5DebugOverlay();
          pushDebugEvent("html5 ended");
        };
        videoElement.onstalled = () => {
          pushDebugEvent("html5 stalled", {
            networkState: videoElement.networkState,
            readyState: videoElement.readyState
          });
        };
        videoElement.onerror = () => {
          state.preparing = false;
          state.buffering = false;
          const mediaError = videoElement.error;
          const errorDetails = {
            code: mediaError?.code,
            message: mediaError?.message || mediaError,
            networkState: videoElement.networkState,
            readyState: videoElement.readyState,
            canPlayType: {
              mp4: videoElement.canPlayType('video/mp4'),
              hls: videoElement.canPlayType('application/vnd.apple.mpegurl'),
              mkv: videoElement.canPlayType('video/x-matroska')
            }
          };
          setLastError("HTML5 video error", errorDetails);
        };

        videoElement.load();

        await new Promise((resolve, reject) => {
          const onLoaded = () => {
            videoElement.removeEventListener("loadedmetadata", onLoaded);
            videoElement.removeEventListener("error", onError);
            resolve();
          };
          const onError = () => {
            videoElement.removeEventListener("loadedmetadata", onLoaded);
            videoElement.removeEventListener("error", onError);
            reject(new Error("HTML5 video failed to load metadata"));
          };
          videoElement.addEventListener("loadedmetadata", onLoaded);
          videoElement.addEventListener("error", onError);
        });

        state.preparing = false;
        updateHtml5DebugOverlay();
        pushDebugEvent("html5 load success", {
          elapsedMs: Date.now() - loadStartedAt,
          url: currentUrl
        });
        const playPromise = videoElement.play();
        updateHtml5DebugOverlay();
        if (playPromise?.catch) {
          playPromise.catch((error) => {
            state.playingState = false;
            state.waitingForGesture = error?.name === "NotAllowedError";
            if (state.waitingForGesture) {
              setLastError(
                "HTML5 autoplay blocked. Launch Chromium with --autoplay-policy=no-user-gesture-required or start playback with a user gesture.",
                error
              );
              return;
            }
            setLastError("HTML5 play failed", error);
          });
        }
        return;
      } catch (e) {
        state.preparing = false;
        setLastError("HTML5 load exception", e);
        return;
      }
    }

    try {
      try {
        const currentState = getState();
        pushDebugEvent("pre-open cleanup", { currentState });
        if (isActiveState(currentState)) {
          webapis.avplay.stop();
          pushDebugEvent("stop before open", { currentState });
          await sleep(250);
        }
        webapis.avplay.close();
        pushDebugEvent("close before open");
        await waitForIdleState("after close");
        await sleep(500);
        pushDebugEvent("post-close cooldown complete");
      } catch (e) {
        setLastError("AVPlay Pre-Open Cleanup Exception", e);
      }

      // 1. Open the URL
      const url = config.streamUrl;
      currentUrl = url;
      pushDebugEvent("open URL", { url });
      //webapis.avplay.open(
      //"http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
      //);
      webapis.avplay.open(url);
      pushDebugEvent("open complete", { state: getState() });
      await sleep(250);
      //http://vpn.tsclean.cc/movie/6c82e7398a/a2bfaf950817/1998017.mp4
      // 2. Set listeners
      const listener = {
      onbufferingstart: () => {
        state.buffering = true;
        lastBufferStartMs = Date.now();
        pushDebugEvent("buffering start");
      },
      onbufferingcomplete: () => {
        state.buffering = false;
        if (lastBufferStartMs) {
          lastBufferDurationMs = Date.now() - lastBufferStartMs;
          lastBufferStartMs = null;
        }
        pushDebugEvent("buffering complete", {
          lastBufferDurationMs
        });
      },
      onstreamcompleted: () => {
        state.buffering = false;
        pushDebugEvent("stream completed");
        destroy();
      },
      oncurrentplaytime: (currentTimeMs) => {
        if (currentTimeMs % 30000 < 500) {
          pushDebugEvent("current play time", { currentTimeMs });
        }
      },
      onevent: (eventType, eventData) => {
        pushDebugEvent("player event", { eventType, eventData });
      },
      onerror: (type, data) => {
        state.buffering = false;
        state.preparing = false;
        setLastError("AVPlay Error", { type, data, state: getState() });
      },
      onerrormsg: (message) => {
        state.buffering = false;
        state.preparing = false;
        setLastError("AVPlay Error Message", { message, state: getState() });
      }
      };
      webapis.avplay.setListener(listener);
      pushDebugEvent("listener attached");

      try {
        webapis.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_FULL_SCREEN");
        pushDebugEvent("display method set");
      } catch (e) {
        setLastError("AVPlay setDisplayMethod failed", e);
      }

      // 3. Set Display Area (Full Screen)
      const width = window.innerWidth || 1920;
      const height = window.innerHeight || 1080;
      webapis.avplay.setDisplayRect(0, 0, width, height);
      pushDebugEvent("display rect set", { width, height });

      // 4. Prepare (This is async on Tizen)
      return new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          state.preparing = false;
          setLastError("AVPlay prepareAsync timed out", {
            url,
            elapsedMs: Date.now() - loadStartedAt,
            state: getState()
          });
          reject(new Error("AVPlay prepareAsync timed out"));
        }, 15000);

        pushDebugEvent("prepareAsync call", {
          state: getState()
        });
        webapis.avplay.prepareAsync(
          () => {
            clearTimeout(timeoutId);
            state.preparing = false;
            pushDebugEvent("prepareAsync success", {
              elapsedMs: Date.now() - loadStartedAt,
              state: getState()
            });
            resolve();
            play(); // Start playback immediately
          },
          (err) => {
            clearTimeout(timeoutId);
            state.preparing = false;
            setLastError("PrepareAsync Failed", {
              err,
              elapsedMs: Date.now() - loadStartedAt,
              state: getState()
            });
            reject(err);
          }
        );
      });
    } catch (e) {
      state.preparing = false;
      setLastError("AVPlay Load Exception", e);
    }
  });
};

export const play = () => {
  if (!isTizenBackend()) {
    if (!videoElement) return;
    pushDebugEvent("html5 play()", { currentUrl });
    const playPromise = videoElement.play();
    state.playingState = true;
    if (playPromise?.catch) {
      playPromise.catch((error) => {
        state.playingState = false;
        setLastError("HTML5 play exception", error);
      });
    }
    return;
  }

  if (window.webapis && webapis.avplay) {
    try {
      pushDebugEvent("play()", { stateBefore: getState() });
      webapis.avplay.play();
      state.playingState = true;
      pushDebugEvent("play() complete", { stateAfter: getState() });
    } catch (e) {
      setLastError("AVPlay Play Exception", e);
    }
  }
};

export const pause = () => {
  if (!isTizenBackend()) {
    if (!videoElement) return;
    videoElement.pause();
    state.playingState = false;
    updateHtml5DebugOverlay();
    pushDebugEvent("html5 pause()");
    return;
  }

  if (window.webapis && webapis.avplay) {
    try {
      pushDebugEvent("pause()", { stateBefore: getState() });
      webapis.avplay.pause();
      state.playingState = false;
      pushDebugEvent("pause() complete", { stateAfter: getState() });
    } catch (e) {
      setLastError("AVPlay Pause Exception", e);
    }
  }
};

export const destroy = async () => {
  if (!isTizenBackend()) {
    if (videoElement) {
      videoElement.pause();
      videoElement.removeAttribute("src");
      videoElement.onloadstart = null;
      videoElement.onloadedmetadata = null;
      videoElement.oncanplay = null;
      videoElement.onwaiting = null;
      videoElement.onplaying = null;
      videoElement.onpause = null;
      videoElement.onended = null;
      videoElement.onstalled = null;
      videoElement.onerror = null;
      videoElement.load();
      videoElement.style.display = "none";
    }
    resetPlaybackState();
    updateHtml5DebugOverlay();
    pushDebugEvent("html5 destroy()");
    return;
  }

  if (window.webapis && webapis.avplay) {
    try {
      const currentState = getState();
      pushDebugEvent("destroy()", { currentState });
      if (isActiveState(currentState)) {
        webapis.avplay.stop();
        pushDebugEvent("stop during destroy", { currentState });
      }
      webapis.avplay.close();
      pushDebugEvent("close during destroy");
    } catch (e) {
      setLastError("AVPlay Destroy Exception", e);
    }
  }
  resetPlaybackState();
};

export const getState = () => {
  if (!isTizenBackend()) {
    if (!videoElement || !currentUrl) return null;
    if (state.waitingForGesture) return STATES.READY;
    if (state.preparing) return "IDLE";
    if (videoElement.ended) return "IDLE";
    if (videoElement.paused) {
      return videoElement.currentTime > 0 ? STATES.PAUSED : STATES.READY;
    }
    return STATES.PLAYING;
  }

  if (!window.webapis || !webapis.avplay || !webapis.avplay.getState) {
    return null;
  }
  try {
    return webapis.avplay.getState();
  } catch (e) {
    console.error("AVPlay getState Exception:", e);
    return null;
  }
};

export const getBackend = () => backend;
export const getBuffering = () => state.buffering;
export const getCurrentUrl = () => currentUrl;
export const getPreparing = () => state.preparing;
export const getLastError = () => lastError;
export const getDebugEvents = () => debugEvents.slice();
export const getBufferingInfo = () => ({
  isBuffering: state.buffering,
  lastBufferDurationMs,
  lastBufferStartMs
});

const isTimeQueryableState = (s) =>
  s === STATES.PLAYING || s === STATES.PAUSED || s === STATES.READY;

export const getCurrentTime = () => {
  if (!isTizenBackend()) {
    return videoElement?.currentTime || 0;
  }
  if (!window.webapis || !webapis.avplay) return 0;
  const s = getState();
  if (!isTimeQueryableState(s)) return 0;
  try {
    return webapis.avplay.getCurrentTime() / 1000;
  } catch (e) {
    console.error("AVPlay getCurrentTime Exception:", e);
    return 0;
  }
};

export const getVideoDuration = () => {
  if (!isTizenBackend()) {
    return Number.isFinite(videoElement?.duration) ? videoElement.duration : 0;
  }
  if (!window.webapis || !webapis.avplay) return 0;
  const s = getState();
  if (!isTimeQueryableState(s)) return 0;
  try {
    return webapis.avplay.getDuration() / 1000;
  } catch (e) {
    console.error("AVPlay getDuration Exception:", e);
    return 0;
  }
};

export const seekTo = (seconds) => {
  if (!isTizenBackend()) {
    if (!videoElement) return;
    const duration = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
    videoElement.currentTime = Math.max(0, Math.min(seconds, duration || seconds));
    updateHtml5DebugOverlay();
    pushDebugEvent("html5 seekTo", { seconds: videoElement.currentTime });
    return;
  }
  if (!window.webapis || !webapis.avplay) return;
  const s = getState();
  if (!isTimeQueryableState(s)) return;
  try {
    const durationMs = webapis.avplay.getDuration();
    const targetMs = Math.max(0, Math.min(seconds * 1000, durationMs || 0));
    webapis.avplay.seekTo(
      targetMs,
      () => {
        console.log("AVPlay seekTo:", targetMs);
      },
      (err) => {
        console.error("AVPlay seekTo failed:", err);
      }
    );
  } catch (e) {
    console.error("AVPlay seekTo Exception:", e);
  }
};

export const getTimeFormat = () => {
  const curr = getCurrentTime();
  const dur = getVideoDuration();
  const format = (s) =>
    new Date(s * 1000).toISOString().substr(11, 8).replace(/^00:/, "");
  return `${format(curr)} : ${format(dur)}`;
};

export default {
  init,
  load,
  play,
  pause,
  getCurrentTime,
  getVideoDuration,
  seekTo,
  getTimeFormat,
  getState,
  getBuffering,
  getPreparing,
  getBackend,
  getLastError,
  getDebugEvents,
  state,
  destroy
};
