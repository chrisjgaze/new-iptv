/**
 * video.js - Tizen Native AVPlay version
 */
let videoElement = null;
let currentUrl = null;
let lastBufferStartMs = null;
let lastBufferDurationMs = 0;

export const state = {
  playingState: false,
  buffering: false
};

// Map AVPlay states to your app state
const STATES = {
  IDLE: "NONE",
  PLAYING: "PLAYING",
  PAUSED: "PAUSED",
  READY: "READY"
};

export const init = async (element) => {
  // We use the ID to let AVPlay know where to "punch the hole"
  videoElement = element;
  if (!videoElement) {
    videoElement = document.createElement("div");
    videoElement.id = "av-player";
    videoElement.style.cssText =
      "position: absolute; top: 0; left: 0; z-index: -1;";
    document.body.insertBefore(videoElement, document.body.firstChild);
  }
  return Promise.resolve();
};

export const load = async (config) => {
  if (!window.webapis || !window.webapis.avplay) {
    console.error("AVPlay API not found. Are you on a Tizen TV?");
    return;
  }

  try {
    try {
      const currentState = getState();
      if (currentState && currentState !== STATES.IDLE) {
        webapis.avplay.stop();
        webapis.avplay.close();
      }
    } catch (e) {
      console.error("AVPlay Pre-Open Cleanup Exception:", e);
    }

    // 1. Open the URL
    const url = config.streamUrl;
    currentUrl = url;
    console.log("AVPlay open URL:", url);
    //webapis.avplay.open(
    //"http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
    //);
    webapis.avplay.open(url);
    //http://vpn.tsclean.cc/movie/6c82e7398a/a2bfaf950817/1998017.mp4
    // 2. Set listeners
    const listener = {
      onbufferingstart: () => {
        state.buffering = true;
        lastBufferStartMs = Date.now();
        console.log("Buffering...");
      },
      onbufferingcomplete: () => {
        state.buffering = false;
        if (lastBufferStartMs) {
          lastBufferDurationMs = Date.now() - lastBufferStartMs;
          lastBufferStartMs = null;
        }
        console.log("Buffering complete");
      },
      onstreamcompleted: () => {
        state.buffering = false;
        destroy();
      },
      onerror: (type, data) => {
        state.buffering = false;
        console.error("AVPlay Error:", type, data);
      }
    };
    webapis.avplay.setListener(listener);

    try {
      webapis.avplay.setDisplayMethod("PLAYER_DISPLAY_MODE_FULL_SCREEN");
    } catch (e) {
      console.warn("AVPlay setDisplayMethod failed:", e);
    }

    // 3. Set Display Area (Full Screen)
    const width = window.innerWidth || 1920;
    const height = window.innerHeight || 1080;
    webapis.avplay.setDisplayRect(0, 0, width, height);

    // 4. Prepare (This is async on Tizen)
    return new Promise((resolve, reject) => {
      webapis.avplay.prepareAsync(
        () => {
          console.log("AVPlay Prepared");
          resolve();
          play(); // Start playback immediately
        },
        (err) => {
          console.error("PrepareAsync Failed", err);
          reject(err);
        }
      );
    });
  } catch (e) {
    console.error("AVPlay Load Exception:", e);
  }
};

export const play = () => {
  if (window.webapis && webapis.avplay) {
    try {
      webapis.avplay.play();
      state.playingState = true;
    } catch (e) {
      console.error("AVPlay Play Exception:", e);
    }
  }
};

export const pause = () => {
  if (window.webapis && webapis.avplay) {
    try {
      webapis.avplay.pause();
      state.playingState = false;
    } catch (e) {
      console.error("AVPlay Pause Exception:", e);
    }
  }
};

export const destroy = async () => {
  if (window.webapis && webapis.avplay) {
    try {
      const currentState = getState();
      if (currentState && currentState !== STATES.IDLE) {
        webapis.avplay.stop();
      }
      webapis.avplay.close();
    } catch (e) {
      console.error("AVPlay Destroy Exception:", e);
    }
  }
  state.playingState = false;
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
  getTimeFormat,
  getState,
  getBuffering,
  state,
  destroy
};
