# SwitchMaster

A Homey Pro app that links any **switch** to any **light**. It has **no devices and no Flow
cards** — everything is configured on the app's **settings page**.

## What it does

- **Press a switch → toggle the linked light.** Works for momentary buttons (`button`
  capability) and on/off wall switches (`onoff` capability, toggles on every state change).
- **Turn a dial → fade the linked light.** If the switch exposes a `dim` capability, turning it
  up fades the light by a configurable relative step (default **+8%**) and turning it down by
  another step (default **-8%**). Fading up from off turns the light on; fading to 0% turns it off.

## How it works

- Uses the local Homey Web API (`homey-api`, permission `homey:manager:api`) to enumerate devices
  and to listen/write capability values on devices owned by other apps.
- Links are stored in app settings (`links`) as
  `[{ switchId, lightId, fadeUp, fadeDown }]`.
- On boot and whenever the settings change, `app.js` rebuilds realtime capability listeners
  (`device.makeCapabilityInstance`) for every linked switch and drives the linked light via
  `device.setCapabilityValue`.

## Configure

Open **Settings** for the app:

1. Click **Add link**.
2. Pick a **Switch** and a **Light** from the dropdowns (labels show zone, name, and type:
   dial / button / switch).
3. For dial switches, set the **Fade up %** / **Fade down %** steps.
4. **Save**.

The dropdowns are populated live from your Homey, so this is also the easiest way to see which
switches and lights are available.

## Files

- `app.json` — manifest (settings view, `getDevices` Web API route, `homey:manager:api`).
- `app.js` — link engine: HomeyAPI, listeners, toggle + dial-step fade.
- `api.js` — `GET /devices` route used by the settings page.
- `settings/index.html` — the link configuration UI.

## Development

All tooling runs in Docker (never run `npm`/`node` directly on the host). The Homey CLI is run
locally:

```bash
# one-time: install deps + generate placeholder images (in Docker)
docker run --rm -v "$PWD":/app -w /app node:20 npm install
docker run --rm -v "$PWD":/app -w /app node:20 node tools/generate-placeholder-images.js

# run on your Homey Pro with live logs
homey app run

# structural validation
homey app validate --level publish
```
