'use strict';

const Homey = require('homey');
const { HomeyAPI } = require('homey-api');
const SunCalc = require('suncalc');

const LINKS_KEY = 'links';
const SENSOR_LINKS_KEY = 'sensorLinks';
const PAT_KEY = 'pat';
const DEFAULT_FADE_UP = 8;
const DEFAULT_FADE_DOWN = -8;
const DEFAULT_FADE_STEP = 8;
const DUAL_BUTTON_DRIVER_ID = 'homey:app:com.ikea.tradfri:matter_bilresa_dual_button';
const SCROLL_WHEEL_DRIVER_ID = 'homey:app:com.ikea.tradfri:matter_bilresa_scroll_wheel';

class SwitchMasterApp extends Homey.App {
  async onInit() {
    this.api = await HomeyAPI.createAppAPI({ homey: this.homey });

    this.sensorInstances = [];
    this.sensorTimers = new Map();

    // Serialize rebuilds so overlapping runs can't tear down sensors mid-bind
    // or race the Flow sync. The settings page fires three separate set() calls
    // per Save (pat -> links -> sensorLinks); debouncing coalesces them.
    this._rebuildChain = Promise.resolve();
    this._rebuildTimer = null;

    await this.rebuildLinks();

    this.homey.settings.on('set', (key) => {
      if (key === LINKS_KEY || key === SENSOR_LINKS_KEY || key === PAT_KEY) {
        this.scheduleRebuild();
      }
    });

    this.log('SwitchMaster initialized');
  }

  // Coalesce the burst of settings writes from one Save into a single rebuild,
  // and chain rebuilds so they never overlap.
  scheduleRebuild() {
    if (this._rebuildTimer) this.homey.clearTimeout(this._rebuildTimer);
    this._rebuildTimer = this.homey.setTimeout(() => {
      this._rebuildTimer = null;
      this._rebuildChain = this._rebuildChain
        .then(() => this.rebuildLinks())
        .catch((err) => this.error('rebuildLinks failed', err));
    }, 500);
  }

  // Returns a client that can manage Flows. App tokens lack the flow scope, so
  // we build a local client from a Personal Access Token the user pastes into
  // settings. Falls back to the (read-only-for-flows) app client if no PAT.
  async getFlowApi() {
    const pat = this.homey.settings.get(PAT_KEY);
    if (!pat) return null;

    if (this.flowApi && this.flowApiToken === pat) return this.flowApi;

    try {
      const localAddress = await this.homey.cloud.getLocalAddress();
      const host = String(localAddress).split(':')[0];
      const address = `http://${host}`;
      this.flowApi = await HomeyAPI.createLocalAPI({ address, token: pat });
      this.flowApiToken = pat;
      this.log(`Flow client ready via Personal Access Token (${address})`);
      return this.flowApi;
    } catch (err) {
      this.flowApi = null;
      this.flowApiToken = null;
      this.error('Failed to build Flow client from PAT:', err && err.message ? err.message : err);
      return null;
    }
  }

  // --- Settings API (called from settings/index.html via Homey.api) -------

  async getDeviceList() {
    const [devices, zones] = await Promise.all([
      this.api.devices.getDevices(),
      this.api.zones.getZones().catch(() => ({})),
    ]);

    const rows = Object.values(devices).map((device) => {
      const capabilities = device.capabilities || [];
      return {
        id: device.id,
        name: device.name,
        class: device.class || '',
        zone: (zones && zones[device.zone] && zones[device.zone].name) || '',
        capabilities,
        hasOnoff: capabilities.includes('onoff'),
        hasDim: capabilities.includes('dim'),
        hasAlarmMotion: capabilities.includes('alarm_motion'),
        driverId: device.driverId || '',
        ownerUri: device.ownerUri || '',
        type: this.getSwitchType(device),
      };
    });

    const sortByZoneName = (a, b) => `${a.zone}\u0000${a.name}`.localeCompare(`${b.zone}\u0000${b.name}`);

    return {
      switches: rows.filter((d) => d.type).sort(sortByZoneName),
      lights: rows.filter((d) => d.hasOnoff || d.hasDim).sort(sortByZoneName),
      sensors: rows.filter((d) => d.hasAlarmMotion).sort(sortByZoneName),
    };
  }

