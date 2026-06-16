# SwitchMaster

A Homey Pro app that links **switches** and **motion sensors** to **lights**. It has **no devices and no Flow
cards** — everything is configured on the app's **settings page**.

## What it does

### Switch to Light Links
- **Press a switch → toggle the linked light.** Works for momentary buttons (`button`
  capability) and on/off wall switches (`onoff` capability, toggles on every state change).
- **Turn a dial → fade the linked light.** If the switch exposes a `dim` capability, turning it
  up fades the light by a configurable relative step (default **+8%**) and turning it down by
  another step (default **-8%**). Fading up from off turns the light on; fading to 0% turns it off.

### Motion Sensor to Light Links
- **Motion detected → turn on linked light.** When a motion sensor's `alarm_motion` capability triggers,
  the linked light turns on.
- **Two modes:**
  - **Normal:** Full brightness, turns off after a configurable timeout (default 5 minutes).
  - **Night:** Dimmed brightness based on time of day, interpolates from sunset brightness to midnight
    brightness, then holds at midnight brightness until sunrise. Turns off after timeout.
- **Timezone-aware:** Uses Homey's configured timezone and latitude/longitude to compute accurate
  sunset/sunrise times for the night mode interpolation.

## How it works

- Uses the local Homey Web API (`homey-api`, permission `homey:manager:api`) to enumerate devices
  and to listen/write capability values on devices owned by other apps.
- Switch links are stored in app settings (`links`) as
  `[{ switchId, lightId, fadeUp, fadeDown }]`.
- Motion sensor links are stored in app settings (`sensorLinks`) as
  `[{ sensorId, lightId, mode, timeout, sunsetBright, midnightBright }]`.
- On boot and whenever the settings change, `app.js` rebuilds realtime capability listeners
  (`device.makeCapabilityInstance`) for every linked switch and sensor, and drives linked lights via
  `device.setCapabilityValue`.
- For night mode, uses `suncalc` with Homey's latitude/longitude and timezone to compute sunset/sunrise
  times and interpolate brightness between sunset and midnight.

## Configure

Open **Settings** for the app:

### Switch Links
1. Click **Add link**.
2. Pick a **Switch** and a **Light** from the dropdowns (labels show zone, name, and type:
   dial / button / switch).
3. For dial switches, set the **Fade up %** / **Fade down %** steps.
4. **Save**.

### Motion Sensor Links
1. Click **Add sensor**.
2. Pick a **Motion Sensor** and a **Light** from the dropdowns.
3. Choose the **Mode**:
   - **Normal:** Full brightness, turns off after timeout.
   - **Night:** Dimmed brightness based on time of day.
4. For night mode, set:
   - **Timeout:** How long (in minutes) the light stays on after motion stops.
   - **Sunset brightness %:** Brightness at sunset (e.g., 50%).
   - **Midnight brightness %:** Brightness at midnight (e.g., 5%).
5. **Save**.

The dropdowns are populated live from your Homey, so this is also the easiest way to see which
switches, sensors, and lights are available.

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
