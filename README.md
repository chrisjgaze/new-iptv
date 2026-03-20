# Lightning Demo App with SolidJS

View the demo - [https://lightning-tv.github.io/solid-demo-app/](https://lightning-tv.github.io/solid-demo-app/)

There are a few query params for customizing the application to test on devices

size='720' | '1080' | '4k'
numImageWorkers = 0 to disable image workers
disableBG=true to turn off background (reduce memory)
roundPoster=false to turn off rounded images on poster

https://lightning-tv.github.io/solid-demo-app/?size=720&disableBG=true#/

## Main Repo

Solid
[https://github.com/lightning-tv/solid](https://github.com/lightning-tv/solid)

## Getting started

Get an api key from [TMDB API](https://developers.themoviedb.org/3/getting-started/introduction)
and put the key in `src/api/key.js` with `export default 'KEY_VALUE'`

```
git clone git@github.com:chrisjgaze/new-iptv.git
cd solid-demo-app
pnpm i
pnpm start
```

If you're interested in using SolidJS with Lightning and Web check out [Web Branch](https://github.com/lightning-tv/solid-demo-app/tree/web) to see the setup.

## Chrome Remote Bridge

When running in Chrome, the app can accept remote commands from a local WebSocket bridge and convert them into the same keyboard events used by the existing Tizen control path.

Enable it with:

```text
http://localhost:5173/?remoteBridge=1&remoteBridgeUrl=ws://127.0.0.1:8765#/
```

Behavior:

- The bridge is disabled automatically on Tizen.
- Without `remoteBridge=1`, Chrome behaves exactly as before.
- Incoming commands are translated into `keydown` or `keyup` events and flow through the existing key map in `src/pages/App.tsx`.
- Start the local bridge with `python3 scripts/ir-remote-bridge.py` or `npm run remote:bridge`.
- The bridge spawns `/opt/ir2mqtt/ir2mqtt.py`, listens for emitted `KEY_*` values, and serves WebSocket clients on `127.0.0.1:8765`.

Accepted WebSocket payloads:

```text
UP
ENTER
BACK
1
LEFT:UP
```

```json
{"command":"UP"}
{"command":"ENTER","eventType":"keydown"}
{"key":"BACK","state":"keyup"}
```

Supported commands include `UP`, `DOWN`, `LEFT`, `RIGHT`, `ENTER`, `OK`, `SELECT`, `BACK`, `RETURN`, `ESCAPE`, `MENU`, `ANNOUNCER`, and digits `0`-`9`.
