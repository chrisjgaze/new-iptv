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

export const state = {
  playingState: false,
  buffering: false,
  preparing: false
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

const resetPlaybackState = () => {
  currentUrl = null;
  lastBufferStartMs = null;
  lastBufferDurationMs = 0;
  lastError = null;
  state.playingState = false;
  state.buffering = false;
  state.preparing = false;
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
  // We use the ID to let AVPlay know where to "punch the hole"
  const existingElement = document.getElementById("av-player");
  videoElement = element || existingElement;
  pushDebugEvent("init", {
    hasElement: !!element,
    reusedExisting: !!existingElement && !element
  });

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

  pushDebugEvent("init complete", {
    hasVideoElement: !!videoElement
  });
};

export const load = async (config) => {
  return runExclusiveTransition("load", async () => {
    if (!window.webapis || !window.webapis.avplay) {
      setLastError("AVPlay API not found. Are you on a Tizen TV?");
      return;
    }

    const loadStartedAt = Date.now();
    state.preparing = true;

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
  getLastError,
  getDebugEvents,
  state,
  destroy
};
