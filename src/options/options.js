(function initOptionsModule() {
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
    GET_CUSTOM_CSS: 'GET_CUSTOM_CSS',
    SET_CUSTOM_CSS: 'SET_CUSTOM_CSS',
    GET_ALL_CUSTOM_CSS: 'GET_ALL_CUSTOM_CSS',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    RESET_SETTINGS: 'RESET_SETTINGS'
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

  const PRESETS = Constants.THEME_PRESETS || {
    midnight: {
      name: 'Midnight',
      bg: '#121418',
      elevated: '#1a1d24',
      subtle: '#222630',
      border: '#2e3442',
      text: '#e6e9ef',
      secondary: '#a8b0c0',
      link: '#7ab3ff',
      accent: '#6c8cff'
    },
    oled: {
      name: 'OLED',
      bg: '#000000',
      elevated: '#0c0c0e',
      subtle: '#16161a',
      border: '#26262e',
      text: '#f0f0f5',
      secondary: '#a0a0b0',
      link: '#66b2ff',
      accent: '#5c9eff'
    },
    warm: {
      name: 'Warm',
      bg: '#181512',
      elevated: '#221e19',
      subtle: '#2c2620',
      border: '#3d352d',
      text: '#ebe3d5',
      secondary: '#b8aa96',
      link: '#e0a96d',
      accent: '#d99b52'
    },
    slate: {
      name: 'Slate',
      bg: '#0f172a',
      elevated: '#1e293b',
      subtle: '#273549',
      border: '#3b4b63',
      text: '#f1f5f9',
      secondary: '#94a3b8',
      link: '#38bdf8',
      accent: '#60a5fa'
    },
    nord: {
      name: 'Nord',
      bg: '#242933',
      elevated: '#2e3440',
      subtle: '#3b4252',
      border: '#4c566a',
      text: '#eceff4',
      secondary: '#d8dee9',
      link: '#88c0d0',
      accent: '#81a1c1'
    }
  };

  const state = {
    settings: cloneSettings(DEFAULTS),
    themes: [],
    customCssMap: {},
    activeSection: 'general',
    isVivaldi: false,
    currentWindowId: null,
    sliderTimer: null,
    pendingSliderPatch: {},
    themeSearchTimer: null,
    rulesSearchTimer: null,
    toastTimer: null
  };

  const el = {};

  function cloneSettings(src) {
    return {
      enabled: Boolean(src.enabled),
      preset: src.preset || 'midnight',
      defaultMode: src.defaultMode || 'auto',
      autoDetectNativeDark: typeof src.autoDetectNativeDark === 'boolean' ? src.autoDetectNativeDark : true,
      dimImages: typeof src.dimImages === 'boolean' ? src.dimImages : true,
      brightness: clampNum(src.brightness, 50, 130, 100),
      contrast: clampNum(src.contrast, 70, 140, 100),
      sepia: clampNum(src.sepia, 0, 60, 0),
      imageBrightness: clampNum(src.imageBrightness, 50, 100, 90),
      grayscale: clampNum(src.grayscale, 0, 100, 0),
      schedule: Object.assign(
        { mode: 'off', startTime: '20:00', endTime: '07:00' },
        src.schedule || {}
      ),
      disabledThemes: Array.isArray(src.disabledThemes) ? src.disabledThemes.slice() : [],
      siteRules: src.siteRules && typeof src.siteRules === 'object'
        ? Object.assign({}, src.siteRules)
        : {}
    };
  }

  function clampNum(value, min, max, fallback) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, Math.round(num)));
  }

  function cacheElements() {
    el.sidebarNav = document.getElementById('sidebar-nav');
    el.sidebarGlobalToggle = document.getElementById('sidebar-global-toggle');
    el.sidebarPowerStatus = document.getElementById('sidebar-power-status');
    el.badgeThemesCount = document.getElementById('badge-themes-count');
    el.badgeRulesCount = document.getElementById('badge-rules-count');
    el.badgeCssCount = document.getElementById('badge-css-count');

    el.toastBanner = document.getElementById('toast-banner');
    el.toastMessage = document.getElementById('toast-message');
    el.toastActions = document.getElementById('toast-actions');

    // General
    el.optEnabled = document.getElementById('opt-enabled');
    el.optAutoDetect = document.getElementById('opt-auto-detect');
    el.optDimImages = document.getElementById('opt-dim-images');
    el.defaultModeGrid = document.getElementById('default-mode-grid');
    el.presetCardsGrid = document.getElementById('preset-cards-grid');
    el.optBrightness = document.getElementById('opt-brightness');
    el.optContrast = document.getElementById('opt-contrast');
    el.optSepia = document.getElementById('opt-sepia');
    el.optImageBrightness = document.getElementById('opt-image-brightness');
    el.optGrayscale = document.getElementById('opt-grayscale');
    el.optValBrightness = document.getElementById('opt-val-brightness');
    el.optValContrast = document.getElementById('opt-val-contrast');
    el.optValSepia = document.getElementById('opt-val-sepia');
    el.optValImageBrightness = document.getElementById('opt-val-image-brightness');
    el.optValGrayscale = document.getElementById('opt-val-grayscale');
    el.optBtnResetSliders = document.getElementById('opt-btn-reset-sliders');
    el.previewPresetTag = document.getElementById('preview-preset-tag');
    el.livePreviewCanvas = document.getElementById('live-preview-canvas');
    el.livePreviewMedia = document.getElementById('live-preview-media');

    // Themes
    el.themesSummaryStat = document.getElementById('themes-summary-stat');
    el.themeSearch = document.getElementById('theme-search');
    el.themeCategoryFilter = document.getElementById('theme-category-filter');
    el.btnEnableAllThemes = document.getElementById('btn-enable-all-themes');
    el.btnDisableAllThemes = document.getElementById('btn-disable-all-themes');
    el.themesGrid = document.getElementById('themes-grid');
    el.themesEmpty = document.getElementById('themes-empty');

    // Site Rules
    el.addRuleForm = document.getElementById('add-rule-form');
    el.ruleDomainInput = document.getElementById('rule-domain-input');
    el.ruleModeSelect = document.getElementById('rule-mode-select');
    el.ruleStatusSelect = document.getElementById('rule-status-select');
    el.ruleForceNative = document.getElementById('rule-force-native');
    el.rulesSearch = document.getElementById('rules-search');
    el.rulesTbody = document.getElementById('rules-tbody');
    el.rulesEmpty = document.getElementById('rules-empty');

    // Schedule
    el.scheduleLivePill = document.getElementById('schedule-live-pill');
    el.scheduleModes = document.getElementById('schedule-modes');
    el.timeScheduleInputs = document.getElementById('time-schedule-inputs');
    el.scheduleStart = document.getElementById('schedule-start');
    el.scheduleEnd = document.getElementById('schedule-end');
    el.btnOpenShortcuts = document.getElementById('btn-open-shortcuts');

    // Custom CSS
    el.customCssHost = document.getElementById('custom-css-host');
    el.customCssEditor = document.getElementById('custom-css-editor');
    el.btnInsertCssSnippet = document.getElementById('btn-insert-css-snippet');
    el.btnSaveCustomCss = document.getElementById('btn-save-custom-css');
    el.btnClearCustomCss = document.getElementById('btn-clear-custom-css');
    el.btnRefreshCustomCss = document.getElementById('btn-refresh-custom-css');
    el.customCssList = document.getElementById('custom-css-list');
    el.customCssEmpty = document.getElementById('custom-css-empty');

    // Vivaldi Setup
    el.vivaldiBrowserBadge = document.getElementById('vivaldi-browser-badge');
    el.vivaldiPanelUrl = document.getElementById('vivaldi-panel-url');
    el.btnCopyPanelUrl = document.getElementById('btn-copy-panel-url');
    el.btnVivaldiOpenSidepanel = document.getElementById('btn-vivaldi-open-sidepanel');
    el.btnOpenVivaldiAppearance = document.getElementById('btn-open-vivaldi-appearance');
    el.btnOpenVivaldiExtensions = document.getElementById('btn-open-vivaldi-extensions');
    el.btnVivaldiOpenShortcuts = document.getElementById('btn-vivaldi-open-shortcuts');

    // Backup & Reset
    el.btnExportJson = document.getElementById('btn-export-json');
    el.importFileInput = document.getElementById('import-file-input');
    el.btnImportTrigger = document.getElementById('btn-import-trigger');
    el.importFileStatus = document.getElementById('import-file-status');
    el.btnResetAllTrigger = document.getElementById('btn-reset-all-trigger');
    el.resetConfirmBar = document.getElementById('reset-confirm-bar');
    el.btnResetConfirm = document.getElementById('btn-reset-confirm');
    el.btnResetCancel = document.getElementById('btn-reset-cancel');
  }

  function showToast(message, variant, actionLabel, onAction) {
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }

    el.toastMessage.textContent = message;
    el.toastActions.textContent = '';

    if (actionLabel && typeof onAction === 'function') {
      const actionBtn = document.createElement('button');
      actionBtn.type = 'button';
      actionBtn.className = 'btn btn-secondary btn-sm';
      actionBtn.textContent = actionLabel;
      actionBtn.addEventListener('click', async function onToastActionClick() {
        hideToast();
        await onAction();
      });
      el.toastActions.appendChild(actionBtn);
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'btn btn-ghost btn-sm';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', hideToast);
    el.toastActions.appendChild(dismissBtn);

    const cls = variant === 'error'
      ? 'toast-banner is-error'
      : variant === 'warn'
        ? 'toast-banner is-warn'
        : 'toast-banner is-success';
    el.toastBanner.className = cls;

    state.toastTimer = setTimeout(hideToast, 4500);
  }

  function hideToast() {
    if (state.toastTimer) {
      clearTimeout(state.toastTimer);
      state.toastTimer = null;
    }
    el.toastBanner.className = 'toast-banner hidden';
    el.toastMessage.textContent = '';
    el.toastActions.textContent = '';
  }

  async function sendRuntime(type, payload) {
    try {
      const resp = await chrome.runtime.sendMessage({ type, payload: payload || {} });
      return resp || { ok: false };
    } catch (err) {
      return { ok: false, error: err && err.message ? err.message : String(err) };
    }
  }

  function normalizeDomainInput(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) {
      if (typeof SiteMatcher.extractHostname === 'function') {
        return SiteMatcher.extractHostname(trimmed);
      }
      try {
        return new URL(trimmed).hostname.replace(/^www\./i, '').toLowerCase();
      } catch (_) {
        return '';
      }
    }
    const noPath = trimmed.split('/')[0].split(':')[0];
    if (noPath.startsWith('*.')) {
      return noPath.toLowerCase();
    }
    if (typeof SiteMatcher.normalizeHostname === 'function') {
      return SiteMatcher.normalizeHostname(noPath);
    }
    return noPath.toLowerCase().replace(/^www\./, '');
  }

  function switchSection(sectionId) {
    const validSections = ['general', 'themes', 'site-rules', 'schedule', 'custom-css', 'vivaldi', 'backup'];
    const target = validSections.includes(sectionId) ? sectionId : 'general';
    state.activeSection = target;

    const navBtns = el.sidebarNav.querySelectorAll('.nav-item');
    for (const btn of navBtns) {
      btn.classList.toggle('is-active', btn.dataset.section === target);
    }

    for (const id of validSections) {
      const panel = document.getElementById(`section-${id}`);
      if (panel) {
        panel.classList.toggle('is-active', id === target);
      }
    }
  }

  function getSystemDark() {
    try {
      return Boolean(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch (_) {
      return false;
    }
  }

  async function loadThemesRegistry() {
    try {
      const url = chrome.runtime && typeof chrome.runtime.getURL === 'function'
        ? chrome.runtime.getURL('src/themes/sites/registry.json')
        : '../themes/sites/registry.json';
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      state.themes = Array.isArray(data) ? data : [];
    } catch (err) {
      state.themes = [];
      showToast('Could not load site themes registry.', 'warn');
    }
    populateCategoryFilter();
  }

  function populateCategoryFilter() {
    const current = el.themeCategoryFilter.value || 'all';
    const categories = Array.from(
      new Set(state.themes.map((item) => item.category).filter(Boolean))
    ).sort();

    el.themeCategoryFilter.textContent = '';
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All Categories';
    el.themeCategoryFilter.appendChild(allOpt);

    for (const cat of categories) {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      el.themeCategoryFilter.appendChild(opt);
    }

    el.themeCategoryFilter.value = categories.includes(current) ? current : 'all';
  }

  async function loadSettingsData() {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.sync &&
      typeof chrome.storage.sync.get === 'function' &&
      typeof Storage.getSettings === 'function'
    ) {
      try {
        const directSettings = await Storage.getSettings();
        if (directSettings && typeof directSettings === 'object') {
          state.settings = cloneSettings(directSettings);
          return;
        }
      } catch (_) {
        // Fall through to service worker lookup
      }
    }

    const settingsResp = await sendRuntime(MSG.GET_SETTINGS, {});
    if (settingsResp && settingsResp.ok && settingsResp.settings) {
      state.settings = cloneSettings(settingsResp.settings);
    } else if (typeof Storage.getSettings === 'function') {
      state.settings = cloneSettings(await Storage.getSettings());
    }
  }

  async function loadCustomCssData() {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.local &&
      typeof chrome.storage.local.get === 'function' &&
      typeof Storage.getAllCustomCss === 'function'
    ) {
      try {
        const directCss = await Storage.getAllCustomCss();
        if (directCss && typeof directCss === 'object') {
          state.customCssMap = Object.assign({}, directCss);
          return;
        }
      } catch (_) {
        // Fall through to service worker lookup
      }
    }

    const cssResp = await sendRuntime(MSG.GET_ALL_CUSTOM_CSS, {});
    if (cssResp && cssResp.ok && cssResp.map) {
      state.customCssMap = Object.assign({}, cssResp.map);
    } else if (typeof Storage.getAllCustomCss === 'function') {
      state.customCssMap = Object.assign({}, await Storage.getAllCustomCss());
    }
  }

  async function loadAllData() {
    await Promise.all([
      loadSettingsData(),
      loadCustomCssData(),
      loadThemesRegistry(),
      detectVivaldiEnvironment()
    ]);
  }

  async function fetchCurrentWindow() {
    if (typeof chrome === 'undefined' || !chrome.windows || typeof chrome.windows.getCurrent !== 'function') {
      return null;
    }
    try {
      return await chrome.windows.getCurrent();
    } catch (_) {
      return null;
    }
  }

  async function fetchCurrentWindowTabs() {
    if (typeof chrome === 'undefined' || !chrome.tabs || typeof chrome.tabs.query !== 'function') {
      return null;
    }
    try {
      return await chrome.tabs.query({ currentWindow: true });
    } catch (_) {
      return null;
    }
  }

  async function detectVivaldiEnvironment() {
    let detected = typeof navigator !== 'undefined' && /Vivaldi/i.test(navigator.userAgent || '');

    const [win, tabs] = await Promise.all([
      fetchCurrentWindow(),
      fetchCurrentWindowTabs()
    ]);

    if (win && typeof win.id === 'number') {
      state.currentWindowId = win.id;
    }

    if (Array.isArray(tabs)) {
      for (const t of tabs) {
        if (t && typeof t === 'object' && 'vivExtData' in t) {
          detected = true;
        }
        if (state.currentWindowId === null && t && typeof t.windowId === 'number') {
          state.currentWindowId = t.windowId;
        }
      }
    }

    state.isVivaldi = detected;
    renderVivaldiSection();
  }

  function renderVivaldiSection() {
    if (el.vivaldiPanelUrl) {
      const panelUrl = chrome.runtime && typeof chrome.runtime.getURL === 'function'
        ? chrome.runtime.getURL('src/popup/popup.html?panel=1')
        : '../popup/popup.html?panel=1';
      el.vivaldiPanelUrl.value = panelUrl;
    }
    if (el.vivaldiBrowserBadge) {
      if (state.isVivaldi) {
        el.vivaldiBrowserBadge.textContent = 'Vivaldi Detected';
        el.vivaldiBrowserBadge.classList.add('is-vivaldi');
      } else {
        el.vivaldiBrowserBadge.textContent = 'Chromium Browser';
        el.vivaldiBrowserBadge.classList.remove('is-vivaldi');
      }
    }
  }

  async function copyTextToClipboard(text) {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {
        // Fall through to input copy fallback
      }
    }
    return false;
  }

  async function openBrowserInternalPage(targetUrl, fallbackPromptText) {
    if (targetUrl.startsWith('vivaldi://') && !state.isVivaldi) {
      const copied = await copyTextToClipboard(targetUrl);
      showToast(
        copied
          ? `Copied ${targetUrl} — open it in Vivaldi's address bar.`
          : (fallbackPromptText || `Open ${targetUrl} in Vivaldi's address bar.`),
        'warn'
      );
      return;
    }
    try {
      await chrome.tabs.create({ url: targetUrl });
    } catch (_) {
      const copied = await copyTextToClipboard(targetUrl);
      showToast(
        copied
          ? `Copied ${targetUrl} — paste it into your address bar.`
          : (fallbackPromptText || `Open ${targetUrl} in your address bar.`),
        'warn'
      );
    }
  }

  function renderBadges() {
    const disabledSet = new Set(state.settings.disabledThemes || []);
    const activeThemes = state.themes.filter((t) => !disabledSet.has(t.id)).length;
    el.badgeThemesCount.textContent = `${activeThemes}/${state.themes.length}`;
    el.badgeRulesCount.textContent = String(Object.keys(state.settings.siteRules || {}).length);
    el.badgeCssCount.textContent = String(Object.keys(state.customCssMap || {}).length);
  }

  function renderGeneralSection() {
    const s = state.settings;
    const preset = PRESETS[s.preset] ? s.preset : 'midnight';
    document.documentElement.dataset.preset = preset;

    el.sidebarGlobalToggle.checked = Boolean(s.enabled);
    el.optEnabled.checked = Boolean(s.enabled);
    el.optAutoDetect.checked = Boolean(s.autoDetectNativeDark);
    el.optDimImages.checked = Boolean(s.dimImages);

    const scheduleActive = typeof Schedule.isScheduleActive === 'function'
      ? Schedule.isScheduleActive(s.schedule, getSystemDark(), new Date())
      : true;

    if (!s.enabled) {
      el.sidebarPowerStatus.textContent = 'Paused';
      el.sidebarPowerStatus.classList.add('is-off');
    } else if (!scheduleActive) {
      el.sidebarPowerStatus.textContent = 'Scheduled Off';
      el.sidebarPowerStatus.classList.add('is-off');
    } else {
      el.sidebarPowerStatus.textContent = 'Active';
      el.sidebarPowerStatus.classList.remove('is-off');
    }

    const modeCards = el.defaultModeGrid.querySelectorAll('.mode-card');
    for (const card of modeCards) {
      const active = card.dataset.mode === s.defaultMode;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-checked', active ? 'true' : 'false');
    }

    const presetCards = el.presetCardsGrid.querySelectorAll('.preset-card');
    for (const card of presetCards) {
      const active = card.dataset.preset === preset;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-checked', active ? 'true' : 'false');
    }

    el.optBrightness.value = String(s.brightness);
    el.optContrast.value = String(s.contrast);
    el.optSepia.value = String(s.sepia);
    el.optImageBrightness.value = String(s.imageBrightness);
    el.optGrayscale.value = String(s.grayscale);

    el.optValBrightness.textContent = `${s.brightness}%`;
    el.optValContrast.textContent = `${s.contrast}%`;
    el.optValSepia.textContent = `${s.sepia}%`;
    el.optValImageBrightness.textContent = `${s.imageBrightness}%`;
    el.optValGrayscale.textContent = `${s.grayscale}%`;

    renderLivePreview();
  }

  function renderLivePreview() {
    const s = state.settings;
    const palette = PRESETS[s.preset] || PRESETS.midnight;
    el.previewPresetTag.textContent = palette.name || s.preset;

    const canvas = el.livePreviewCanvas;
    canvas.style.backgroundColor = palette.bg;
    canvas.style.color = palette.text;
    canvas.style.filter = `brightness(${s.brightness}%) contrast(${s.contrast}%) sepia(${s.sepia}%) grayscale(${s.grayscale}%)`;

    const h3 = canvas.querySelector('.preview-h3');
    const pSub = canvas.querySelector('.preview-p-sub');
    const link = canvas.querySelector('.preview-link');
    const input = canvas.querySelector('.preview-input');
    const cta = canvas.querySelector('.preview-cta');

    if (h3) h3.style.color = palette.text;
    if (pSub) pSub.style.color = palette.secondary;
    if (link) link.style.color = palette.link;
    if (input) {
      input.style.backgroundColor = palette.subtle;
      input.style.border = `1px solid ${palette.border}`;
      input.style.color = palette.secondary;
    }
    if (cta) {
      cta.style.backgroundColor = palette.accent;
    }

    const imgBright = s.dimImages ? s.imageBrightness : 100;
    const svg = el.livePreviewMedia.querySelector('svg');
    if (svg) {
      svg.style.filter = `brightness(${imgBright}%)`;
    }
  }

  function getFilteredThemes() {
    const query = (el.themeSearch.value || '').trim().toLowerCase();
    const category = el.themeCategoryFilter.value || 'all';

    return state.themes.filter((theme) => {
      if (category !== 'all' && theme.category !== category) {
        return false;
      }
      if (!query) return true;
      const domains = Array.isArray(theme.domains) ? theme.domains.join(' ') : '';
      const haystack = `${theme.name || ''} ${theme.id || ''} ${theme.category || ''} ${theme.description || ''} ${domains}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  function renderThemesSection() {
    if (state.themeSearchTimer) {
      clearTimeout(state.themeSearchTimer);
      state.themeSearchTimer = null;
    }
    const filtered = getFilteredThemes();
    const disabledSet = new Set(state.settings.disabledThemes || []);
    const activeCount = state.themes.filter((t) => !disabledSet.has(t.id)).length;
    el.themesSummaryStat.textContent = `${activeCount} of ${state.themes.length} active`;

    el.themesGrid.textContent = '';
    el.themesEmpty.classList.toggle('hidden', filtered.length > 0);

    const fragment = typeof document.createDocumentFragment === 'function'
      ? document.createDocumentFragment()
      : null;
    const container = fragment || el.themesGrid;

    for (const theme of filtered) {
      const isEnabled = !disabledSet.has(theme.id);
      const card = document.createElement('article');
      card.className = isEnabled ? 'theme-card' : 'theme-card is-disabled';

      const top = document.createElement('div');
      top.className = 'theme-card-top';

      const info = document.createElement('div');
      const title = document.createElement('h3');
      title.className = 'theme-name';
      title.textContent = theme.name || theme.id;

      const catBadge = document.createElement('span');
      catBadge.className = 'theme-category';
      catBadge.textContent = theme.category || 'General';

      info.appendChild(title);
      info.appendChild(catBadge);

      const switchLabel = document.createElement('label');
      switchLabel.className = 'switch';
      switchLabel.title = isEnabled ? `Disable ${theme.name} theme` : `Enable ${theme.name} theme`;

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = isEnabled;
      checkbox.setAttribute('aria-label', `Toggle ${theme.name || theme.id} theme`);
      checkbox.addEventListener('change', async function onThemeToggle() {
        await toggleThemeEnabled(theme.id, checkbox.checked);
      });

      const track = document.createElement('span');
      track.className = 'switch-track';
      const thumb = document.createElement('span');
      thumb.className = 'switch-thumb';
      track.appendChild(thumb);
      switchLabel.appendChild(checkbox);
      switchLabel.appendChild(track);

      top.appendChild(info);
      top.appendChild(switchLabel);

      const desc = document.createElement('p');
      desc.className = 'theme-desc';
      desc.textContent = theme.description || '';

      const domainWrap = document.createElement('div');
      domainWrap.className = 'domain-badges';
      const domains = Array.isArray(theme.domains) ? theme.domains : [];
      const shownDomains = domains.slice(0, 5);
      for (const dom of shownDomains) {
        const b = document.createElement('span');
        b.className = 'domain-badge';
        b.textContent = dom;
        domainWrap.appendChild(b);
      }
      if (domains.length > shownDomains.length) {
        const more = document.createElement('span');
        more.className = 'domain-badge';
        more.title = domains.join(', ');
        more.textContent = `+${domains.length - shownDomains.length} more`;
        domainWrap.appendChild(more);
      }

      card.appendChild(top);
      card.appendChild(desc);
      card.appendChild(domainWrap);
      container.appendChild(card);
    }

    if (fragment) {
      el.themesGrid.appendChild(fragment);
    }
  }

  async function toggleThemeEnabled(themeId, enable) {
    const disabledSet = new Set(state.settings.disabledThemes || []);
    if (enable) {
      disabledSet.delete(themeId);
    } else {
      disabledSet.add(themeId);
    }
    const nextDisabled = Array.from(disabledSet);
    const resp = await sendRuntime(MSG.UPDATE_SETTINGS, {
      patch: { disabledThemes: nextDisabled }
    });
    if (resp && resp.ok && resp.settings) {
      state.settings = cloneSettings(resp.settings);
    } else {
      state.settings.disabledThemes = nextDisabled;
    }
    renderBadges();
    renderThemesSection();
  }

  async function setAllFilteredThemes(enable) {
    const filtered = getFilteredThemes();
    const disabledSet = new Set(state.settings.disabledThemes || []);
    for (const theme of filtered) {
      if (enable) {
        disabledSet.delete(theme.id);
      } else {
        disabledSet.add(theme.id);
      }
    }
    const nextDisabled = Array.from(disabledSet);
    const resp = await sendRuntime(MSG.UPDATE_SETTINGS, {
      patch: { disabledThemes: nextDisabled }
    });
    if (resp && resp.ok && resp.settings) {
      state.settings = cloneSettings(resp.settings);
    } else {
      state.settings.disabledThemes = nextDisabled;
    }
    renderBadges();
    renderThemesSection();
    showToast(enable ? 'Enabled matching site themes.' : 'Disabled matching site themes.', 'success');
  }

  function renderSiteRulesSection() {
    if (state.rulesSearchTimer) {
      clearTimeout(state.rulesSearchTimer);
      state.rulesSearchTimer = null;
    }
    const rulesMap = state.settings.siteRules || {};
    const query = (el.rulesSearch.value || '').trim().toLowerCase();
    const hostnames = Object.keys(rulesMap)
      .filter((h) => !query || h.toLowerCase().includes(query))
      .sort();

    el.rulesTbody.textContent = '';
    el.rulesEmpty.classList.toggle('hidden', hostnames.length > 0);

    const fragment = typeof document.createDocumentFragment === 'function'
      ? document.createDocumentFragment()
      : null;
    const container = fragment || el.rulesTbody;

    for (const hostname of hostnames) {
      const rule = rulesMap[hostname] || { enabled: true, mode: 'auto' };
      const tr = document.createElement('tr');

      // Domain cell
      const tdDomain = document.createElement('td');
      const domainWrap = document.createElement('div');
      domainWrap.className = 'rule-domain-cell';

      const domName = document.createElement('span');
      domName.className = 'rule-domain-name';
      domName.textContent = hostname;
      domainWrap.appendChild(domName);

      if (typeof SiteMatcher.findMatchingTheme === 'function' && state.themes.length > 0) {
        const matched = SiteMatcher.findMatchingTheme(hostname, state.themes, []);
        if (matched) {
          const matchBadge = document.createElement('span');
          matchBadge.className = 'rule-theme-match';
          matchBadge.textContent = `Curated theme: ${matched.name}`;
          domainWrap.appendChild(matchBadge);
        }
      }
      tdDomain.appendChild(domainWrap);

      // Mode cell
      const tdMode = document.createElement('td');
      const modeSelect = document.createElement('select');
      modeSelect.className = 'select-field inline-select';
      modeSelect.setAttribute('aria-label', `Engine mode for ${hostname}`);
      for (const optVal of ['auto', 'dynamic', 'filter']) {
        const opt = document.createElement('option');
        opt.value = optVal;
        opt.textContent = optVal.charAt(0).toUpperCase() + optVal.slice(1);
        modeSelect.appendChild(opt);
      }
      modeSelect.value = rule.mode || 'auto';
      modeSelect.addEventListener('change', async function onRuleModeChange() {
        await saveSiteRule(hostname, Object.assign({}, rule, { mode: modeSelect.value }));
      });
      tdMode.appendChild(modeSelect);

      // Force native dark cell
      const tdForce = document.createElement('td');
      const forceCheck = document.createElement('input');
      forceCheck.type = 'checkbox';
      forceCheck.checked = Boolean(rule.forceOverrideNativeDark);
      forceCheck.setAttribute('aria-label', `Force dark mode over native dark on ${hostname}`);
      forceCheck.addEventListener('change', async function onRuleForceChange() {
        await saveSiteRule(
          hostname,
          Object.assign({}, rule, { forceOverrideNativeDark: forceCheck.checked })
        );
      });
      tdForce.appendChild(forceCheck);

      // Enabled cell
      const tdEnabled = document.createElement('td');
      const sw = document.createElement('label');
      sw.className = 'switch';
      const swInput = document.createElement('input');
      swInput.type = 'checkbox';
      swInput.checked = rule.enabled !== false;
      swInput.setAttribute('aria-label', `Toggle rule for ${hostname}`);
      swInput.addEventListener('change', async function onRuleEnabledChange() {
        await saveSiteRule(hostname, Object.assign({}, rule, { enabled: swInput.checked }));
      });
      const track = document.createElement('span');
      track.className = 'switch-track';
      const thumb = document.createElement('span');
      thumb.className = 'switch-thumb';
      track.appendChild(thumb);
      sw.appendChild(swInput);
      sw.appendChild(track);
      tdEnabled.appendChild(sw);

      // Actions cell
      const tdActions = document.createElement('td');
      tdActions.className = 'col-actions';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async function onRuleDeleteClick() {
        await deleteSiteRule(hostname, rule);
      });
      tdActions.appendChild(delBtn);

      tr.appendChild(tdDomain);
      tr.appendChild(tdMode);
      tr.appendChild(tdForce);
      tr.appendChild(tdEnabled);
      tr.appendChild(tdActions);
      container.appendChild(tr);
    }

    if (fragment) {
      el.rulesTbody.appendChild(fragment);
    }
  }

  async function saveSiteRule(hostname, rule) {
    const resp = await sendRuntime(MSG.SET_SITE_RULE, { hostname, rule });
    if (resp && resp.ok && resp.settings) {
      state.settings = cloneSettings(resp.settings);
    } else {
      state.settings.siteRules[hostname] = rule;
    }
    renderBadges();
    renderSiteRulesSection();
  }

  async function deleteSiteRule(hostname, previousRule) {
    const resp = await sendRuntime(MSG.DELETE_SITE_RULE, { hostname });
    if (resp && resp.ok && resp.settings) {
      state.settings = cloneSettings(resp.settings);
    } else {
      delete state.settings.siteRules[hostname];
    }
    renderBadges();
    renderSiteRulesSection();
    showToast(`Deleted rule for ${hostname}.`, 'success', 'Undo', async function undoDelete() {
      await saveSiteRule(hostname, previousRule);
      showToast(`Restored rule for ${hostname}.`, 'success');
    });
  }

  function renderScheduleSection() {
    const sched = state.settings.schedule || { mode: 'off', startTime: '20:00', endTime: '07:00' };
    const mode = sched.mode || 'off';

    const cards = el.scheduleModes.querySelectorAll('.radio-card');
    for (const card of cards) {
      const input = card.querySelector('input[type="radio"]');
      const matched = input && input.value === mode;
      if (input) input.checked = matched;
      card.classList.toggle('is-selected', matched);
    }

    el.scheduleStart.value = sched.startTime || '20:00';
    el.scheduleEnd.value = sched.endTime || '07:00';
    const isTime = mode === 'time';
    el.scheduleStart.disabled = !isTime;
    el.scheduleEnd.disabled = !isTime;
    el.timeScheduleInputs.classList.toggle('is-disabled', !isTime);

    const activeNow = typeof Schedule.isScheduleActive === 'function'
      ? Schedule.isScheduleActive(sched, getSystemDark(), new Date())
      : true;

    if (mode === 'off') {
      el.scheduleLivePill.textContent = 'Always Manual';
    } else if (mode === 'system') {
      el.scheduleLivePill.textContent = activeNow ? 'System Dark (Active)' : 'System Light (Paused)';
    } else {
      el.scheduleLivePill.textContent = activeNow
        ? `Scheduled Window Active (${sched.startTime}–${sched.endTime})`
        : `Outside Window (${sched.startTime}–${sched.endTime})`;
    }
  }

  function renderCustomCssSection() {
    const entries = Object.entries(state.customCssMap || {})
      .filter((entry) => typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));

    el.customCssList.textContent = '';
    el.customCssEmpty.classList.toggle('hidden', entries.length > 0);

    for (const [host, css] of entries) {
      const item = document.createElement('div');
      item.className = 'saved-css-item';

      const meta = document.createElement('div');
      meta.className = 'saved-css-meta';

      const hostEl = document.createElement('div');
      hostEl.className = 'saved-css-host';
      hostEl.textContent = host;

      const lines = css.split(/\r?\n/).length;
      const previewEl = document.createElement('div');
      previewEl.className = 'saved-css-preview';
      previewEl.textContent = `${lines} line${lines === 1 ? '' : 's'} · ${css.length} chars`;

      meta.appendChild(hostEl);
      meta.appendChild(previewEl);

      const actions = document.createElement('div');
      actions.className = 'saved-css-actions';

      const loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'btn btn-secondary btn-sm';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', function onLoadCssClick() {
        el.customCssHost.value = host;
        el.customCssEditor.value = css;
        el.customCssEditor.focus();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = 'Delete';
      delBtn.addEventListener('click', async function onDeleteCssClick() {
        await saveCustomCss(host, '');
        if (normalizeDomainInput(el.customCssHost.value) === host) {
          el.customCssEditor.value = '';
        }
        showToast(`Removed custom CSS for ${host}.`, 'success');
      });

      actions.appendChild(loadBtn);
      actions.appendChild(delBtn);

      item.appendChild(meta);
      item.appendChild(actions);
      el.customCssList.appendChild(item);
    }
  }

  async function saveCustomCss(rawHost, css) {
    const hostname = normalizeDomainInput(rawHost);
    if (!hostname) {
      showToast('Please enter a valid target hostname (e.g. amazon.com).', 'warn');
      return false;
    }

    const resp = await sendRuntime(MSG.SET_CUSTOM_CSS, { hostname, css });
    if (!resp || !resp.ok) {
      if (typeof Storage.setCustomCss === 'function') {
        await Storage.setCustomCss(hostname, css);
      } else {
        showToast('Failed to save custom CSS.', 'error');
        return false;
      }
    }

    if (css && css.trim().length > 0) {
      state.customCssMap[hostname] = css;
    } else {
      delete state.customCssMap[hostname];
    }

    renderBadges();
    renderCustomCssSection();
    return true;
  }

  function renderAll() {
    renderBadges();
    renderGeneralSection();
    renderThemesSection();
    renderSiteRulesSection();
    renderScheduleSection();
    renderCustomCssSection();
    renderVivaldiSection();
  }

  async function updateSettingsPatch(patch) {
    const resp = await sendRuntime(MSG.UPDATE_SETTINGS, { patch });
    if (resp && resp.ok && resp.settings) {
      state.settings = cloneSettings(resp.settings);
    } else {
      Object.assign(state.settings, patch);
    }
    renderBadges();
    renderGeneralSection();
    renderScheduleSection();
  }

  function flushPendingSliders() {
    if (state.sliderTimer) {
      clearTimeout(state.sliderTimer);
      state.sliderTimer = null;
    }
    const keys = Object.keys(state.pendingSliderPatch);
    if (keys.length === 0) return;

    const patch = Object.assign({}, state.pendingSliderPatch);
    state.pendingSliderPatch = {};
    updateSettingsPatch(patch);
  }

  function queueSliderPatch(patch) {
    Object.assign(state.settings, patch);
    Object.assign(state.pendingSliderPatch, patch);
    renderLivePreview();

    if (state.sliderTimer) {
      clearTimeout(state.sliderTimer);
    }
    state.sliderTimer = setTimeout(flushPendingSliders, 120);
  }

  function validateImportedBackup(parsed) {
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, error: 'Backup JSON must be an object.' };
    }

    const rawSettings = parsed.settings && typeof parsed.settings === 'object'
      ? parsed.settings
      : ('enabled' in parsed || 'preset' in parsed || 'siteRules' in parsed ? parsed : null);

    if (!rawSettings || typeof rawSettings !== 'object' || Array.isArray(rawSettings)) {
      return { ok: false, error: 'Missing valid "settings" object in backup file.' };
    }

    const validPresets = Object.keys(PRESETS);
    const validModes = ['auto', 'dynamic', 'filter'];
    const validScheduleModes = ['off', 'system', 'time'];
    const timeRegex = /^\d{2}:\d{2}$/;

    const preset = validPresets.includes(rawSettings.preset) ? rawSettings.preset : DEFAULTS.preset;
    const defaultMode = validModes.includes(rawSettings.defaultMode) ? rawSettings.defaultMode : DEFAULTS.defaultMode;

    const rawSched = rawSettings.schedule && typeof rawSettings.schedule === 'object'
      ? rawSettings.schedule
      : DEFAULTS.schedule;
    const schedMode = validScheduleModes.includes(rawSched.mode) ? rawSched.mode : 'off';
    const startTime = typeof rawSched.startTime === 'string' && timeRegex.test(rawSched.startTime)
      ? rawSched.startTime
      : '20:00';
    const endTime = typeof rawSched.endTime === 'string' && timeRegex.test(rawSched.endTime)
      ? rawSched.endTime
      : '07:00';

    const sanitizedSiteRules = {};
    if (rawSettings.siteRules && typeof rawSettings.siteRules === 'object' && !Array.isArray(rawSettings.siteRules)) {
      for (const [hostKey, rawRule] of Object.entries(rawSettings.siteRules)) {
        const cleanHost = normalizeDomainInput(hostKey);
        if (!cleanHost || !rawRule || typeof rawRule !== 'object') continue;
        sanitizedSiteRules[cleanHost] = {
          enabled: rawRule.enabled !== false,
          mode: validModes.includes(rawRule.mode) ? rawRule.mode : 'auto',
          forceOverrideNativeDark: Boolean(rawRule.forceOverrideNativeDark)
        };
      }
    }

    const sanitizedSettings = {
      enabled: typeof rawSettings.enabled === 'boolean' ? rawSettings.enabled : DEFAULTS.enabled,
      preset,
      defaultMode,
      autoDetectNativeDark: typeof rawSettings.autoDetectNativeDark === 'boolean'
        ? rawSettings.autoDetectNativeDark
        : DEFAULTS.autoDetectNativeDark,
      dimImages: typeof rawSettings.dimImages === 'boolean' ? rawSettings.dimImages : DEFAULTS.dimImages,
      brightness: clampNum(rawSettings.brightness, 50, 130, DEFAULTS.brightness),
      contrast: clampNum(rawSettings.contrast, 70, 140, DEFAULTS.contrast),
      sepia: clampNum(rawSettings.sepia, 0, 60, DEFAULTS.sepia),
      imageBrightness: clampNum(rawSettings.imageBrightness, 50, 100, DEFAULTS.imageBrightness),
      grayscale: clampNum(rawSettings.grayscale, 0, 100, DEFAULTS.grayscale),
      schedule: { mode: schedMode, startTime, endTime },
      disabledThemes: Array.isArray(rawSettings.disabledThemes)
        ? rawSettings.disabledThemes.filter((id) => typeof id === 'string')
        : [],
      siteRules: sanitizedSiteRules
    };

    const sanitizedCss = {};
    if (parsed.customCssMap && typeof parsed.customCssMap === 'object' && !Array.isArray(parsed.customCssMap)) {
      for (const [hostKey, cssVal] of Object.entries(parsed.customCssMap)) {
        const cleanHost = normalizeDomainInput(hostKey);
        if (cleanHost && typeof cssVal === 'string' && cssVal.trim().length > 0) {
          sanitizedCss[cleanHost] = cssVal;
        }
      }
    }

    return { ok: true, settings: sanitizedSettings, customCssMap: sanitizedCss };
  }

  async function handleExportJson() {
    const payload = {
      app: 'DarkExtension',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      customCssMap: state.customCssMap
    };
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStamp = new Date().toISOString().slice(0, 10);

    const a = document.createElement('a');
    a.href = url;
    a.download = `darkextension-backup-${dateStamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Exported settings backup JSON.', 'success');
  }

  async function handleImportFile(file) {
    if (!file) return;
    el.importFileStatus.textContent = file.name;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const validated = validateImportedBackup(parsed);
      if (!validated.ok) {
        showToast(`Import failed: ${validated.error}`, 'error');
        return;
      }

      const resp = await sendRuntime(MSG.UPDATE_SETTINGS, { patch: validated.settings });
      if (resp && resp.ok && resp.settings) {
        state.settings = cloneSettings(resp.settings);
      } else {
        state.settings = cloneSettings(validated.settings);
      }

      for (const [host, css] of Object.entries(validated.customCssMap)) {
        await saveCustomCss(host, css);
      }

      renderAll();
      showToast('Settings backup imported successfully.', 'success');
    } catch (err) {
      showToast('Invalid JSON file. Could not import backup.', 'error');
    } finally {
      el.importFileInput.value = '';
    }
  }

  async function handleResetAllConfirmed() {
    el.resetConfirmBar.classList.add('hidden');
    const resp = await sendRuntime(MSG.RESET_SETTINGS, {});
    if (resp && resp.ok && resp.settings) {
      state.settings = cloneSettings(resp.settings);
    } else if (typeof Storage.resetAll === 'function') {
      state.settings = cloneSettings(await Storage.resetAll());
    } else {
      state.settings = cloneSettings(DEFAULTS);
    }

    const cssResp = await sendRuntime(MSG.GET_ALL_CUSTOM_CSS, {});
    if (cssResp && cssResp.ok && cssResp.map) {
      state.customCssMap = Object.assign({}, cssResp.map);
    } else {
      state.customCssMap = {};
    }

    el.customCssHost.value = '';
    el.customCssEditor.value = '';
    renderAll();
    showToast('All settings and custom rules have been reset to defaults.', 'success');
  }

  function applyQueryRoute() {
    const params = new URLSearchParams(window.location.search || '');
    const hashSection = (window.location.hash || '').replace(/^#(?:section-)?/, '');
    const section = params.get('section') || hashSection;
    const host = params.get('host');
    if (section) {
      switchSection(section);
    }
    if (host) {
      const cleanHost = normalizeDomainInput(host);
      el.customCssHost.value = cleanHost;
      if (state.customCssMap[cleanHost]) {
        el.customCssEditor.value = state.customCssMap[cleanHost];
      }
    }
  }

  /** Create a debounced event listener using a named timer slot in state. */
  function createDebouncedHandler(timerKey, delayMs, fn) {
    return function onDebouncedInput() {
      if (state[timerKey]) {
        clearTimeout(state[timerKey]);
      }
      state[timerKey] = setTimeout(function onDebouncedTimeout() {
        state[timerKey] = null;
        fn();
      }, delayMs);
    };
  }

  function bindEvents() {
    // Sidebar section navigation
    el.sidebarNav.addEventListener('click', function onNavClick(event) {
      const btn = event.target.closest('.nav-item');
      if (!btn || !btn.dataset.section) return;
      switchSection(btn.dataset.section);
    });

    // Global master switches
    el.sidebarGlobalToggle.addEventListener('change', async function onSidebarGlobalChange() {
      await updateSettingsPatch({ enabled: el.sidebarGlobalToggle.checked });
    });
    el.optEnabled.addEventListener('change', async function onOptEnabledChange() {
      await updateSettingsPatch({ enabled: el.optEnabled.checked });
    });
    el.optAutoDetect.addEventListener('change', async function onAutoDetectChange() {
      await updateSettingsPatch({ autoDetectNativeDark: el.optAutoDetect.checked });
    });
    el.optDimImages.addEventListener('change', async function onDimImagesChange() {
      await updateSettingsPatch({ dimImages: el.optDimImages.checked });
    });

    // Default engine mode cards
    el.defaultModeGrid.addEventListener('click', async function onDefaultModeClick(event) {
      const card = event.target.closest('.mode-card');
      if (!card || !card.dataset.mode) return;
      await updateSettingsPatch({ defaultMode: card.dataset.mode });
    });

    // Preset cards
    el.presetCardsGrid.addEventListener('click', async function onPresetCardClick(event) {
      const card = event.target.closest('.preset-card');
      if (!card || !card.dataset.preset) return;
      await updateSettingsPatch({ preset: card.dataset.preset });
    });

    // Adjustment sliders
    el.optBrightness.addEventListener('input', function onBrightInput() {
      const val = Number(el.optBrightness.value);
      el.optValBrightness.textContent = `${val}%`;
      queueSliderPatch({ brightness: val });
    });
    el.optBrightness.addEventListener('change', flushPendingSliders);

    el.optContrast.addEventListener('input', function onContrastInput() {
      const val = Number(el.optContrast.value);
      el.optValContrast.textContent = `${val}%`;
      queueSliderPatch({ contrast: val });
    });
    el.optContrast.addEventListener('change', flushPendingSliders);

    el.optSepia.addEventListener('input', function onSepiaInput() {
      const val = Number(el.optSepia.value);
      el.optValSepia.textContent = `${val}%`;
      queueSliderPatch({ sepia: val });
    });
    el.optSepia.addEventListener('change', flushPendingSliders);

    el.optImageBrightness.addEventListener('input', function onImgBrightInput() {
      const val = Number(el.optImageBrightness.value);
      el.optValImageBrightness.textContent = `${val}%`;
      queueSliderPatch({ imageBrightness: val });
    });
    el.optImageBrightness.addEventListener('change', flushPendingSliders);

    el.optGrayscale.addEventListener('input', function onGrayInput() {
      const val = Number(el.optGrayscale.value);
      el.optValGrayscale.textContent = `${val}%`;
      queueSliderPatch({ grayscale: val });
    });
    el.optGrayscale.addEventListener('change', flushPendingSliders);

    el.optBtnResetSliders.addEventListener('click', async function onResetSlidersClick() {
      state.pendingSliderPatch = {};
      if (state.sliderTimer) {
        clearTimeout(state.sliderTimer);
        state.sliderTimer = null;
      }
      await updateSettingsPatch({
        brightness: DEFAULTS.brightness,
        contrast: DEFAULTS.contrast,
        sepia: DEFAULTS.sepia,
        imageBrightness: DEFAULTS.imageBrightness,
        grayscale: DEFAULTS.grayscale,
        dimImages: DEFAULTS.dimImages
      });
      showToast('Adjustments restored to defaults.', 'success');
    });

    // Supported Site Themes
    el.themeSearch.addEventListener('input', createDebouncedHandler('themeSearchTimer', 80, renderThemesSection));
    el.themeCategoryFilter.addEventListener('change', renderThemesSection);
    el.btnEnableAllThemes.addEventListener('click', async function onEnableAllClick() {
      await setAllFilteredThemes(true);
    });
    el.btnDisableAllThemes.addEventListener('click', async function onDisableAllClick() {
      await setAllFilteredThemes(false);
    });

    // Site Rules
    el.addRuleForm.addEventListener('submit', async function onAddRuleSubmit(event) {
      event.preventDefault();
      const hostname = normalizeDomainInput(el.ruleDomainInput.value);
      if (!hostname) {
        showToast('Please enter a valid domain name (e.g. amazon.com).', 'warn');
        el.ruleDomainInput.focus();
        return;
      }
      const rule = {
        enabled: el.ruleStatusSelect.value !== 'disabled',
        mode: el.ruleModeSelect.value || 'auto',
        forceOverrideNativeDark: Boolean(el.ruleForceNative.checked)
      };
      await saveSiteRule(hostname, rule);
      el.ruleDomainInput.value = '';
      el.ruleForceNative.checked = false;
      showToast(`Saved rule for ${hostname}.`, 'success');
    });
    el.rulesSearch.addEventListener('input', createDebouncedHandler('rulesSearchTimer', 80, renderSiteRulesSection));

    // Schedule & Automation
    el.scheduleModes.addEventListener('change', async function onScheduleModeChange(event) {
      const target = event.target;
      if (!target || target.name !== 'schedule-mode') return;
      const nextSchedule = Object.assign({}, state.settings.schedule, {
        mode: target.value
      });
      await updateSettingsPatch({ schedule: nextSchedule });
    });

    el.scheduleStart.addEventListener('change', async function onStartTimeChange() {
      const nextSchedule = Object.assign({}, state.settings.schedule, {
        startTime: el.scheduleStart.value || '20:00'
      });
      await updateSettingsPatch({ schedule: nextSchedule });
    });

    el.scheduleEnd.addEventListener('change', async function onEndTimeChange() {
      const nextSchedule = Object.assign({}, state.settings.schedule, {
        endTime: el.scheduleEnd.value || '07:00'
      });
      await updateSettingsPatch({ schedule: nextSchedule });
    });

    el.btnOpenShortcuts.addEventListener('click', async function onOpenShortcutsClick() {
      await openBrowserInternalPage(
        'chrome://extensions/shortcuts',
        'Open chrome://extensions/shortcuts in your address bar to customize keys.'
      );
    });

    // Vivaldi Setup
    if (el.btnCopyPanelUrl) {
      el.btnCopyPanelUrl.addEventListener('click', async function onCopyPanelUrlClick() {
        const panelUrl = el.vivaldiPanelUrl ? el.vivaldiPanelUrl.value : '';
        if (!panelUrl) return;
        let copied = await copyTextToClipboard(panelUrl);
        if (!copied && el.vivaldiPanelUrl) {
          el.vivaldiPanelUrl.focus();
          el.vivaldiPanelUrl.select();
          try {
            copied = document.execCommand('copy');
          } catch (_) {
            copied = false;
          }
        }
        if (copied) {
          showToast('Copied Vivaldi Web Panel URL — click + on Vivaldi Panel bar and paste.', 'success');
        } else {
          showToast('Select and copy the Web Panel URL above.', 'warn');
        }
      });
    }

    if (el.btnVivaldiOpenSidepanel) {
      el.btnVivaldiOpenSidepanel.addEventListener('click', async function onVivaldiSidepanelClick() {
        if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function' && state.currentWindowId !== null) {
          try {
            await chrome.sidePanel.open({ windowId: state.currentWindowId });
            return;
          } catch (_) {
            // Fall through to helpful toast
          }
        }
        showToast('Use the Web Panel URL above (+) or the extension toolbar Side Panel icon in Vivaldi.', 'warn');
      });
    }

    if (el.btnOpenVivaldiAppearance) {
      el.btnOpenVivaldiAppearance.addEventListener('click', async function onOpenVivaldiAppearanceClick() {
        await openBrowserInternalPage(
          'vivaldi://settings/appearance/',
          'Open vivaldi://settings/appearance/ in Vivaldi to configure Website Appearance.'
        );
      });
    }

    if (el.btnOpenVivaldiExtensions) {
      el.btnOpenVivaldiExtensions.addEventListener('click', async function onOpenVivaldiExtensionsClick() {
        const target = state.isVivaldi ? 'vivaldi://extensions' : 'chrome://extensions';
        await openBrowserInternalPage(target, `Open ${target} in your browser address bar.`);
      });
    }

    if (el.btnVivaldiOpenShortcuts) {
      el.btnVivaldiOpenShortcuts.addEventListener('click', async function onVivaldiShortcutsClick() {
        await openBrowserInternalPage(
          'chrome://extensions/shortcuts',
          'Open chrome://extensions/shortcuts in your address bar to customize keys.'
        );
      });
    }

    // Custom CSS
    el.btnInsertCssSnippet.addEventListener('click', function onInsertSnippetClick() {
      const snippet = [
        '/* Custom override active when DarkExtension is enabled on this site */',
        'html[data-darkext-active="true"] body {',
        '  background-color: var(--de-bg) !important;',
        '  color: var(--de-text) !important;',
        '}',
        '',
        'html[data-darkext-active="true"] a {',
        '  color: var(--de-link) !important;',
        '}'
      ].join('\n');
      const existing = el.customCssEditor.value.trim();
      el.customCssEditor.value = existing ? `${el.customCssEditor.value}\n\n${snippet}` : snippet;
      el.customCssEditor.focus();
    });

    el.btnSaveCustomCss.addEventListener('click', async function onSaveCssClick() {
      const saved = await saveCustomCss(el.customCssHost.value, el.customCssEditor.value);
      if (saved) {
        const cleanHost = normalizeDomainInput(el.customCssHost.value);
        el.customCssHost.value = cleanHost;
        showToast(`Saved custom CSS for ${cleanHost}.`, 'success');
      }
    });

    el.btnClearCustomCss.addEventListener('click', async function onClearCssClick() {
      const hostname = normalizeDomainInput(el.customCssHost.value);
      if (!hostname) {
        el.customCssEditor.value = '';
        return;
      }
      const cleared = await saveCustomCss(hostname, '');
      if (cleared) {
        el.customCssEditor.value = '';
        showToast(`Cleared custom CSS for ${hostname}.`, 'success');
      }
    });

    el.btnRefreshCustomCss.addEventListener('click', async function onRefreshCssClick() {
      const cssResp = await sendRuntime(MSG.GET_ALL_CUSTOM_CSS, {});
      if (cssResp && cssResp.ok && cssResp.map) {
        state.customCssMap = Object.assign({}, cssResp.map);
      }
      renderBadges();
      renderCustomCssSection();
      showToast('Refreshed custom CSS list.', 'success');
    });

    el.customCssHost.addEventListener('change', async function onHostInputChange() {
      const cleanHost = normalizeDomainInput(el.customCssHost.value);
      if (!cleanHost) return;
      el.customCssHost.value = cleanHost;
      if (typeof state.customCssMap[cleanHost] === 'string') {
        el.customCssEditor.value = state.customCssMap[cleanHost];
        return;
      }
      const resp = await sendRuntime(MSG.GET_CUSTOM_CSS, { hostname: cleanHost });
      if (resp && resp.ok && typeof resp.css === 'string' && resp.css.length > 0) {
        state.customCssMap[cleanHost] = resp.css;
        el.customCssEditor.value = resp.css;
      }
    });

    // Backup & Reset
    el.btnExportJson.addEventListener('click', handleExportJson);
    el.btnImportTrigger.addEventListener('click', function onImportTriggerClick() {
      el.importFileInput.click();
    });
    el.importFileInput.addEventListener('change', async function onImportFileSelected() {
      const file = el.importFileInput.files && el.importFileInput.files[0];
      if (file) {
        await handleImportFile(file);
      }
    });

    el.btnResetAllTrigger.addEventListener('click', function onResetTriggerClick() {
      el.resetConfirmBar.classList.remove('hidden');
    });
    el.btnResetCancel.addEventListener('click', function onResetCancelClick() {
      el.resetConfirmBar.classList.add('hidden');
    });
    el.btnResetConfirm.addEventListener('click', handleResetAllConfirmed);

    // Sync updates from popup or background shortcuts
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function onRuntimeMessage(message) {
        if (message && message.type === MSG.SETTINGS_UPDATED && message.payload && message.payload.settings) {
          state.settings = cloneSettings(message.payload.settings);
          if (message.payload.customCssMap && typeof message.payload.customCssMap === 'object') {
            state.customCssMap = Object.assign({}, message.payload.customCssMap);
          }
          renderAll();
        }
      });
    }
  }

  document.addEventListener('DOMContentLoaded', async function onOptionsReady() {
    cacheElements();
    bindEvents();
    await loadAllData();
    applyQueryRoute();
    renderAll();
  });
})();
