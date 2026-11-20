'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function createEventRegistry() {
  const listeners = [];
  return {
    addListener(fn) {
      listeners.push(fn);
    },
    removeListener(fn) {
      const idx = listeners.indexOf(fn);
      if (idx !== -1) listeners.splice(idx, 1);
    },
    hasListener(fn) {
      return listeners.includes(fn);
    },
    listeners,
  };
}

function createServiceWorkerHarness() {
  const syncStore = {};
  const localStore = {};
  const calls = {
    insertCSS: [],
    removeCSS: [],
    tabMessages: [],
    badgeTexts: [],
    alarmsCreated: [],
    contextMenusCreated: [],
  };

  const activeTabs = [
    { id: 42, active: true, currentWindow: true, url: 'https://www.amazon.com/dp/B09' },
  ];

  function makeStorageArea(store) {
    return {
      async get(keys) {
        if (keys == null) return structuredClone(store);
        if (typeof keys === 'string') {
          return keys in store ? { [keys]: structuredClone(store[keys]) } : {};
        }
        if (Array.isArray(keys)) {
          const out = {};
          for (const k of keys) {
            if (k in store) out[k] = structuredClone(store[k]);
          }
          return out;
        }
        const out = {};
        for (const [k, defVal] of Object.entries(keys)) {
          out[k] = k in store ? structuredClone(store[k]) : structuredClone(defVal);
        }
        return out;
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) {
          store[k] = structuredClone(v);
        }
      },
      async remove(keys) {
        const arr = Array.isArray(keys) ? keys : [keys];
        for (const k of arr) delete store[k];
      },
      async clear() {
        for (const k of Object.keys(store)) delete store[k];
      },
    };
  }

  const events = {
    onInstalled: createEventRegistry(),
    onStartup: createEventRegistry(),
    onMessage: createEventRegistry(),
    contextMenusClicked: createEventRegistry(),
    onCommand: createEventRegistry(),
    onAlarm: createEventRegistry(),
    tabActivated: createEventRegistry(),
    tabUpdated: createEventRegistry(),
    storageChanged: createEventRegistry(),
  };

  const manifestObj = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

  const chromeMock = {
    storage: {
      sync: makeStorageArea(syncStore),
      local: makeStorageArea(localStore),
      onChanged: events.storageChanged,
    },
    runtime: {
      id: 'darkext-test-id',
      lastError: null,
      getManifest() {
        return manifestObj;
      },
      getURL(rel) {
        return `chrome-extension://darkext-test-id/${String(rel).replace(/^\/+/, '')}`;
      },
      onInstalled: events.onInstalled,
      onStartup: events.onStartup,
      onMessage: events.onMessage,
      async sendMessage() {
        return { ok: true };
      },
    },
    contextMenus: {
      create(opts, cb) {
        calls.contextMenusCreated.push(opts);
        if (typeof cb === 'function') cb();
      },
      update(_id, _opts, cb) {
        if (typeof cb === 'function') cb();
      },
      removeAll(cb) {
        calls.contextMenusCreated.length = 0;
        if (typeof cb === 'function') cb();
      },
      onClicked: events.contextMenusClicked,
    },
    commands: {
      onCommand: events.onCommand,
    },
    alarms: {
      async create(name, info) {
        calls.alarmsCreated.push({ name, info });
      },
      async clear() {
        return true;
      },
      async get() {
        return null;
      },
      onAlarm: events.onAlarm,
    },
    tabs: {
      async query(queryInfo) {
        if (queryInfo && queryInfo.active) return activeTabs.map((t) => ({ ...t }));
        return activeTabs.map((t) => ({ ...t }));
      },
      async get(tabId) {
        return activeTabs.find((t) => t.id === tabId) || { id: tabId, url: 'https://www.amazon.com/' };
      },
      async sendMessage(tabId, message) {
        calls.tabMessages.push({ tabId, message });
        return { ok: true };
      },
      onActivated: events.tabActivated,
      onUpdated: events.tabUpdated,
    },
    scripting: {
      async insertCSS(details) {
        calls.insertCSS.push(details);
      },
      async removeCSS(details) {
        calls.removeCSS.push(details);
      },
    },
    action: {
      async setBadgeText(details) {
        calls.badgeTexts.push(details);
      },
      async setBadgeBackgroundColor() {},
      async setTitle() {},
    },
  };

  const swPath = path.join(ROOT, 'src/background/service-worker.js');
  const swDir = path.dirname(swPath);

  const sandbox = {
    console,
    URL,
    chrome: chromeMock,
    self: null,
    globalThis: null,
    importScripts(...scripts) {
      for (const rel of scripts) {
        const target = rel.startsWith('/')
          ? path.join(ROOT, rel.slice(1))
          : path.resolve(swDir, rel);
        assert.ok(fs.existsSync(target), `importScripts target does not exist: ${rel}`);
        const code = fs.readFileSync(target, 'utf8');
        vm.runInContext(code, context, { filename: target });
      }
    },
  };
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  const swCode = fs.readFileSync(swPath, 'utf8');
  vm.runInContext(swCode, context, { filename: swPath });

  async function sendRuntimeMessage(message, sender = { tab: { id: 42, url: 'https://www.amazon.com/' } }) {
    assert.ok(events.onMessage.listeners.length > 0, 'Service worker must register onMessage listener');
    const listener = events.onMessage.listeners[0];
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Service worker did not call sendResponse for ${message?.type}`));
      }, 2000);
      let syncReturn;
      try {
        syncReturn = listener(message, sender, (response) => {
          clearTimeout(timer);
          resolve(response);
        });
      } catch (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }
      assert.equal(
        syncReturn,
        true,
        `onMessage listener must return true synchronously for ${message?.type}`
      );
    });
  }

  return { context, events, calls, syncStore, localStore, sendRuntimeMessage };
}

function parseZipEntries(zipBuffer) {
  let eocdOffset = -1;
  const minOffset = Math.max(0, zipBuffer.length - 65558);
  for (let i = zipBuffer.length - 22; i >= minOffset; i -= 1) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  assert.ok(eocdOffset !== -1, 'ZIP End of Central Directory signature not found');

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = cdOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    assert.equal(
      zipBuffer.readUInt32LE(offset),
      0x02014b50,
      `Invalid Central Directory header at entry ${i}`
    );
    const method = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
    const nameLen = zipBuffer.readUInt16LE(offset + 28);
    const extraLen = zipBuffer.readUInt16LE(offset + 30);
    const commentLen = zipBuffer.readUInt16LE(offset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(offset + 42);
    const name = zipBuffer.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, uncompressedSize, localHeaderOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipEntryBuffer(zipBuffer, entry) {
  const lh = entry.localHeaderOffset;
  assert.equal(zipBuffer.readUInt32LE(lh), 0x04034b50, `Invalid local header for ${entry.name}`);
  const nameLen = zipBuffer.readUInt16LE(lh + 26);
  const extraLen = zipBuffer.readUInt16LE(lh + 28);
  const dataStart = lh + 30 + nameLen + extraLen;
  const compressed = zipBuffer.subarray(dataStart, dataStart + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return zlib.inflateRawSync(compressed);
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}`);
}

