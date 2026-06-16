# SwitchMaster

A Homey Pro app that links **IKEA BILRESA remotes** and **motion sensors** to **lights**. It has **no devices and no Flow
cards** — everything is configured on the app's **settings page**.

## What it does

### IKEA BILRESA Remote to Light Links
Switch links are **IKEA-specific** and work with two BILRESA remote types:
- **BILRESA Dual Button** (`homey:app:com.ikea.tradfri:matter_bilresa_dual_button`)
- **BILRESA Scroll Wheel** (`homey:app:com.ikea.tradfri:matter_bilresa_scroll_wheel`)

The app **auto-generates Homey Flows** for these remotes — no manual Flow configuration needed. Flows are managed via the Homey Flow API using a Personal Access Token (PAT) configured in settings.

**Dual Button modes:**
- **Dimmer:** Top button dims up, bottom dims down (one light)
- **On/Off:** Top turns on, bottom turns off (one light)
- **Split:** Top toggles light 1, bottom toggles light 2

**Scroll Wheel:**
- 3 light slots, each with scroll up/down (relative dim step) and press (toggle)
- Configurable fade step (default ±8%)

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

### Switch Links (IKEA BILRESA)
- Uses the local Homey Web API (`homey-api`, permission `homey:manager:api`) to enumerate devices.
- Switch links are stored in app settings (`links`) with mode, light IDs, and fade step configuration.
- On boot and whenever settings change, the app **auto-generates Homey Flows** for each linked IKEA remote.
- Flows are created/updated/deleted via the Homey Flow API using a **Personal Access Token (PAT)** configured in settings.
- Generated Flows are stored in a `__SwitchMaster` folder for easy identification.
- App tokens lack Flow management scope, so a PAT is required for Flow operations.

### Motion Sensor Links
- Uses `device.makeCapabilityInstance` to listen for `alarm_motion` capability changes.
- Motion sensor links are stored in app settings (`sensorLinks`) with mode, timeout, and brightness settings.
- On motion detected, the linked light turns on with computed brightness (full for normal mode, interpolated for night mode).
- After the configured timeout, the light turns off automatically.
- For night mode, uses `suncalc` with Homey's latitude/longitude and timezone to compute sunset/sunrise
  times and interpolate brightness between sunset and midnight.

## Configure

Open **Settings** for the app:

### Personal Access Token (Required for Switch Links)
1. Generate a **Personal Access Token (PAT)** in Homey (Profile → Personal Access Tokens → Create).
2. Give it full owner scopes (required for Flow management).
3. Paste the token into the **Personal Access Token** field in SwitchMaster settings.
4. **Save**.

Without a PAT, switch links will not work (the app cannot generate/manage Flows with app tokens alone).

### Switch Links (IKEA BILRESA Only)
1. Click **Add link**.
2. Pick an **IKEA BILRESA remote** from the dropdown (only BILRESA devices are shown).
3. Choose the **Mode** (for Dual Button):
   - **Dimmer:** Top dims up, bottom dims down
   - **On/Off:** Top on, bottom off
   - **Split:** Top toggles light 1, bottom toggles light 2
4. For Scroll Wheel, configure up to **3 light slots** with scroll up/down and press actions.
5. Set the **Fade step %** (default 8%) for relative dimming.
6. **Save**.

The app will automatically generate the required Flows in the `__SwitchMaster` folder.

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
remotes, sensors, and lights are available.

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
