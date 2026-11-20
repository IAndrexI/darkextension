(function (root) {
  'use strict';

  const DarkExt = (root.DarkExt = root.DarkExt || {});

  let Constants = DarkExt.Constants;
  if (!Constants && typeof require === 'function') {
    Constants = require('./constants.js');
  }

  let SiteMatcher = DarkExt.SiteMatcher;
  if (!SiteMatcher && typeof require === 'function') {
    SiteMatcher = require('./site-matcher.js');
  }

  function cloneDefaultSettings() {
    const def = Constants.DEFAULT_SETTINGS;
    return {
      enabled: def.enabled,
      preset: def.preset,
      defaultMode: def.defaultMode,
      autoDetectNativeDark: def.autoDetectNativeDark,
      dimImages: def.dimImages,
      brightness: def.brightness,
      contrast: def.contrast,
      sepia: def.sepia,
      imageBrightness: def.imageBrightness,
      grayscale: def.grayscale,
      schedule: {
        mode: def.schedule.mode,
        startTime: def.schedule.startTime,
        endTime: def.schedule.endTime
      },
      disabledThemes: [],
      siteRules: {}
    };
  }

  function clampNumber(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return fallback;
    }
    return Math.min(max, Math.max(min, Math.round(num)));
  }

  function normalizeSiteRule(rule) {
    if (!rule || typeof rule !== 'object') {
      return null;
    }
    const clean = {
      enabled: rule.enabled !== false,
      mode: ['auto', 'dynamic', 'filter', 'site-theme', 'off'].includes(rule.mode) ? rule.mode : 'auto'
    };
    if (clean.mode === 'off') {
      clean.enabled = false;
    }
    if (typeof rule.preset === 'string' && Constants.PRESET_IDS.includes(rule.preset)) {
      clean.preset = rule.preset;
    }
    if (typeof rule.brightness === 'number') {
      clean.brightness = clampNumber(rule.brightness, Constants.LIMITS.brightness.min, Constants.LIMITS.brightness.max, 100);
    }
    if (typeof rule.contrast === 'number') {
      clean.contrast = clampNumber(rule.contrast, Constants.LIMITS.contrast.min, Constants.LIMITS.contrast.max, 100);
    }
    if (typeof rule.sepia === 'number') {
      clean.sepia = clampNumber(rule.sepia, Constants.LIMITS.sepia.min, Constants.LIMITS.sepia.max, 0);
    }
    if (typeof rule.imageBrightness === 'number') {
      clean.imageBrightness = clampNumber(rule.imageBrightness, Constants.LIMITS.imageBrightness.min, Constants.LIMITS.imageBrightness.max, 90);
    }
    if (typeof rule.grayscale === 'number') {
      clean.grayscale = clampNumber(rule.grayscale, Constants.LIMITS.grayscale.min, Constants.LIMITS.grayscale.max, 0);
    }
    if (typeof rule.dimImages === 'boolean') {
      clean.dimImages = rule.dimImages;
    }
    if (typeof rule.forceOverrideNativeDark === 'boolean') {
      clean.forceOverrideNativeDark = rule.forceOverrideNativeDark;
    }
    return clean;
  }

  function sanitizeSettings(raw) {
    const base = cloneDefaultSettings();
    if (!raw || typeof raw !== 'object') {
      return base;
    }

    const limits = Constants.LIMITS;
    const validModes = ['auto', 'dynamic', 'filter'];
    const validScheduleModes = ['off', 'system', 'time'];

    const merged = {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : base.enabled,
      preset: Constants.PRESET_IDS.includes(raw.preset) ? raw.preset : base.preset,
      defaultMode: validModes.includes(raw.defaultMode) ? raw.defaultMode : base.defaultMode,
      autoDetectNativeDark: typeof raw.autoDetectNativeDark === 'boolean' ? raw.autoDetectNativeDark : base.autoDetectNativeDark,
      dimImages: typeof raw.dimImages === 'boolean' ? raw.dimImages : base.dimImages,
      brightness: clampNumber(raw.brightness, limits.brightness.min, limits.brightness.max, base.brightness),
      contrast: clampNumber(raw.contrast, limits.contrast.min, limits.contrast.max, base.contrast),
      sepia: clampNumber(raw.sepia, limits.sepia.min, limits.sepia.max, base.sepia),
      imageBrightness: clampNumber(raw.imageBrightness, limits.imageBrightness.min, limits.imageBrightness.max, base.imageBrightness),
      grayscale: clampNumber(raw.grayscale, limits.grayscale.min, limits.grayscale.max, base.grayscale),
      schedule: {
        mode: raw.schedule && validScheduleModes.includes(raw.schedule.mode) ? raw.schedule.mode : base.schedule.mode,
        startTime: raw.schedule && typeof raw.schedule.startTime === 'string' ? raw.schedule.startTime : base.schedule.startTime,
        endTime: raw.schedule && typeof raw.schedule.endTime === 'string' ? raw.schedule.endTime : base.schedule.endTime
      },
      disabledThemes: Array.isArray(raw.disabledThemes)
        ? Array.from(new Set(raw.disabledThemes.filter((id) => typeof id === 'string' && id.trim())))
        : [],
      siteRules: {}
    };

    if (raw.siteRules && typeof raw.siteRules === 'object') {
      for (const rawKey of Object.keys(raw.siteRules)) {
        const normKey = SiteMatcher ? SiteMatcher.normalizeHostname(rawKey) : rawKey.trim().toLowerCase();
        const rule = normalizeSiteRule(raw.siteRules[rawKey]);
        if (normKey && rule) {
          merged.siteRules[normKey] = rule;
        }
      }
    }

    return merged;
  }

  function getChromeStorageArea(areaName) {
    if (typeof root.chrome !== 'undefined' && root.chrome && root.chrome.storage && root.chrome.storage[areaName]) {
      return root.chrome.storage[areaName];
    }
    return null;
  }

  async function storageGet(area, key) {
    if (!area || typeof area.get !== 'function') {
      return {};
    }
    const result = await area.get(key);
    return result && typeof result === 'object' ? result : {};
  }

  async function storageSet(area, items) {
    if (!area || typeof area.set !== 'function') {
      return;
    }
    await area.set(items);
  }

  async function getSettings() {
    const syncArea = getChromeStorageArea('sync');
    const data = await storageGet(syncArea, Constants.STORAGE_KEY);
    return sanitizeSettings(data[Constants.STORAGE_KEY]);
  }

  async function saveSettings(settings) {
    const clean = sanitizeSettings(settings);
    const syncArea = getChromeStorageArea('sync');
    await storageSet(syncArea, { [Constants.STORAGE_KEY]: clean });
    return clean;
  }

  async function updateSettings(patch) {
    const current = await getSettings();
    if (!patch || typeof patch !== 'object') {
      return current;
    }
    const next = {
      ...current,
      ...patch,
      schedule: patch.schedule && typeof patch.schedule === 'object'
        ? { ...current.schedule, ...patch.schedule }
        : current.schedule,
      disabledThemes: Array.isArray(patch.disabledThemes)
        ? [...patch.disabledThemes]
        : current.disabledThemes,
      siteRules: patch.siteRules && typeof patch.siteRules === 'object'
        ? { ...patch.siteRules }
        : current.siteRules
    };
    return saveSettings(next);
  }

  async function setSiteRule(hostname, rule) {
    const normHost = SiteMatcher ? SiteMatcher.normalizeHostname(hostname) : String(hostname || '').trim().toLowerCase();
    const current = await getSettings();
    if (!normHost) {
      return current;
    }
    const nextRules = { ...current.siteRules };
    if (rule === null) {
      delete nextRules[normHost];
    } else {
      const normalizedRule = normalizeSiteRule(rule);
      if (normalizedRule) {
        nextRules[normHost] = normalizedRule;
      }
    }
    return saveSettings({ ...current, siteRules: nextRules });
  }

  async function deleteSiteRule(hostname) {
    const rawHost = String(hostname || '').trim().toLowerCase();
    const normHost = SiteMatcher ? SiteMatcher.normalizeHostname(rawHost) : rawHost;
    const current = await getSettings();
    const nextRules = { ...current.siteRules };
    if (normHost) {
      delete nextRules[normHost];
    }
    if (rawHost) {
      delete nextRules[rawHost];
    }
    return saveSettings({ ...current, siteRules: nextRules });
  }

  async function getAllCustomCss() {
    const localArea = getChromeStorageArea('local');
    const data = await storageGet(localArea, Constants.CUSTOM_CSS_KEY);
    const rawMap = data[Constants.CUSTOM_CSS_KEY];
    if (!rawMap || typeof rawMap !== 'object') {
      return {};
    }
    const cleanMap = {};
    for (const key of Object.keys(rawMap)) {
      const normKey = SiteMatcher ? SiteMatcher.normalizeHostname(key) : key.trim().toLowerCase();
      if (normKey && typeof rawMap[key] === 'string' && rawMap[key].trim()) {
        cleanMap[normKey] = rawMap[key];
      }
    }
    return cleanMap;
  }

  async function getCustomCss(hostname) {
    const normHost = SiteMatcher ? SiteMatcher.normalizeHostname(hostname) : String(hostname || '').trim().toLowerCase();
    if (!normHost) {
      return '';
    }
    const map = await getAllCustomCss();
    return map[normHost] || '';
  }

  async function setCustomCss(hostname, css) {
    const normHost = SiteMatcher ? SiteMatcher.normalizeHostname(hostname) : String(hostname || '').trim().toLowerCase();
    const map = await getAllCustomCss();
    if (!normHost) {
      return map;
    }
    const cssText = typeof css === 'string' ? css : '';
    if (!cssText.trim()) {
      delete map[normHost];
    } else {
      map[normHost] = cssText;
    }
    const localArea = getChromeStorageArea('local');
    await storageSet(localArea, { [Constants.CUSTOM_CSS_KEY]: map });
    return map;
  }

  async function resetAll() {
    const defaults = cloneDefaultSettings();
    const syncArea = getChromeStorageArea('sync');
    const localArea = getChromeStorageArea('local');
    await storageSet(syncArea, { [Constants.STORAGE_KEY]: defaults });
    await storageSet(localArea, { [Constants.CUSTOM_CSS_KEY]: {} });
    return defaults;
  }

  const Storage = Object.freeze({
    getSettings,
    saveSettings,
    updateSettings,
    setSiteRule,
    deleteSiteRule,
    getCustomCss,
    getAllCustomCss,
    setCustomCss,
    resetAll
  });

  DarkExt.Storage = Storage;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Storage;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