describe('Service Worker Integration (VM Sandbox)', () => {
  it('handles onInstalled, settings messages, CSS injection, tab state reporting, and reset', async () => {
    const sw = createServiceWorkerHarness();

    // Trigger onInstalled
    for (const fn of sw.events.onInstalled.listeners) {
      await fn({ reason: 'install' });
    }
    assert.ok(sw.calls.contextMenusCreated.length >= 1, 'Expected context menus created on install');

    // GET_SETTINGS
    const initResp = await sw.sendRuntimeMessage({ type: 'GET_SETTINGS' });
    assert.equal(initResp.ok, true);
    assert.equal(initResp.settings.enabled, true);
    assert.equal(initResp.settings.preset, 'midnight');

    // TOGGLE_GLOBAL -> false -> true
    const toggleOff = await sw.sendRuntimeMessage({ type: 'TOGGLE_GLOBAL' });
    assert.equal(toggleOff.ok, true);
    assert.equal(toggleOff.enabled, false);

    const toggleOn = await sw.sendRuntimeMessage({ type: 'TOGGLE_GLOBAL' });
    assert.equal(toggleOn.ok, true);
    assert.equal(toggleOn.enabled, true);

    // TOGGLE_SITE
    const siteOff = await sw.sendRuntimeMessage({
      type: 'TOGGLE_SITE',
      payload: { hostname: 'www.amazon.com' },
    });
    assert.equal(siteOff.ok, true);
    assert.equal(siteOff.siteEnabled, false);

    // SET_SITE_RULE & DELETE_SITE_RULE
    const ruleResp = await sw.sendRuntimeMessage({
      type: 'SET_SITE_RULE',
      payload: { hostname: 'example.com', rule: { enabled: true, mode: 'filter', preset: 'oled' } },
    });
    assert.equal(ruleResp.ok, true);
    assert.equal(ruleResp.settings.siteRules['example.com'].mode, 'filter');

    const delRuleResp = await sw.sendRuntimeMessage({
      type: 'DELETE_SITE_RULE',
      payload: { hostname: 'example.com' },
    });
    assert.equal(delRuleResp.ok, true);
    assert.equal(delRuleResp.settings.siteRules['example.com'], undefined);

    // UPDATE_SETTINGS (including time schedule -> triggers periodic alarm)
    const updResp = await sw.sendRuntimeMessage({
      type: 'UPDATE_SETTINGS',
      payload: {
        patch: {
          preset: 'nord',
          brightness: 95,
          schedule: { mode: 'time', startTime: '20:00', endTime: '07:00' },
        },
      },
    });
    assert.equal(updResp.ok, true);
    assert.equal(updResp.settings.preset, 'nord');
    assert.equal(updResp.settings.brightness, 95);
    assert.ok(sw.calls.alarmsCreated.length >= 1, 'Expected periodic alarm created for time schedule');

    // SET_CUSTOM_CSS / GET_CUSTOM_CSS / GET_ALL_CUSTOM_CSS
    const setCssResp = await sw.sendRuntimeMessage({
      type: 'SET_CUSTOM_CSS',
      payload: { hostname: 'example.com', css: 'body { background: #111; }' },
    });
    assert.equal(setCssResp.ok, true);
    const getCssResp = await sw.sendRuntimeMessage({
      type: 'GET_CUSTOM_CSS',
      payload: { hostname: 'example.com' },
    });
    assert.equal(getCssResp.ok, true);
    assert.equal(getCssResp.css, 'body { background: #111; }');
    const getAllCssResp = await sw.sendRuntimeMessage({ type: 'GET_ALL_CUSTOM_CSS' });
    assert.equal(getAllCssResp.ok, true);
    assert.equal(getAllCssResp.map['example.com'], 'body { background: #111; }');

    // INJECT_CSS_FILES & REMOVE_CSS_FILES
    const injectResp = await sw.sendRuntimeMessage(
      {
        type: 'INJECT_CSS_FILES',
        payload: { files: ['src/themes/base/variables.css', 'src/themes/sites/amazon.css'] },
      },
      { tab: { id: 42, url: 'https://www.amazon.com/' } }
    );
    assert.equal(injectResp.ok, true);
    assert.equal(sw.calls.insertCSS.length, 1);
    assert.equal(sw.calls.insertCSS[0].target.tabId, 42);
    assert.deepEqual(sw.calls.insertCSS[0].files, [
      'src/themes/base/variables.css',
      'src/themes/sites/amazon.css',
    ]);

    const removeResp = await sw.sendRuntimeMessage(
      {
        type: 'REMOVE_CSS_FILES',
        payload: { files: ['src/themes/sites/amazon.css'] },
      },
      { tab: { id: 42, url: 'https://www.amazon.com/' } }
    );
    assert.equal(removeResp.ok, true);
    assert.equal(sw.calls.removeCSS.length, 1);

    // REPORT_TAB_STATE
    const reportResp = await sw.sendRuntimeMessage(
      {
        type: 'REPORT_TAB_STATE',
        payload: { active: true, mode: 'site-theme', nativeDarkDetected: false, themeId: 'amazon' },
      },
      { tab: { id: 42, url: 'https://www.amazon.com/' } }
    );
    assert.equal(reportResp.ok, true);
    assert.ok(sw.calls.badgeTexts.some((b) => b.tabId === 42));

    // GET_TAB_STATUS (supported + unsupported)
    const tabStatusResp = await sw.sendRuntimeMessage({
      type: 'GET_TAB_STATUS',
      payload: { url: 'https://www.amazon.com/dp/B09' },
    });
    assert.equal(tabStatusResp.ok, true);
    assert.equal(tabStatusResp.supported, true);
    assert.equal(tabStatusResp.hostname, 'amazon.com');

    const unsupportedStatusResp = await sw.sendRuntimeMessage({
      type: 'GET_TAB_STATUS',
      payload: { url: 'chrome://extensions' },
    });
    assert.equal(unsupportedStatusResp.ok, true);
    assert.equal(unsupportedStatusResp.supported, false);

    // Commands send SHOW_TOAST to active tab
    if (sw.events.onCommand.listeners.length > 0) {
      const prevMsgs = sw.calls.tabMessages.length;
      await sw.events.onCommand.listeners[0]('toggle-global');
      const sentAfterCmd = sw.calls.tabMessages.slice(prevMsgs);
      assert.ok(
        sentAfterCmd.some((m) => m.message?.type === 'SHOW_TOAST' && m.message?.payload?.message),
        'Keyboard command must send SHOW_TOAST to active tab'
      );
    }

    // Context menu action sends SHOW_TOAST to active tab
    if (sw.events.contextMenusClicked.listeners.length > 0) {
      const prevMsgs = sw.calls.tabMessages.length;
      await sw.events.contextMenusClicked.listeners[0](
        { menuItemId: 'darkext-toggle-global' },
        { id: 42, url: 'https://www.amazon.com/' }
      );
      const sentAfterMenu = sw.calls.tabMessages.slice(prevMsgs);
      assert.ok(
        sentAfterMenu.some((m) => m.message?.type === 'SHOW_TOAST' && m.message?.payload?.message),
        'Context menu toggle must send SHOW_TOAST to active tab'
      );
    }

    // Alarms listener broadcasts SETTINGS_UPDATED
    if (sw.events.onAlarm.listeners.length > 0) {
      const prevMsgs = sw.calls.tabMessages.length;
      await sw.events.onAlarm.listeners[0]({ name: 'darkext-schedule-check' });
      const sentAfterAlarm = sw.calls.tabMessages.slice(prevMsgs);
      assert.ok(
        sentAfterAlarm.some((m) => m.message?.type === 'SETTINGS_UPDATED'),
        'Schedule alarm should broadcast SETTINGS_UPDATED to supported tabs'
      );
    }

    // RESET_SETTINGS
    const resetResp = await sw.sendRuntimeMessage({ type: 'RESET_SETTINGS' });
    assert.equal(resetResp.ok, true);
    assert.equal(resetResp.settings.preset, 'midnight');
    assert.equal(resetResp.settings.brightness, 100);
    assert.equal(Object.keys(resetResp.settings.siteRules).length, 0);
    assert.equal(Object.keys(resetResp.settings.disabledThemes).length, 0);
  });
});