  // --- Link engine --------------------------------------------------------

  getLinks() {
    const raw = this.homey.settings.get(LINKS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l) => l && l.switchId)
      .map((l) => ({
        switchId: l.switchId,
        type: l.type || '',
        mode: l.mode || 'dimmer',
        lightId: l.lightId || '',
        lightId2: l.lightId2 || '',
        holdLightId: l.holdLightId || '',
        holdLightId2: l.holdLightId2 || '',
        slots: Array.isArray(l.slots) ? l.slots.slice(0, 3).map((slot) => ({
          lightId: slot && slot.lightId ? slot.lightId : '',
        })) : [{ lightId: '' }, { lightId: '' }, { lightId: '' }],
        fadeStep: Number.isFinite(Number(l.fadeStep)) ? Math.abs(Number(l.fadeStep)) : DEFAULT_FADE_STEP,
        fadeUp: Number.isFinite(Number(l.fadeUp)) ? Number(l.fadeUp) : DEFAULT_FADE_UP,
        fadeDown: Number.isFinite(Number(l.fadeDown)) ? Number(l.fadeDown) : DEFAULT_FADE_DOWN,
      }));
  }

  getSensorLinks() {
    const raw = this.homey.settings.get(SENSOR_LINKS_KEY);
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((l) => l && l.sensorId)
      .map((l) => ({
        sensorId: l.sensorId,
        lightId: l.lightId || '',
        mode: l.mode || 'normal',
        timeoutMinutes: Number.isFinite(Number(l.timeoutMinutes)) ? Math.max(1, Math.min(120, Number(l.timeoutMinutes))) : 5,
        sunsetBright: Number.isFinite(Number(l.sunsetBright)) ? Math.max(0, Math.min(100, Number(l.sunsetBright))) : 50,
        midnightBright: Number.isFinite(Number(l.midnightBright)) ? Math.max(0, Math.min(100, Number(l.midnightBright))) : 5,
      }));
  }

  teardownSensors() {
    for (const timer of this.sensorTimers.values()) clearTimeout(timer);
    this.sensorTimers.clear();
    for (const instance of this.sensorInstances) {
      try { if (instance && typeof instance.destroy === 'function') instance.destroy(); } catch (err) { /* ignore */ }
    }
    this.sensorInstances = [];
  }

  async computeNightDim(link) {
    try {
      const now = new Date();
      const lat = this.homey.geolocation.getLatitude();
      const lng = this.homey.geolocation.getLongitude();

      const today = SunCalc.getTimes(now, lat, lng);

      let sunset;
      let sunrise;
      if (now < today.sunrise) {
        // Before today's sunrise: we're in the night between yesterday's sunset and today's sunrise
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const yest = SunCalc.getTimes(yesterday, lat, lng);
        sunset = yest.sunset;
        sunrise = today.sunrise;
      } else if (now >= today.sunrise && now < today.sunset) {
        // Daytime
        return 1;
      } else {
        // After today's sunset: night between today's sunset and tomorrow's sunrise
        sunset = today.sunset;
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tmw = SunCalc.getTimes(tomorrow, lat, lng);
        sunrise = tmw.sunrise;
      }

      // Local midnight after the sunset date
      // In SDK v3, getTimezoneOffset() returns 0. Use homey.clock.getTimezone() instead.
      const timezone = await this.homey.clock.getTimezone();
      // Get the timezone offset for the sunset date using Intl.DateTimeFormat
      const tzOffsetMin = -new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' })
        .formatToParts(sunset)
        .find(p => p.type === 'timeZoneName')?.value
        .replace('GMT', '') || '+0';
      const tzOffsetH = parseInt(tzOffsetMin);
      const tzOffsetMs = tzOffsetH * 60 * 60 * 1000;
      const sunsetLocal = new Date(sunset.getTime() - tzOffsetMs);
      const midnightAfterSunset = new Date(sunsetLocal.getFullYear(), sunsetLocal.getMonth(), sunsetLocal.getDate() + 1, 0, 0, 0);
      // Convert back to UTC timestamp for comparison with 'now'
      const midnightAfterSunsetUTC = new Date(midnightAfterSunset.getTime() + tzOffsetMs);

      let result;
      if (now >= sunset && now < midnightAfterSunsetUTC) {
        const duration = midnightAfterSunsetUTC - sunset;
        const elapsed = now - sunset;
        const ratio = Math.min(1, Math.max(0, elapsed / duration));
        const s = link.sunsetBright / 100;
        const m = link.midnightBright / 100;
        result = s - ratio * (s - m);
      } else if (now >= midnightAfterSunsetUTC && now < sunrise) {
        result = link.midnightBright / 100;
      } else {
        result = 1;
      }

      this.log(`Night dim: sunset=${sunset.toISOString()} midnightAfterSunset=${midnightAfterSunsetUTC.toISOString()} sunrise=${sunrise.toISOString()} computed=${(result * 100).toFixed(1)}%`);
      return result;
    } catch (err) {
      this.error('computeNightDim failed:', err && err.message ? err.message : err);
      return 1;
    }
  }

  async turnOnSensorLight(link) {
    const light = await this.api.devices.getDevice({ id: link.lightId });
    if (!light) throw new Error(`Light ${link.lightId} not found`);

    const caps = light.capabilities || [];
    let dim = 1;
    if (link.mode === 'night') dim = await this.computeNightDim(link);

    if (caps.includes('dim')) {
      this.log(`Setting dim to ${(dim * 100).toFixed(1)}% on "${light.name}"`);
      await light.setCapabilityValue({ capabilityId: 'dim', value: dim });
    }
    if (caps.includes('onoff')) {
      await light.setCapabilityValue({ capabilityId: 'onoff', value: true });
    }
  }

  async turnOffSensorLight(link) {
    const light = await this.api.devices.getDevice({ id: link.lightId });
    if (!light) throw new Error(`Light ${link.lightId} not found`);

    const caps = light.capabilities || [];
    if (caps.includes('onoff')) {
      await light.setCapabilityValue({ capabilityId: 'onoff', value: false });
    } else if (caps.includes('dim')) {
      await light.setCapabilityValue({ capabilityId: 'dim', value: 0 });
    }
  }

  async bindSensors() {
    const links = this.getSensorLinks();
    if (links.length === 0) return;

    let devices;
    try {
      devices = await this.api.devices.getDevices();
    } catch (err) {
      this.error('bindSensors failed:', err);
      return;
    }

    links.forEach((link, index) => {
      const sensor = devices[link.sensorId];
      if (!sensor) {
        this.error(`Sensor ${link.sensorId} not found, skipping`);
        return;
      }
      const caps = sensor.capabilities || [];
      if (!caps.includes('alarm_motion')) {
        this.error(`Sensor "${sensor.name}" has no alarm_motion capability`);
        return;
      }

      // Key timers per link, not per sensor, so one sensor driving two lights
      // doesn't clobber the other's off-timer.
      const timerKey = `${link.sensorId}:${index}`;

      const instance = sensor.makeCapabilityInstance('alarm_motion', (value) => {
        if (value === true) {
          // Motion detected: turn on and reset off-timer
          const existing = this.sensorTimers.get(timerKey);
          if (existing) clearTimeout(existing);

          this.turnOnSensorLight(link)
            .then(() => this.log(`Sensor "${sensor.name}" triggered light "${link.lightId}"`))
            .catch((err) => this.error(`turnOnSensorLight failed: ${err.message || err}`));

          const timeoutMs = link.timeoutMinutes * 60 * 1000;
          const timer = setTimeout(() => {
            this.sensorTimers.delete(timerKey);
            this.turnOffSensorLight(link)
              .then(() => this.log(`Sensor "${sensor.name}" timed out, light off`))
              .catch((err) => this.error(`turnOffSensorLight failed: ${err.message || err}`));
          }, timeoutMs);
          this.sensorTimers.set(timerKey, timer);
        }
      });
      this.sensorInstances.push(instance);
      this.log(`Bound sensor "${sensor.name}" -> ${link.lightId} (mode:${link.mode} timeout:${link.timeoutMinutes}m)`);
    });
  }

  getSwitchType(device) {
    if (!device) return '';
    if (device.driverId === DUAL_BUTTON_DRIVER_ID) return 'dual';
    if (device.driverId === SCROLL_WHEEL_DRIVER_ID) return 'dial';
    return '';
  }

  // Homey resolves a Flow card in the editor by its `uri` (the card-type URI),
  // which is the card id prefixed with the card kind. Without it the flow still
  // saves and triggers, but the editor can't find the card definition and
  // renders it blank. `kind` is 'trigger' or 'action'.
  flowCard(kind, id, args = {}) {
    const prefix = kind === 'trigger' ? 'homey:flowcardtrigger:' : 'homey:flowcardaction:';
    return { id, uri: `${prefix}${id}`, args };
  }

  triggerForButton(switchId, buttonId) {
    return this.flowCard('trigger', `homey:device:${switchId}:switch_press_multi`, { button: String(buttonId) });
  }

  triggerForButtonHold(switchId, buttonId) {
    return this.flowCard('trigger', `homey:device:${switchId}:switch_long_press_multi`, { button: String(buttonId) });
  }

  lightAction(light, action, stepPercent) {
    const caps = light.capabilities || [];
    const baseId = `homey:device:${light.id}`;
    const card = (id, args) => this.flowCard('action', id, args);

    if (action === 'toggle' && caps.includes('onoff')) return card(`${baseId}:toggle`);
    if (action === 'on' && caps.includes('onoff')) return card(`${baseId}:on`);
    if (action === 'off' && caps.includes('onoff')) return card(`${baseId}:off`);
    if (action === 'dim' && caps.includes('dim')) {
      return card(`${baseId}:dim_relative`, { dim: stepPercent / 100 });
    }
    if (action === 'on' && caps.includes('dim')) return card(`${baseId}:dim`, { dim: 1 });
    if (action === 'off' && caps.includes('dim')) return card(`${baseId}:dim`, { dim: 0 });
    if (action === 'dim' && caps.includes('onoff')) return card(`${baseId}:${stepPercent > 0 ? 'on' : 'off'}`);

    return null;
  }

  async getOrCreateSwitchMasterFolder(flowApi) {
    try {
      const folders = await flowApi.flow.getFlowFolders();
      const found = Object.values(folders).find((f) => f.name === '__SwitchMaster');
      if (found) return found.id;

      const created = await flowApi.flow.createFlowFolder({ flowfolder: { name: '__SwitchMaster' } });
      this.log(`Created Flow folder "__SwitchMaster" (${created.id})`);
      return created.id;
    } catch (err) {
      this.error('getOrCreateSwitchMasterFolder failed:', err && err.message ? err.message : err);
      return null;
    }
  }

  makeFlow(name, trigger, action, folderId) {
    // Standard ("simple") flows tag each action as belonging to the "Then..."
    // column. Without group/delay/duration the card renders blank and the flow
    // may not show correctly in the mobile app.
    const thenAction = action ? { delay: null, duration: null, ...action, group: 'then' } : action;
    return {
      name,
      enabled: true,
      folder: folderId || null,
      trigger,
      conditions: [],
      actions: [thenAction],
    };
  }

  addFlow(flows, flow) {
    if (flow && flow.trigger && flow.actions && flow.actions[0]) {
      flows.push(flow);
    } else if (flow && flow.name) {
      // Action came back null (e.g. light group lacks the expected capability),
      // so the flow is silently dropped. Surface it instead of failing quietly.
      this.error(`Skipped Flow "${flow.name}": no usable light action (light is missing onoff/dim, or action not supported)`);
    }
  }

  buildDualButtonFlows(link, sw, light, light2, holdLight, holdLight2, folderId) {
    const flows = [];
    const prefix = sw.name;

    if (link.mode === 'onoff') {
      this.addFlow(flows, this.makeFlow(
        `${prefix} - top on`,
        this.triggerForButton(sw.id, 1),
        this.lightAction(light, 'on'),
        folderId,
      ));
      this.addFlow(flows, this.makeFlow(
        `${prefix} - bottom off`,
        this.triggerForButton(sw.id, 2),
        this.lightAction(light, 'off'),
        folderId,
      ));
      if (holdLight) {
        this.addFlow(flows, this.makeFlow(
          `${prefix} - top hold on`,
          this.triggerForButtonHold(sw.id, 1),
          this.lightAction(holdLight, 'on'),
          folderId,
        ));
        this.addFlow(flows, this.makeFlow(
          `${prefix} - bottom hold off`,
          this.triggerForButtonHold(sw.id, 2),
          this.lightAction(holdLight, 'off'),
          folderId,
        ));
      }
      return flows;
    }

    if (link.mode === 'split') {
      this.addFlow(flows, this.makeFlow(
        `${prefix} - top toggle`,
        this.triggerForButton(sw.id, 1),
        this.lightAction(light, 'toggle'),
        folderId,
      ));
      this.addFlow(flows, this.makeFlow(
        `${prefix} - bottom toggle`,
        this.triggerForButton(sw.id, 2),
        this.lightAction(light2 || light, 'toggle'),
        folderId,
      ));
      if (holdLight) {
        this.addFlow(flows, this.makeFlow(
          `${prefix} - top hold toggle`,
          this.triggerForButtonHold(sw.id, 1),
          this.lightAction(holdLight, 'toggle'),
          folderId,
        ));
      }
      if (holdLight2) {
        this.addFlow(flows, this.makeFlow(
          `${prefix} - bottom hold toggle`,
          this.triggerForButtonHold(sw.id, 2),
          this.lightAction(holdLight2, 'toggle'),
          folderId,
        ));
      }
      return flows;
    }

    this.addFlow(flows, this.makeFlow(
      `${prefix} - top dim up`,
      this.triggerForButton(sw.id, 1),
      this.lightAction(light, 'dim', link.fadeStep),
      folderId,
    ));
    this.addFlow(flows, this.makeFlow(
      `${prefix} - bottom dim down`,
      this.triggerForButton(sw.id, 2),
      this.lightAction(light, 'dim', -link.fadeStep),
      folderId,
    ));

    return flows;
  }

  buildDialFlows(link, sw, devices, folderId) {
    const flows = [];
    const prefix = sw.name;
    const buttons = [
      { slot: 1, up: 1, down: 2, press: 3 },
      { slot: 2, up: 4, down: 5, press: 6 },
      { slot: 3, up: 7, down: 8, press: 9 },
    ];

    buttons.forEach((button, index) => {
      const lightId = link.slots[index] && link.slots[index].lightId;
      const light = lightId && devices[lightId];
      if (!light) return;

      this.addFlow(flows, this.makeFlow(
        `${prefix} - slot ${button.slot} dim up`,
        this.triggerForButton(sw.id, button.up),
        this.lightAction(light, 'dim', link.fadeStep),
        folderId,
      ));
      this.addFlow(flows, this.makeFlow(
        `${prefix} - slot ${button.slot} dim down`,
        this.triggerForButton(sw.id, button.down),
        this.lightAction(light, 'dim', -link.fadeStep),
        folderId,
      ));
      this.addFlow(flows, this.makeFlow(
        `${prefix} - slot ${button.slot} toggle`,
        this.triggerForButton(sw.id, button.press),
        this.lightAction(light, 'toggle'),
        folderId,
      ));
    });

    return flows;
  }

  async buildDesiredFlows(flowApi) {
    const links = this.getLinks();
    const devices = await this.api.devices.getDevices();
    const folderId = await this.getOrCreateSwitchMasterFolder(flowApi);
    const flows = [];

    for (const link of links) {
      const sw = devices[link.switchId];
      if (!sw) {
        this.error(`Skipping link: switch ${link.switchId} not found`);
        continue;
      }

      const type = this.getSwitchType(sw);
      if (type === 'dual') {
        const light = devices[link.lightId];
        if (!light) {
          this.error(`Skipping "${sw.name}": light ${link.lightId} not found`);
          continue;
        }
        flows.push(...this.buildDualButtonFlows(
          link, sw, light, devices[link.lightId2],
          devices[link.holdLightId], devices[link.holdLightId2],
          folderId,
        ));
      } else if (type === 'dial') {
        flows.push(...this.buildDialFlows(link, sw, devices, folderId));
      } else {
        this.error(`Skipping "${sw.name}": unsupported switch type (driver ${sw.driverId})`);
      }
    }

    return { flows, folderId };
  }

  async syncGeneratedFlows() {
    const flowApi = await this.getFlowApi();
    if (!flowApi) {
      this.log('Flow sync skipped: no Personal Access Token configured (Settings → paste a PAT). App tokens cannot manage Flows.');
      return;
    }

    try {
      const [{ flows: desired, folderId }, existingMap] = await Promise.all([
        this.buildDesiredFlows(flowApi),
        flowApi.flow.getFlows(),
      ]);
      this.log(`Flow sync: ${desired.length} desired flow(s) built from settings`);

      // Identify flows we own by their folder, not a name prefix, so generated
      // flow names can be clean (the folder already groups them).
      const desiredByName = new Map(desired.map((flow) => [flow.name, flow]));
      const existing = Object.values(existingMap)
        .filter((flow) => folderId && flow.folder === folderId);
      const existingByName = new Map();

      for (const flow of existing) {
        if (!existingByName.has(flow.name)) existingByName.set(flow.name, []);
        existingByName.get(flow.name).push(flow);
      }

      for (const flow of existing) {
        if (!desiredByName.has(flow.name)) {
          await flowApi.flow.deleteFlow({ id: flow.id });
          this.log(`Deleted generated Flow "${flow.name}"`);
        }
      }

      for (const flow of desired) {
        const matches = existingByName.get(flow.name) || [];
        const existingFlow = matches.shift();
        try {
          if (existingFlow) {
            await flowApi.flow.updateFlow({ id: existingFlow.id, flow });
            this.log(`Updated generated Flow "${flow.name}"`);
          } else {
            const created = await flowApi.flow.createFlow({ flow });
            this.log(`Created generated Flow "${flow.name}" (${created && created.id ? created.id : 'no id'})`);
          }
        } catch (err) {
          this.error(`Failed to ${existingFlow ? 'update' : 'create'} Flow "${flow.name}": ${err && err.message ? err.message : err}`);
          this.error(`Offending Flow payload: ${JSON.stringify(flow)}`);
        }

        for (const duplicate of matches) {
          await flowApi.flow.deleteFlow({ id: duplicate.id });
          this.log(`Deleted duplicate generated Flow "${duplicate.name}"`);
        }
      }
    } catch (err) {
      this.error('syncGeneratedFlows failed:', err && err.message ? err.message : err);
      if (err && err.stack) this.error(err.stack);
    }
  }

  async rebuildLinks() {
    this.teardownSensors();
    await this.syncGeneratedFlows();
    await this.bindSensors();
  }
}

module.exports = SwitchMasterApp;
