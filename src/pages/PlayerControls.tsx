import { createSignal, onCleanup } from "solid-js";
import AVPlayer from "../video.js"; // Ensure path is correct

const PlayerControls = () => {
  const [currentTime, setCurrentTime] = createSignal("00:00");
  const [duration, setDuration] = createSignal("00:00");
  const [isPaused, setIsPaused] = createSignal(false);

  // Update time every second
  const timer = setInterval(() => {
    const timeInfo = AVPlayer.getTimeFormat().split(" : ");
    setCurrentTime(timeInfo[0]);
    setDuration(timeInfo[1]);
  }, 1000);

  onCleanup(() => clearInterval(timer));

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
      <div style={{ color: "white", "font-size": "24px" }}>
        {currentTime()} / {duration()}
      </div>
      <div style={{ color: "white", "margin-top": "10px" }}>
        {isPaused() ? "PAUSED" : "PLAYING"}
      </div>
    </div>
  );
};

export default PlayerControls;