describe('Extension ZIP Packaging (scripts/package-zip.mjs)', () => {
  it('generates a valid dist/darkextension.zip excluding dev/test directories', () => {
    const pkgScript = path.join(ROOT, 'scripts/package-zip.mjs');
    assert.ok(fs.existsSync(pkgScript), 'scripts/package-zip.mjs must exist');

    execFileSync(process.execPath, [pkgScript], { cwd: ROOT, stdio: 'pipe' });

    const zipPath = path.join(ROOT, 'dist/darkextension.zip');
    assert.ok(fs.existsSync(zipPath), 'dist/darkextension.zip was not generated');

    const zipBuf = fs.readFileSync(zipPath);
    assert.ok(zipBuf.length > 1000, 'dist/darkextension.zip appears empty or too small');

    const entries = parseZipEntries(zipBuf);
    const names = entries.map((e) => e.name.replace(/\\/g, '/'));

    const requiredInZip = [
      'manifest.json',
      'src/background/service-worker.js',
      'src/themes/sites/registry.json',
      'src/themes/sites/amazon.css',
      'src/themes/sites/ebay.css',
      'icons/icon-128.png',
    ];
    for (const req of requiredInZip) {
      assert.ok(names.includes(req), `dist/darkextension.zip missing ${req}`);
    }

    const forbiddenPrefixes = ['.git/', 'tests/', 'scripts/', 'node_modules/', 'dist/'];
    for (const name of names) {
      for (const bad of forbiddenPrefixes) {
        assert.equal(
          name.startsWith(bad) || name === bad.slice(0, -1),
          false,
          `dist/darkextension.zip must exclude ${name}`
        );
      }
    }

    // Verify manifest.json inside zip decompresses and parses cleanly
    const manifestEntry = entries.find((e) => e.name === 'manifest.json');
    const manifestInsideZip = JSON.parse(readZipEntryBuffer(zipBuf, manifestEntry).toString('utf8'));
    assert.equal(manifestInsideZip.manifest_version, 3);
  });
});
