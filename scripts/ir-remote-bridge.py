#!/usr/bin/env python3
import argparse
import asyncio
import base64
import hashlib
import os
import signal
from pathlib import Path

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765
DEFAULT_MODE = "mqtt"
DEFAULT_MQTT_HOST = "127.0.0.1"
DEFAULT_MQTT_PORT = 1883
DEFAULT_MQTT_TOPIC = "ir/remote/button"
DEFAULT_SOURCE = "/opt/ir2mqtt/ir2mqtt.py"
DEFAULT_PYTHON = "/home/chris/homeassistant/.venv/bin/python"

KEY_MAP = {
    "KEY_UP": "UP",
    "KEY_DOWN": "DOWN",
    "KEY_LEFT": "LEFT",
    "KEY_RIGHT": "RIGHT",
    "KEY_ENTER": "ENTER",
    "KEY_OK": "ENTER",
    "KEY_SELECT": "ENTER",
    "KEY_KPENTER": "ENTER",
    "KEY_BACK": "BACK",
    "KEY_BACKSPACE": "BACK",
    "KEY_ESC": "ESCAPE",
    "KEY_ESCAPE": "ESCAPE",
    "KEY_MENU": "MENU",
    "KEY_HOME": "MENU",
    "KEY_PLAYPAUSE": "PLAYPAUSE",
    "KEY_PLAY": "PLAY",
    "KEY_PAUSE": "PAUSE",
    "KEY_0": "0",
    "KEY_1": "1",
    "KEY_2": "2",
    "KEY_3": "3",
    "KEY_4": "4",
    "KEY_5": "5",
    "KEY_6": "6",
    "KEY_7": "7",
    "KEY_8": "8",
    "KEY_9": "9",
    "KEY_NUMERIC_0": "0",
    "KEY_NUMERIC_1": "1",
    "KEY_NUMERIC_2": "2",
    "KEY_NUMERIC_3": "3",
    "KEY_NUMERIC_4": "4",
    "KEY_NUMERIC_5": "5",
    "KEY_NUMERIC_6": "6",
    "KEY_NUMERIC_7": "7",
    "KEY_NUMERIC_8": "8",
    "KEY_NUMERIC_9": "9",
    "KEY_RED": "MENU",
}


def encode_ws_frame(payload: str) -> bytes:
    data = payload.encode("utf-8")
    frame = bytearray([0x81])
    length = len(data)
    if length < 126:
        frame.append(length)
    elif length < 65536:
        frame.append(126)
        frame.extend(length.to_bytes(2, "big"))
    else:
        frame.append(127)
        frame.extend(length.to_bytes(8, "big"))
    frame.extend(data)
    return bytes(frame)


