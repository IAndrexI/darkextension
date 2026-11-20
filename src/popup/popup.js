(function initPopupModule() {
  'use strict';

  const DE = globalThis.DarkExt || {};
  const Constants = DE.Constants || {};
  const SiteMatcher = DE.SiteMatcher || {};
  const Schedule = DE.Schedule || {};
  const Storage = DE.Storage || {};

  const MSG = Constants.MESSAGE_TYPES || {
    GET_SETTINGS: 'GET_SETTINGS',
    UPDATE_SETTINGS: 'UPDATE_SETTINGS',
    SET_SITE_RULE: 'SET_SITE_RULE',
    DELETE_SITE_RULE: 'DELETE_SITE_RULE',
    TOGGLE_GLOBAL: 'TOGGLE_GLOBAL',
    TOGGLE_SITE: 'TOGGLE_SITE',
    GET_TAB_STATUS: 'GET_TAB_STATUS',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED'
  };

  const DEFAULTS = Constants.DEFAULT_SETTINGS || {
    enabled: true,
    preset: 'midnight',
    defaultMode: 'auto',
    autoDetectNativeDark: true,
    dimImages: true,
    brightness: 100,
    contrast: 100,
    sepia: 0,
    imageBrightness: 90,
    grayscale: 0,
    schedule: { mode: 'off', startTime: '20:00', endTime: '07:00' },
    disabledThemes: [],
    siteRules: {}
  };

  const PRESET_NAMES = {
    midnight: 'Midnight',
    oled: 'OLED',
    warm: 'Warm',
    slate: 'Slate',
    nord: 'Nord'
  };

  const state = {
    settings: Object.assign({}, DEFAULTS),
    effectiveEnabled: true,
    tabId: null,
    windowId: null,
    isVivaldi: false,
    tabUrl: '',
    hostname: '',
    supported: false,
    tabStatus: null,
    debounceTimer: null,
    pendingPatch: {},
    tabRefreshTimer: null,
    tabRefreshInFlight: null,
    pendingTabRefresh: false
  };

  const el = {};

  function cacheElements() {
    el.globalToggle = document.getElementById('global-toggle');
    el.globalStateLabel = document.getElementById('global-state-label');
    el.btnOpenSidepanel = document.getElementById('btn-open-sidepanel');
    el.btnOpenOptions = document.getElementById('btn-open-options');
    el.statusBanner = document.getElementById('status-banner');
    el.siteCard = document.querySelector('.site-card');
    el.siteHostname = document.getElementById('site-hostname');
    el.siteStatusPill = document.getElementById('site-status-pill');
    el.siteThemeDetail = document.getElementById('site-theme-detail');
    el.siteToggle = document.getElementById('site-toggle');
    el.modePills = document.getElementById('mode-pills');
    el.forceDarkRow = document.getElementById('force-dark-row');
    el.btnForceDark = document.getElementById('btn-force-dark');
    el.unsupportedHint = document.getElementById('unsupported-hint');
    el.activePresetName = document.getElementById('active-preset-name');
    el.presetSwatches = document.getElementById('preset-swatches');
    el.sliderBrightness = document.getElementById('slider-brightness');
    el.sliderContrast = document.getElementById('slider-contrast');
    el.sliderSepia = document.getElementById('slider-sepia');
    el.sliderImageBrightness = document.getElementById('slider-image-brightness');
    el.valBrightness = document.getElementById('val-brightness');
    el.valContrast = document.getElementById('val-contrast');
    el.valSepia = document.getElementById('val-sepia');
    el.valImageBrightness = document.getElementById('val-image-brightness');
    el.toggleDimImages = document.getElementById('toggle-dim-images');
    el.btnResetAdjustments = document.getElementById('btn-reset-adjustments');
    el.scheduleSummary = document.getElementById('schedule-summary');
    el.btnCustomCss = document.getElementById('btn-custom-css');
    el.btnFooterOptions = document.getElementById('btn-footer-options');
  }

  function showBanner(message, variant) {
    if (!el.statusBanner) return;
    if (!message) {
      el.statusBanner.textContent = '';
      el.statusBanner.className = 'status-banner hidden';
      return;
    }
    const cls = variant === 'error'
      ? 'status-banner is-error'
      : variant === 'warn'
        ? 'status-banner is-warn'
        : 'status-banner';
    el.statusBanner.textContent = message;
    el.statusBanner.className = cls;
  }

  async function sendRuntime(type, payload) {
    try {
      const response = await chrome.runtime.sendMessage({ type, payload: payload || {} });
      return response || { ok: false };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  function getSystemDark() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (_) {
      return false;
    }
  }

  function computeFallbackScheduleBlocked(settings) {
    const sched = (settings && settings.schedule) || DEFAULTS.schedule;
    if (!sched || sched.mode === 'off') {
      return false;
    }
    if (typeof Schedule.isScheduleActive === 'function') {
      return !Schedule.isScheduleActive(sched, getSystemDark(), new Date());
    }
    if (sched.mode === 'system') {
      return !getSystemDark();
    }
    return false;
  }

  function detectIsVivaldi(tab) {
    const uaVivaldi = typeof navigator !== 'undefined' && /Vivaldi/i.test(navigator.userAgent || '');
    const vivTabProp = Boolean(tab && typeof tab === 'object' && 'vivExtData' in tab);
    return uaVivaldi || vivTabProp;
  }

  function detectPanelLayout() {
    try {
      const params = new URLSearchParams(window.location.search || '');
      const isQueryPanel = params.get('panel') === '1';
      const tallViewport = typeof window.innerHeight === 'number' && window.innerHeight > 620;
      const nonPopupWidth = typeof window.innerWidth === 'number' && window.innerWidth > 0 && window.innerWidth !== 356;
      document.documentElement.classList.toggle('is-panel', isQueryPanel || tallViewport || nonPopupWidth);
    } catch (_) {
      // Ignore layout detection failures
    }
  }

  async function queryActiveTab() {
    state.tabId = null;
    state.windowId = null;
    state.tabUrl = '';
    state.hostname = '';
    state.supported = false;
    state.tabStatus = null;

    try {
      let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tabs || tabs.length === 0) {
        tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      }
      const tab = tabs && tabs[0];
      if (!tab) {
        state.isVivaldi = detectIsVivaldi(null);
        return;
      }

      state.tabId = typeof tab.id === 'number' ? tab.id : null;
      state.windowId = typeof tab.windowId === 'number' ? tab.windowId : null;
      state.isVivaldi = detectIsVivaldi(tab);
      state.tabUrl = tab.url || '';

      const fallbackSupported = typeof SiteMatcher.isSupportedUrl === 'function'
        ? SiteMatcher.isSupportedUrl(state.tabUrl)
        : /^https?:\/\//i.test(state.tabUrl);

      const fallbackHostname = fallbackSupported && typeof SiteMatcher.extractHostname === 'function'
        ? SiteMatcher.extractHostname(state.tabUrl)
        : '';

      state.supported = fallbackSupported;
      state.hostname = fallbackHostname;

      if (state.tabId !== null && fallbackSupported) {
        try {
          const tabResp = await chrome.tabs.sendMessage(state.tabId, { type: MSG.GET_TAB_STATUS });
          if (tabResp && tabResp.ok) {
            state.tabStatus = tabResp;
            if (tabResp.hostname) {
              state.hostname = typeof SiteMatcher.normalizeHostname === 'function'
                ? SiteMatcher.normalizeHostname(tabResp.hostname)
                : tabResp.hostname;
            }
            if (typeof tabResp.supported === 'boolean') {
              state.supported = tabResp.supported;
            }
          }
        } catch (_) {
          // Content script may not be loaded on pre-existing tabs yet; ask background worker as fallback.
          const swResp = await sendRuntime(MSG.GET_TAB_STATUS, { url: state.tabUrl });
          if (swResp && swResp.ok) {
            state.tabStatus = swResp;
            if (swResp.hostname) {
              state.hostname = swResp.hostname;
            }
          }
        }
      }
    } catch (_) {
      // Ignore tab query failure in restricted contexts
    }
  }

  async function loadInitialState() {
    const resp = await sendRuntime(MSG.GET_SETTINGS, {});
    if (resp && resp.ok && resp.settings) {
      state.settings = Object.assign({}, DEFAULTS, resp.settings);
      if (typeof resp.effectiveEnabled === 'boolean') {
        state.effectiveEnabled = resp.effectiveEnabled;
      } else {
        state.effectiveEnabled = Boolean(state.settings.enabled) && !computeFallbackScheduleBlocked(state.settings);
      }
    } else if (typeof Storage.getSettings === 'function') {
      state.settings = Object.assign({}, DEFAULTS, await Storage.getSettings());
      state.effectiveEnabled = Boolean(state.settings.enabled) && !computeFallbackScheduleBlocked(state.settings);
    }

    await queryActiveTab();
    render();
  }

  function getSiteRule(hostname) {
    if (!hostname || !state.settings.siteRules) return null;
    const rules = state.settings.siteRules;
    if (Object.prototype.hasOwnProperty.call(rules, hostname) && rules[hostname]) {
      return rules[hostname];
    }
    if (typeof SiteMatcher.domainMatches === 'function') {
      for (const key of Object.keys(rules)) {
        if (rules[key] && SiteMatcher.domainMatches(hostname, key)) {
          return rules[key];
        }
      }
    }
    return null;
  }

  function renderHeaderAndTheme() {
    const settings = state.settings;
    const preset = settings.preset || 'midnight';
    document.documentElement.dataset.preset = PRESET_NAMES[preset] ? preset : 'midnight';

    el.globalToggle.checked = Boolean(settings.enabled);
    if (!settings.enabled) {
      el.globalStateLabel.textContent = 'Paused';
      el.globalStateLabel.classList.add('is-off');
    } else if (!state.effectiveEnabled) {
      el.globalStateLabel.textContent = 'Scheduled Off';
      el.globalStateLabel.classList.add('is-off');
    } else {
      el.globalStateLabel.textContent = 'Active';
      el.globalStateLabel.classList.remove('is-off');
    }

    el.activePresetName.textContent = PRESET_NAMES[preset] || 'Midnight';
    const swatches = el.presetSwatches.querySelectorAll('.swatch-btn');
    for (const btn of swatches) {
      const active = btn.dataset.preset === preset;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    }
  }

  function renderSiteCard() {
    const settings = state.settings;
    const hostname = state.hostname;
    const supported = state.supported && Boolean(hostname);
    const rule = getSiteRule(hostname);
    const tabStatus = state.tabStatus;
    const scheduleBlocked = tabStatus
      ? Boolean(tabStatus.scheduleBlocked)
      : computeFallbackScheduleBlocked(settings);

    el.siteCard.classList.toggle('is-disabled', !settings.enabled && supported);
    el.unsupportedHint.classList.toggle('hidden', supported);

    const modeButtons = el.modePills.querySelectorAll('.seg-btn');

    if (!supported) {
      el.siteHostname.textContent = state.tabUrl
        ? (state.tabUrl.split('/')[0] || 'Internal Page')
        : 'Browser Page';
      el.siteStatusPill.textContent = 'Unsupported Page';
      el.siteStatusPill.className = 'status-pill status-neutral';
      el.siteThemeDetail.textContent = '';
      el.siteThemeDetail.classList.add('hidden');
      el.unsupportedHint.textContent = state.tabUrl.startsWith('vivaldi://')
        ? "Vivaldi internal pages use Vivaldi's built-in Themes (vivaldi://settings/themes)."
        : 'Browser internal pages cannot be modified by extensions.';
      el.siteToggle.checked = false;
      el.siteToggle.disabled = true;
      el.forceDarkRow.classList.add('hidden');
      for (const btn of modeButtons) {
        btn.disabled = true;
        btn.classList.remove('is-active');
      }
      return;
    }

    el.siteHostname.textContent = hostname;
    el.siteToggle.disabled = false;
    const siteEnabled = rule ? (rule.enabled !== false && rule.mode !== 'off') : true;
    el.siteToggle.checked = siteEnabled;

    const rawMode = (rule && rule.mode) || settings.defaultMode || 'auto';
    const currentModeValue = !siteEnabled
      ? 'off'
      : (rawMode === 'site-theme' ? 'auto' : rawMode);

    for (const btn of modeButtons) {
      btn.disabled = false;
      btn.classList.toggle('is-active', btn.dataset.mode === currentModeValue);
    }

    // Status pill determination
    let pillText = 'Universal Dynamic';
    let pillClass = 'status-pill status-active';
    let detailText = '';

    if (!settings.enabled) {
      pillText = 'Paused';
      pillClass = 'status-pill status-neutral';
    } else if (!siteEnabled) {
      pillText = 'Excluded';
      pillClass = 'status-pill status-warn';
    } else if (scheduleBlocked) {
      pillText = 'Scheduled Off';
      pillClass = 'status-pill status-warn';
    } else if (tabStatus && tabStatus.nativeDarkDetected && !(rule && rule.forceOverrideNativeDark)) {
      pillText = 'Native Dark Detected';
      pillClass = 'status-pill status-native';
    } else if (tabStatus && tabStatus.mode === 'site-theme') {
      pillText = 'Site Theme';
      pillClass = 'status-pill status-theme';
      if (tabStatus.appliedThemeName || tabStatus.appliedThemeId) {
        detailText = tabStatus.appliedThemeName || tabStatus.appliedThemeId;
      }
    } else if (tabStatus && tabStatus.mode === 'filter') {
      pillText = 'Filter Mode';
      pillClass = 'status-pill status-active';
    } else if (tabStatus && tabStatus.mode === 'dynamic') {
      pillText = 'Universal Dynamic';
      pillClass = 'status-pill status-active';
    } else if (currentModeValue === 'filter') {
      pillText = 'Filter Mode';
      pillClass = 'status-pill status-active';
    } else {
      pillText = 'Universal Dynamic';
      pillClass = 'status-pill status-active';
    }

    el.siteStatusPill.textContent = pillText;
    el.siteStatusPill.className = pillClass;

    if (detailText) {
      el.siteThemeDetail.textContent = detailText;
      el.siteThemeDetail.classList.remove('hidden');
    } else {
      el.siteThemeDetail.textContent = '';
      el.siteThemeDetail.classList.add('hidden');
    }

    const nativeDetected = Boolean(tabStatus && tabStatus.nativeDarkDetected);
    const forced = Boolean(rule && rule.forceOverrideNativeDark);
    if ((nativeDetected || forced) && siteEnabled && settings.enabled) {
      el.forceDarkRow.classList.remove('hidden');
      if (forced) {
        el.btnForceDark.textContent = 'Restore Native Dark';
        el.btnForceDark.classList.add('is-forced');
      } else {
        el.btnForceDark.textContent = 'Force Dark Mode';
        el.btnForceDark.classList.remove('is-forced');
      }
    } else {
      el.forceDarkRow.classList.add('hidden');
    }
  }

  function renderSliders() {
    const s = state.settings;
    const brightness = Number.isFinite(Number(s.brightness)) ? Number(s.brightness) : DEFAULTS.brightness;
    const contrast = Number.isFinite(Number(s.contrast)) ? Number(s.contrast) : DEFAULTS.contrast;
    const sepia = Number.isFinite(Number(s.sepia)) ? Number(s.sepia) : DEFAULTS.sepia;
    const imageBrightness = Number.isFinite(Number(s.imageBrightness))
      ? Number(s.imageBrightness)
      : DEFAULTS.imageBrightness;

    el.sliderBrightness.value = String(brightness);
    el.sliderContrast.value = String(contrast);
    el.sliderSepia.value = String(sepia);
    el.sliderImageBrightness.value = String(imageBrightness);

    el.valBrightness.textContent = `${brightness}%`;
    el.valContrast.textContent = `${contrast}%`;
    el.valSepia.textContent = `${sepia}%`;
    el.valImageBrightness.textContent = `${imageBrightness}%`;
    el.toggleDimImages.checked = Boolean(s.dimImages);
  }

  function renderFooter() {
    const sched = state.settings.schedule || DEFAULTS.schedule;
    if (sched.mode === 'system') {
      el.scheduleSummary.textContent = getSystemDark() ? 'System Dark (On)' : 'System Light (Off)';
    } else if (sched.mode === 'time') {
      const active = !computeFallbackScheduleBlocked(state.settings);
      el.scheduleSummary.textContent = `${sched.startTime}–${sched.endTime} (${active ? 'On' : 'Off'})`;
    } else {
      el.scheduleSummary.textContent = 'Manual';
    }
  }

  function render() {
    renderHeaderAndTheme();
    renderSiteCard();
    renderSliders();
    renderFooter();
  }

  async function flushPendingSettings() {
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    const keys = Object.keys(state.pendingPatch);
    if (keys.length === 0) return;

    const patch = Object.assign({}, state.pendingPatch);
    state.pendingPatch = {};
    const resp = await sendRuntime(MSG.UPDATE_SETTINGS, { patch });
    if (resp && resp.ok && resp.settings) {
      state.settings = Object.assign({}, DEFAULTS, resp.settings);
    } else if (!resp || !resp.ok) {
      showBanner('Failed to save adjustment changes.', 'error');
    }
  }

  function queueSettingsPatch(patch, immediate) {
    Object.assign(state.settings, patch);
    Object.assign(state.pendingPatch, patch);
    if (immediate) {
      flushPendingSettings();
      return;
    }
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
    }
    state.debounceTimer = setTimeout(flushPendingSettings, 120);
  }

  async function handleGlobalToggle() {
    showBanner('');
    const resp = await sendRuntime(MSG.TOGGLE_GLOBAL, {});
    if (resp && resp.ok) {
      state.settings.enabled = Boolean(resp.enabled);
      state.effectiveEnabled = state.settings.enabled && !computeFallbackScheduleBlocked(state.settings);
    } else {
      state.settings.enabled = el.globalToggle.checked;
      await sendRuntime(MSG.UPDATE_SETTINGS, { patch: { enabled: state.settings.enabled } });
    }
    await queryActiveTab();
    render();
  }

  async function handleSiteToggle() {
    if (!state.supported || !state.hostname) return;
    showBanner('');
    const resp = await sendRuntime(MSG.TOGGLE_SITE, { hostname: state.hostname });
    if (!resp || !resp.ok) {
      const existing = getSiteRule(state.hostname) || { mode: state.settings.defaultMode || 'auto' };
      const nextRule = Object.assign({}, existing, { enabled: el.siteToggle.checked });
      await sendRuntime(MSG.SET_SITE_RULE, { hostname: state.hostname, rule: nextRule });
    }
    const fresh = await sendRuntime(MSG.GET_SETTINGS, {});
    if (fresh && fresh.ok && fresh.settings) {
      state.settings = Object.assign({}, DEFAULTS, fresh.settings);
    }
    await queryActiveTab();
    render();
  }

  async function handleModeSelect(mode) {
    if (!state.supported || !state.hostname) return;
    showBanner('');
    const existing = getSiteRule(state.hostname) || {};
    const prevActiveMode = existing.mode && existing.mode !== 'off'
      ? existing.mode
      : (state.settings.defaultMode || 'auto');
    let nextRule;
    if (mode === 'off') {
      nextRule = Object.assign({}, existing, {
        enabled: false,
        mode: prevActiveMode
      });
    } else {
      nextRule = Object.assign({}, existing, {
        enabled: true,
        mode
      });
    }

    const resp = await sendRuntime(MSG.SET_SITE_RULE, {
      hostname: state.hostname,
      rule: nextRule
    });
    if (resp && resp.ok && resp.settings) {
      state.settings = Object.assign({}, DEFAULTS, resp.settings);
    } else {
      state.settings.siteRules = Object.assign({}, state.settings.siteRules, {
        [state.hostname]: nextRule
      });
    }
    await queryActiveTab();
    render();
  }

  async function handleForceDarkToggle() {
    if (!state.supported || !state.hostname) return;
    const existing = getSiteRule(state.hostname) || {};
    const prevActiveMode = existing.mode && existing.mode !== 'off'
      ? existing.mode
      : (state.settings.defaultMode || 'auto');
    const nextRule = Object.assign({}, existing, {
      enabled: true,
      mode: prevActiveMode,
      forceOverrideNativeDark: !existing.forceOverrideNativeDark
    });
    const resp = await sendRuntime(MSG.SET_SITE_RULE, {
      hostname: state.hostname,
      rule: nextRule
    });
    if (resp && resp.ok && resp.settings) {
      state.settings = Object.assign({}, DEFAULTS, resp.settings);
    }
    await queryActiveTab();
    render();
  }

  async function handlePresetSelect(preset) {
    if (!PRESET_NAMES[preset]) return;
    state.settings.preset = preset;
    renderHeaderAndTheme();
    const resp = await sendRuntime(MSG.UPDATE_SETTINGS, { patch: { preset } });
    if (resp && resp.ok && resp.settings) {
      state.settings = Object.assign({}, DEFAULTS, resp.settings);
    }
    await queryActiveTab();
    render();
  }

  async function handleResetAdjustments() {
    const resetPatch = {
      brightness: DEFAULTS.brightness,
      contrast: DEFAULTS.contrast,
      sepia: DEFAULTS.sepia,
      imageBrightness: DEFAULTS.imageBrightness,
      grayscale: DEFAULTS.grayscale,
      dimImages: DEFAULTS.dimImages
    };
    Object.assign(state.settings, resetPatch);
    state.pendingPatch = {};
    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }
    renderSliders();
    const resp = await sendRuntime(MSG.UPDATE_SETTINGS, { patch: resetPatch });
    if (resp && resp.ok && resp.settings) {
      state.settings = Object.assign({}, DEFAULTS, resp.settings);
      renderSliders();
    }
  }

  async function openOptionsPage(section, host) {
    try {
      if (!section && chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
        await chrome.runtime.openOptionsPage();
        return;
      }
      const base = chrome.runtime.getURL('src/options/options.html');
      const params = new URLSearchParams();
      if (section) params.set('section', section);
      if (host) params.set('host', host);
      const url = params.toString() ? `${base}?${params.toString()}` : base;
      await chrome.tabs.create({ url });
    } catch (err) {
      showBanner('Unable to open options page.', 'error');
    }
  }

  async function refreshActiveTabView() {
    if (state.tabRefreshInFlight) {
      state.pendingTabRefresh = true;
      await state.tabRefreshInFlight;
      if (state.pendingTabRefresh) {
        state.pendingTabRefresh = false;
        await refreshActiveTabView();
      }
      return;
    }

    state.tabRefreshInFlight = (async () => {
      await queryActiveTab();
      renderSiteCard();
    })();

    try {
      await state.tabRefreshInFlight;
    } finally {
      state.tabRefreshInFlight = null;
    }

    if (state.pendingTabRefresh) {
      state.pendingTabRefresh = false;
      await refreshActiveTabView();
    }
  }

  function scheduleTabRefresh() {
    if (state.tabRefreshTimer) {
      clearTimeout(state.tabRefreshTimer);
    }
    state.tabRefreshTimer = setTimeout(async function onTabRefreshTimeout() {
      state.tabRefreshTimer = null;
      await refreshActiveTabView();
    }, 60);
  }

  function bindEvents() {
    el.globalToggle.addEventListener('change', handleGlobalToggle);
    el.siteToggle.addEventListener('change', handleSiteToggle);
    el.btnForceDark.addEventListener('click', handleForceDarkToggle);
    el.btnResetAdjustments.addEventListener('click', handleResetAdjustments);

    if (el.btnOpenSidepanel) {
      el.btnOpenSidepanel.addEventListener('click', async function onSidepanelClick() {
        if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && state.windowId !== null) {
          try {
            // Must be called immediately before any await to preserve the user gesture
            await chrome.sidePanel.open({ windowId: state.windowId });
            return;
          } catch (_) {
            // Fall back to Vivaldi Setup guide if sidePanel cannot open in this browser mode
          }
        }
        await openOptionsPage('vivaldi');
      });
    }

    el.btnOpenOptions.addEventListener('click', async function onGearClick() {
      await openOptionsPage();
    });
    el.btnFooterOptions.addEventListener('click', async function onFooterOptionsClick() {
      await openOptionsPage();
    });
    el.btnCustomCss.addEventListener('click', async function onCustomCssClick() {
      await openOptionsPage('custom-css', state.supported ? state.hostname : '');
    });

    el.modePills.addEventListener('click', async function onModeClick(event) {
      const btn = event.target.closest('.seg-btn');
      if (!btn || btn.disabled) return;
      const mode = btn.dataset.mode;
      if (mode) {
        await handleModeSelect(mode);
      }
    });

    el.presetSwatches.addEventListener('click', async function onPresetClick(event) {
      const btn = event.target.closest('.swatch-btn');
      if (!btn) return;
      const preset = btn.dataset.preset;
      if (preset) {
        await handlePresetSelect(preset);
      }
    });

    el.sliderBrightness.addEventListener('input', function onBrightnessInput() {
      const val = Number(el.sliderBrightness.value);
      el.valBrightness.textContent = `${val}%`;
      queueSettingsPatch({ brightness: val }, false);
    });
    el.sliderBrightness.addEventListener('change', flushPendingSettings);

    el.sliderContrast.addEventListener('input', function onContrastInput() {
      const val = Number(el.sliderContrast.value);
      el.valContrast.textContent = `${val}%`;
      queueSettingsPatch({ contrast: val }, false);
    });
    el.sliderContrast.addEventListener('change', flushPendingSettings);

    el.sliderSepia.addEventListener('input', function onSepiaInput() {
      const val = Number(el.sliderSepia.value);
      el.valSepia.textContent = `${val}%`;
      queueSettingsPatch({ sepia: val }, false);
    });
    el.sliderSepia.addEventListener('change', flushPendingSettings);

    el.sliderImageBrightness.addEventListener('input', function onImageBrightnessInput() {
      const val = Number(el.sliderImageBrightness.value);
      el.valImageBrightness.textContent = `${val}%`;
      queueSettingsPatch({ imageBrightness: val }, false);
    });
    el.sliderImageBrightness.addEventListener('change', flushPendingSettings);

    el.toggleDimImages.addEventListener('change', function onDimChange() {
      queueSettingsPatch({ dimImages: Boolean(el.toggleDimImages.checked) }, true);
    });

    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function onRuntimeMessage(message) {
        if (message && message.type === MSG.SETTINGS_UPDATED && message.payload && message.payload.settings) {
          state.settings = Object.assign({}, DEFAULTS, message.payload.settings);
          state.effectiveEnabled = Boolean(state.settings.enabled) && !computeFallbackScheduleBlocked(state.settings);
          render();
        }
      });
    }

    if (chrome.tabs && chrome.tabs.onActivated) {
      chrome.tabs.onActivated.addListener(function onTabActivated() {
        scheduleTabRefresh();
      });
    }

    if (chrome.tabs && chrome.tabs.onUpdated) {
      chrome.tabs.onUpdated.addListener(function onTabUpdated(tabId, changeInfo) {
        if (tabId === state.tabId && changeInfo && (changeInfo.status === 'complete' || changeInfo.url)) {
          scheduleTabRefresh();
        }
      });
    }

    if (chrome.windows && chrome.windows.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(function onWindowFocusChanged(windowId) {
        if (typeof windowId === 'number' && windowId >= 0) {
          scheduleTabRefresh();
        }
      });
    }

    window.addEventListener('resize', detectPanelLayout);
  }

  document.addEventListener('DOMContentLoaded', async function onPopupReady() {
    detectPanelLayout();
    cacheElements();
    bindEvents();
    await loadInitialState();
  });
})();
