type RemoteEventType = "keydown" | "keyup";

type RemoteKeySpec = {
  key: string;
  code: string;
  keyCode: number;
  autoRelease?: boolean;
};

const REMOTE_KEY_MAP: Record<string, RemoteKeySpec> = {
  UP: { key: "ArrowUp", code: "ArrowUp", keyCode: 38 },
  DOWN: { key: "ArrowDown", code: "ArrowDown", keyCode: 40 },
  LEFT: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37 },
  RIGHT: { key: "ArrowRight", code: "ArrowRight", keyCode: 39 },
  ENTER: { key: "Enter", code: "Enter", keyCode: 13, autoRelease: true },
  OK: { key: "Enter", code: "Enter", keyCode: 13, autoRelease: true },
  SELECT: { key: "Enter", code: "Enter", keyCode: 13, autoRelease: true },
  BACK: { key: "XF86Back", code: "BrowserBack", keyCode: 10009, autoRelease: true },
  RETURN: { key: "XF86Back", code: "BrowserBack", keyCode: 10009, autoRelease: true },
  BACKSPACE: { key: "Backspace", code: "Backspace", keyCode: 8, autoRelease: true },
  ESCAPE: { key: "Escape", code: "Escape", keyCode: 27, autoRelease: true },
  MENU: { key: "m", code: "KeyM", keyCode: 77, autoRelease: true },
  ANNOUNCER: { key: "a", code: "KeyA", keyCode: 65, autoRelease: true },
  PLAYPAUSE: { key: "Enter", code: "Enter", keyCode: 13, autoRelease: true },
  PLAY: { key: "Enter", code: "Enter", keyCode: 13, autoRelease: true },
  PAUSE: { key: "Enter", code: "Enter", keyCode: 13, autoRelease: true },
  DIGIT0: { key: "0", code: "Digit0", keyCode: 48, autoRelease: true },
  DIGIT1: { key: "1", code: "Digit1", keyCode: 49, autoRelease: true },
  DIGIT2: { key: "2", code: "Digit2", keyCode: 50, autoRelease: true },
  DIGIT3: { key: "3", code: "Digit3", keyCode: 51, autoRelease: true },
  DIGIT4: { key: "4", code: "Digit4", keyCode: 52, autoRelease: true },
  DIGIT5: { key: "5", code: "Digit5", keyCode: 53, autoRelease: true },
  DIGIT6: { key: "6", code: "Digit6", keyCode: 54, autoRelease: true },
  DIGIT7: { key: "7", code: "Digit7", keyCode: 55, autoRelease: true },
  DIGIT8: { key: "8", code: "Digit8", keyCode: 56, autoRelease: true },
  DIGIT9: { key: "9", code: "Digit9", keyCode: 57, autoRelease: true },
  REFRESH: { key: "F5", code: "F5", keyCode: 116, autoRelease: true },
  BLUE: { key: "F5", code: "F5", keyCode: 116, autoRelease: true }
};

const REMOTE_ALIASES: Record<string, string> = {
  SELECT: "ENTER",
  OK: "ENTER",
  CENTER: "ENTER",
  BACKSPACE: "BACK",
  RETURN: "BACK",
  EXIT: "BACK",
  ESC: "ESCAPE",
  BLUE: "REFRESH",
  "0": "DIGIT0",
  "1": "DIGIT1",
  "2": "DIGIT2",
  "3": "DIGIT3",
  "4": "DIGIT4",
  "5": "DIGIT5",
  "6": "DIGIT6",
  "7": "DIGIT7",
  "8": "DIGIT8",
  "9": "DIGIT9"
};

type ParsedRemoteMessage = {
  command: string;
  eventType: RemoteEventType;
};

function isTizenRuntime() {
  return Boolean((window as any).tizen?.tvinputdevice);
}

function getRemoteBridgeUrl() {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get("remoteBridge");
  if (enabled !== "1" && enabled !== "true") {
    return null;
  }

  const url = params.get("remoteBridgeUrl");
  return url || "ws://127.0.0.1:8765";
}

