# SwitchMaster

**Turn your IKEA remotes and motion sensors into smart light controls — without building a single Flow by hand.**

SwitchMaster lets you point an IKEA BILRESA remote (or a motion sensor) at a light and pick how it
should behave. That's it. The app quietly builds and maintains the Homey Flows behind the scenes, so
you never have to wire up trigger-and-action cards yourself.

---

## Why this app exists

Setting up a single remote button or motion sensor in Homey normally means creating a Flow for
*every* action: one for "top button pressed → dim up," another for "bottom button pressed → dim
down," and so on. A single scroll-wheel remote can need **nine** Flows. Do that for a few rooms and
you're maintaining dozens of near-identical Flows by hand — and re-editing all of them whenever you
swap a bulb or change your mind.

SwitchMaster replaces that busywork with a simple list. You say *"this remote controls that light,
in dimmer mode"* on one screen, and the app generates the correct Flows for you, keeps them in sync
when you change the settings, and tidies them away in their own folder. Change your mind later? Edit
one row and save — the Flows update themselves.

The same idea applies to motion sensors: pick a sensor, pick a light, choose how bright and for how
long. SwitchMaster handles the rest, including a **night mode** that automatically dims the light as
the evening gets later so a midnight bathroom trip doesn't blind you.

---

## What you can do

### 💡 IKEA remotes → lights

Works with two IKEA BILRESA remote types:

- **BILRESA Dual Button** (the two-button remote)
- **BILRESA Scroll Wheel** (the dial remote)

**Dual Button — three modes:**

| Mode | Top button | Bottom button |
|------|-----------|---------------|
| **Dimmer** | Dims the light up | Dims the light down |
| **On / Off** | Turns the light on | Turns the light off |
| **Two toggles** | Toggles light A | Toggles light B |

**Scroll Wheel:**

The dial has **three slots**, and each slot can control a different light. For every slot you assign:
scroll up to brighten, scroll down to dim, and press to toggle on/off. You choose how big each dim
step is (default ±8%).

### 🚶 Motion sensors → lights

Pick a motion sensor and a light, and the light comes on when motion is detected, then turns itself
off after a timeout you set.

- **Normal mode** — light comes on at full brightness, turns off after the timeout (default 5 minutes).
- **Night mode** — light comes on dimmed, and *how* dimmed depends on the time of night. It starts at
  your chosen **sunset brightness** and smoothly fades down to your **midnight brightness** as the
  evening progresses, holding there until sunrise. SwitchMaster uses your Homey's location and
  timezone to calculate sunset and sunrise accurately, so it adapts across the seasons on its own.

---

## Getting started

Everything is configured on the app's **Settings** page — SwitchMaster adds no devices of its own.

### 1. Add a Personal Access Token (required for remotes)

To create and manage Flows for you, SwitchMaster needs a Personal Access Token (PAT). This is a
one-time setup:

1. Go to **[my.homey.app](https://my.homey.app) → Settings → API Keys** and create a new key with
   **Flow** access (full owner scope is simplest).
2. Copy the token.
3. Paste it into the **Personal Access Token** field at the top of SwitchMaster's settings and
   **Save**.

> **Why is this needed?** Homey only allows Flows to be managed with a personal token, not with the
> token an app gets by default. The PAT is stored locally on your Homey and never leaves it.
>
> Motion-sensor links work *without* a PAT — it's only required for the IKEA remote links, since
> those are the ones powered by auto-generated Flows.

### 2. Link a remote

1. Click **Add remote**.
2. Choose your IKEA BILRESA remote (only supported remotes appear in the list).
3. Pick the mode and the light(s) it should control. For a scroll wheel, assign lights to up to three
   slots.
4. Set the dim step if you like, then **Save**.

SwitchMaster generates the matching Flows and files them in a folder called **`__SwitchMaster`**.
You can look in there to see exactly what it created — but you never need to touch them.

### 3. Link a motion sensor

1. Click **Add sensor**.
2. Choose a motion sensor and the light it should control.
3. Pick **Normal** or **Night** mode, set the timeout (and, for night mode, the sunset and midnight
   brightness), then **Save**.

The dropdowns are populated live from your Homey, so the settings page doubles as an easy way to see
which remotes, sensors, and lights you have available.

---

## Good to know

- **Editing is safe.** Change a row and save, and SwitchMaster updates the corresponding Flows.
  Remove a row and save, and it cleans up the Flows it created. It only ever manages Flows in its own
  `__SwitchMaster` folder, so your hand-made Flows are never touched.
- **It works locally.** SwitchMaster runs entirely on your Homey Pro using the local API.
- **One light, two controllers.** It's fine to have, say, a motion sensor *and* a remote both pointed
  at the same light — the motion sensor switches it directly, and the remote does so through a Flow.

---

## For developers

The app is small and has three meaningful files:

- `app.js` — the engine: reads the settings, generates/syncs Flows for remotes, and binds motion
  sensor listeners.
- `api.js` — a single `GET /devices` route that feeds the settings page its dropdown data.
- `settings/index.html` — the configuration UI.

Run it on your own Homey Pro with live logs:

```bash
npm install          # install dependencies
homey app run        # build, install, and stream logs from your Homey
homey app validate   # structural validation
```