class WebSocketHub:
    def __init__(self):
        self.clients: set[asyncio.StreamWriter] = set()

    async def handler(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            request = await reader.readuntil(b"\r\n\r\n")
        except Exception:
            writer.close()
            await writer.wait_closed()
            return

        headers = self._parse_headers(request.decode("utf-8", errors="ignore"))
        key = headers.get("sec-websocket-key")
        if not key:
            writer.close()
            await writer.wait_closed()
            return

        accept = base64.b64encode(
            hashlib.sha1((key + GUID).encode("utf-8")).digest()
        ).decode("ascii")
        response = (
            "HTTP/1.1 101 Switching Protocols\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Accept: {accept}\r\n"
            "\r\n"
        )
        writer.write(response.encode("utf-8"))
        await writer.drain()
        self.clients.add(writer)
        peer = writer.get_extra_info("peername")
        print(f"[bridge] websocket client connected: {peer}", flush=True)

        try:
            while not reader.at_eof():
                chunk = await reader.read(1024)
                if not chunk:
                    break
        except Exception:
            pass
        finally:
            self.clients.discard(writer)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            print(f"[bridge] websocket client disconnected: {peer}", flush=True)

    async def broadcast(self, payload: str):
        if not self.clients:
            return
        frame = encode_ws_frame(payload)
        stale = []
        for writer in list(self.clients):
            try:
                writer.write(frame)
                await writer.drain()
            except Exception:
                stale.append(writer)
        for writer in stale:
            self.clients.discard(writer)
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    @staticmethod
    def _parse_headers(request: str):
        headers = {}
        for line in request.split("\r\n")[1:]:
            if not line or ":" not in line:
                continue
            key, value = line.split(":", 1)
            headers[key.strip().lower()] = value.strip()
        return headers


def build_source_command(path: Path, python_path: str):
    if path.suffix == ".py":
        return [python_path, "-u", str(path)]
    return [str(path)]


def build_input_command(args):
    if args.mode == "mqtt":
        return [
            "mosquitto_sub",
            "-h",
            args.mqtt_host,
            "-p",
            str(args.mqtt_port),
            "-t",
            args.mqtt_topic,
        ]

    source = Path(args.source)
    if not source.exists():
        raise FileNotFoundError(f"Source script not found: {source}")
    if source.suffix != ".py" and not os.access(source, os.X_OK):
        raise PermissionError(f"Source script is not executable: {source}")
    return build_source_command(source, args.python)


def normalize_input_line(line: str):
    if not line:
        return None

    if line.startswith("[ir2mqtt] "):
        payload = line[len("[ir2mqtt] "):].strip()
        if (
            not payload
            or payload.startswith("starting ")
            or payload.startswith("mqtt connected")
            or payload.startswith("raw]")
            or payload.startswith("unmapped ")
            or payload.startswith("shutting down")
        ):
            return None
        return payload

    return line.strip()


def map_command(raw_value: str):
    return KEY_MAP.get(raw_value)


async def read_input(args, hub: WebSocketHub):
    command = build_input_command(args)
    process = await asyncio.create_subprocess_exec(
        *command,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    print(f"[bridge] started input: {' '.join(command)}", flush=True)

    assert process.stdout is not None
    try:
        while True:
            raw_line = await process.stdout.readline()
            if not raw_line:
                break
            line = raw_line.decode("utf-8", errors="ignore").strip()
            if not line:
                continue
            print(line, flush=True)
            normalized = normalize_input_line(line)
            if not normalized:
                continue
            mapped = map_command(normalized)
            if not mapped:
                continue
            await hub.broadcast(mapped)
            print(f"[bridge] -> {mapped}", flush=True)
    finally:
        if process.returncode is None:
            process.terminate()
            try:
                await asyncio.wait_for(process.wait(), timeout=3)
            except asyncio.TimeoutError:
                process.kill()
                await process.wait()


async def main_async(args):
    hub = WebSocketHub()
    server = await asyncio.start_server(hub.handler, host=args.host, port=args.port)
    addresses = ", ".join(str(sock.getsockname()) for sock in server.sockets or [])
    print(f"[bridge] websocket listening on {addresses}", flush=True)

    stop_event = asyncio.Event()

    def request_stop():
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig_name in ("SIGINT", "SIGTERM"):
        sig = getattr(signal, sig_name, None)
        if sig is not None:
            try:
                loop.add_signal_handler(sig, request_stop)
            except NotImplementedError:
                pass

    input_task = asyncio.create_task(read_input(args, hub))
    stop_task = asyncio.create_task(stop_event.wait())

    done, pending = await asyncio.wait(
        {input_task, stop_task},
        return_when=asyncio.FIRST_COMPLETED,
    )

    for task in pending:
        task.cancel()

    server.close()
    await server.wait_closed()

    if input_task in done:
        await input_task


def parse_args():
    parser = argparse.ArgumentParser(
        description="Bridge IR events into a local WebSocket for Chrome"
    )
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    parser.add_argument("--mode", choices=["mqtt", "source"], default=DEFAULT_MODE)
    parser.add_argument("--mqtt-host", default=DEFAULT_MQTT_HOST)
    parser.add_argument("--mqtt-port", default=DEFAULT_MQTT_PORT, type=int)
    parser.add_argument("--mqtt-topic", default=DEFAULT_MQTT_TOPIC)
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--python", default=DEFAULT_PYTHON)
    return parser.parse_args()


def main():
    args = parse_args()
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
