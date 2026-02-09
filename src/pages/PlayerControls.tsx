import { createEffect, createSignal, onCleanup } from "solid-js";
import AVPlayer from "../video.js"; // Ensure path is correct

const PlayerControls = () => {
  const [currentTime, setCurrentTime] = createSignal("00:00");
  const [duration, setDuration] = createSignal("00:00");
  const [isPaused, setIsPaused] = createSignal(false);
  const [isReady, setIsReady] = createSignal(false);

  const READY_STATES = new Set(["READY", "PLAYING", "PAUSED"]);

  // Poll AVPlay state until it's ready; also track pause state
  const stateTimer = setInterval(() => {
    const state = AVPlayer.getState?.() || null;
    setIsReady(state ? READY_STATES.has(state) : false);
    setIsPaused(state === "PAUSED");
  }, 500);

  let timeTimer = null;
  createEffect(() => {
    if (!isReady()) {
      if (timeTimer) {
        clearInterval(timeTimer);
        timeTimer = null;
      }
      setCurrentTime("00:00");
      setDuration("00:00");
      return;
    }
    if (!timeTimer) {
      // Update time every second once AVPlay is ready
      timeTimer = setInterval(() => {
        const timeInfo = AVPlayer.getTimeFormat().split(" : ");
        setCurrentTime(timeInfo[0]);
        setDuration(timeInfo[1]);
      }, 1000);
    }
  });

  onCleanup(() => {
    clearInterval(stateTimer);
    if (timeTimer) clearInterval(timeTimer);
  });

  return (
    <div
      style={{
        position: "absolute",
        bottom: "50px",
        left: "0",
        width: "100%",
        display: "flex",
        "flex-direction": "column",
        "align-items": "center",
        background: "rgba(0,0,0,0.6)",
        padding: "20px"
      }}
    >
      <style>{`
        @keyframes av-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      {!isReady() && (
        <div
          style={{
            width: "36px",
            height: "36px",
            border: "4px solid rgba(255,255,255,0.3)",
            "border-top": "4px solid white",
            "border-radius": "50%",
            animation: "av-spin 0.9s linear infinite",
            "margin-bottom": "10px"
          }}
          aria-label="Loading"
        />
      )}
      <div style={{ color: "white", "font-size": "24px" }}>
        {currentTime()} / {duration()}
      </div>
      <div style={{ color: "white", "margin-top": "10px" }}>
        {!isReady() ? "LOADING" : isPaused() ? "PAUSED" : "PLAYING"}
      </div>
    </div>
  );
};

export default PlayerControls;
