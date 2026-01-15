/**
 * video.js - Tizen Native AVPlay version
 */
let videoElement = null;

export const state = {
  playingState: false
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
    // 1. Open the URL
    webapis.avplay.open(config.streamUrl);

    // 2. Set listeners
    const listener = {
      onbufferingstart: () => console.log("Buffering..."),
      onbufferingcomplete: () => console.log("Buffering complete"),
      onstreamcompleted: () => destroy(),
      onerror: (type, data) => console.error("AVPlay Error:", type, data)
    };
    webapis.avplay.setListener(listener);

    // 3. Set Display Area (Full Screen)
    webapis.avplay.setDisplayRect(0, 0, window.innerWidth, window.innerHeight);

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
    webapis.avplay.play();
    state.playingState = true;
  }
};

export const pause = () => {
  if (window.webapis && webapis.avplay) {
    webapis.avplay.pause();
    state.playingState = false;
  }
};

export const destroy = async () => {
  if (window.webapis && webapis.avplay) {
    webapis.avplay.stop();
    webapis.avplay.close();
  }
  state.playingState = false;
};

export const getCurrentTime = () => {
  return window.webapis ? webapis.avplay.getCurrentTime() / 1000 : 0;
};

export const getVideoDuration = () => {
  return window.webapis ? webapis.avplay.getDuration() / 1000 : 0;
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
  state,
  destroy
};