function normalizeCommand(value: string) {
  const normalized = value.trim().toUpperCase();
  return REMOTE_ALIASES[normalized] || normalized;
}

function parseStringMessage(raw: string): ParsedRemoteMessage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const [first, second] = trimmed.split(/[\s:|,]+/, 2);
  const possibleType = second?.toUpperCase();
  const eventType =
    possibleType === "UP" || possibleType === "KEYUP" || possibleType === "RELEASE"
      ? "keyup"
      : "keydown";

  return {
    command: normalizeCommand(first),
    eventType
  };
}

function parseRemoteMessage(raw: string): ParsedRemoteMessage | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (!trimmed.startsWith("{")) {
    return parseStringMessage(trimmed);
  }

  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    const commandValue = payload.command ?? payload.key ?? payload.button ?? payload.action;
    if (typeof commandValue !== "string") return null;

    const stateValue = payload.eventType ?? payload.type ?? payload.state;
    const normalizedState =
      typeof stateValue === "string" ? stateValue.trim().toUpperCase() : "";
    const eventType =
      normalizedState === "UP" ||
      normalizedState === "KEYUP" ||
      normalizedState === "RELEASE"
        ? "keyup"
        : "keydown";

    return {
      command: normalizeCommand(commandValue),
      eventType
    };
  } catch (error) {
    console.warn("Failed to parse remote bridge payload:", trimmed, error);
    return null;
  }
}

function createKeyboardEvent(spec: RemoteKeySpec, eventType: RemoteEventType) {
  const event = new KeyboardEvent(eventType, {
    key: spec.key,
    code: spec.code,
    bubbles: true,
    cancelable: true
  });

  for (const property of ["keyCode", "which", "charCode"] as const) {
    Object.defineProperty(event, property, {
      configurable: true,
      value: spec.keyCode
    });
  }

  return event;
}

function dispatchToTarget(target: EventTarget, spec: RemoteKeySpec, eventType: RemoteEventType) {
  const event = createKeyboardEvent(spec, eventType);
  target.dispatchEvent(event);
}

function dispatchRemoteKey(command: string, eventType: RemoteEventType) {
  if (command === "REFRESH" && eventType === "keydown") {
    console.log("[remoteBridge] refresh requested");
    window.location.reload();
    return;
  }

  const spec = REMOTE_KEY_MAP[command];
  if (!spec) {
    console.warn(`Ignoring unmapped remote command: ${command}`);
    return;
  }

  console.log("[remoteBridge] dispatch", {
    command,
    eventType,
    key: spec.key,
    keyCode: spec.keyCode,
    activeElement: document.activeElement?.tagName || null
  });

  dispatchToTarget(document, spec, eventType);

  if (eventType === "keydown" && spec.autoRelease) {
    window.setTimeout(() => {
      console.log("[remoteBridge] auto-release", {
        command,
        key: spec.key,
        keyCode: spec.keyCode
      });
      dispatchToTarget(document, spec, "keyup");
    }, 0);
  }
}

export function startRemoteBridge() {
  if (isTizenRuntime()) return;

  const bridgeUrl = getRemoteBridgeUrl();
  if (!bridgeUrl) return;

  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let shuttingDown = false;

  const connect = () => {
    socket = new WebSocket(bridgeUrl);

    socket.addEventListener("open", () => {
      console.log(`Remote bridge connected: ${bridgeUrl}`);
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      console.log("[remoteBridge] inbound", event.data);
      const parsed = parseRemoteMessage(event.data);
      if (!parsed) return;
      dispatchRemoteKey(parsed.command, parsed.eventType);
    });

    socket.addEventListener("close", () => {
      if (shuttingDown) return;
      reconnectTimer = window.setTimeout(connect, 1000);
    });

    socket.addEventListener("error", (error) => {
      console.warn("Remote bridge socket error:", error);
      socket?.close();
    });
  };

  window.addEventListener("beforeunload", () => {
    shuttingDown = true;
    if (reconnectTimer) {
      window.clearTimeout(reconnectTimer);
    }
    socket?.close();
  });

  connect();
}
