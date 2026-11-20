'use strict';

(function initContentOrchestrator(global) {
  const DarkExt = (global.DarkExt = global.DarkExt || {});

  const Constants = DarkExt.Constants || {};
  const SiteMatcher = DarkExt.SiteMatcher || {};
  const Storage = DarkExt.Storage || {};
  const Detector = DarkExt.Detector || {};
  const DynamicEngine = DarkExt.DynamicEngine || {};

  const MSG = Constants.MESSAGE_TYPES || {
    GET_SETTINGS: 'GET_SETTINGS',
    INJECT_CSS_FILES: 'INJECT_CSS_FILES',
    REMOVE_CSS_FILES: 'REMOVE_CSS_FILES',
    REPORT_TAB_STATE: 'REPORT_TAB_STATE',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    GET_TAB_STATUS: 'GET_TAB_STATUS',
    SHOW_TOAST: 'SHOW_TOAST'
  };

  const PATHS = Constants.PATHS || {
    REGISTRY: 'src/themes/sites/registry.json',
    BASE_VARIABLES_CSS: 'src/themes/base/variables.css',
    UNIVERSAL_DYNAMIC_CSS: 'src/themes/base/universal-dynamic.css',
    UNIVERSAL_FILTER_CSS: 'src/themes/base/universal-filter.css'
  };

  let cachedRegistry = null;
  let injectedCssFiles = [];
  let currentSettings = null;
  let currentCustomCss = '';
  let lastAppliedState = {
    hostname: '',
    supported: false,
    active: false,
    mode: 'off',
    appliedThemeId: null,
    appliedThemeName: null,
    nativeDarkDetected: false,
    scheduleBlocked: false
  };

  let applyInFlight = null;
  let pendingReapply = false;
  let nativeCheckDone = false;

  function getCurrentUrl() {
    return typeof location !== 'undefined' ? location.href : '';
  }

  function getSystemPrefersDark() {
    try {
      return Boolean(
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      );
    } catch (_) {
      return false;
    }
  }

  function updateShieldHint(isActive, presetId) {
    try {
      if (typeof sessionStorage === 'undefined' || !sessionStorage) {
        return;
      }
      if (isActive) {
        const presets = Constants.THEME_PRESETS || {};
        const presetObj = presets[presetId] || presets.midnight;
        const bgHex = presetObj && presetObj.bg ? presetObj.bg : '#121418';
        sessionStorage.setItem('__darkext_shield', '1');
        sessionStorage.setItem('__darkext_shield_bg', bgHex);
      } else {
        sessionStorage.setItem('__darkext_shield', '0');
        sessionStorage.removeItem('__darkext_shield_bg');
      }
    } catch (_) {
      // Ignore Storage/SecurityError on restricted origins
    }
  }

  async function sendRuntimeMessage(type, payload) {
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.sendMessage !== 'function') {
      return null;
    }
    try {
      return await chrome.runtime.sendMessage({ type, payload: payload || {} });
    } catch (_) {
      return null;
    }
  }

  async function loadRegistry() {
    if (Array.isArray(cachedRegistry)) {
      return cachedRegistry;
    }
    if (typeof chrome === 'undefined' || !chrome.runtime || typeof chrome.runtime.getURL !== 'function' || typeof fetch !== 'function') {
      cachedRegistry = [];
      return cachedRegistry;
    }
    try {
      const res = await fetch(chrome.runtime.getURL(PATHS.REGISTRY));
      if (!res.ok) {
        cachedRegistry = [];
        return cachedRegistry;
      }
      const data = await res.json();
      cachedRegistry = Array.isArray(data) ? data : [];
      return cachedRegistry;
    } catch (_) {
      cachedRegistry = [];
      return cachedRegistry;
    }
  }

  async function fetchSettingsAndCss(hostname) {
    const resp = await sendRuntimeMessage(MSG.GET_SETTINGS, { hostname });
    if (resp && resp.ok && resp.settings) {
      return {
        settings: resp.settings,
        customCss: typeof resp.customCss === 'string' ? resp.customCss : ''
      };
    }

    const fallbackSettings = typeof Storage.getSettings === 'function'
      ? await Storage.getSettings()
      : Object.assign({}, Constants.DEFAULT_SETTINGS || {});
    const fallbackCss = hostname && typeof Storage.getCustomCss === 'function'
      ? await Storage.getCustomCss(hostname)
      : '';

    return {
      settings: fallbackSettings,
      customCss: fallbackCss || ''
    };
  }

  function removeFallbackStyle(file) {
    if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') {
      return;
    }
    const styles = document.querySelectorAll('style[data-darkext-fallback]');
    for (const styleEl of styles) {
      if (styleEl.getAttribute('data-darkext-fallback') === file && styleEl.parentNode) {
        styleEl.parentNode.removeChild(styleEl);
      }
    }
  }

  async function injectFallbackStyle(file) {
    if (
      typeof document === 'undefined' ||
      typeof chrome === 'undefined' ||
      !chrome.runtime ||
      typeof chrome.runtime.getURL !== 'function' ||
      typeof fetch !== 'function'
    ) {
      return;
    }
    const parent = document.head || document.documentElement;
    if (!parent) return;

    const existing = document.querySelectorAll('style[data-darkext-fallback]');
    for (const el of existing) {
      if (el.getAttribute('data-darkext-fallback') === file) {
        return;
      }
    }

    try {
      const res = await fetch(chrome.runtime.getURL(file));
      if (!res.ok) return;
      const cssText = await res.text();
      if (!cssText) return;
      const styleEl = document.createElement('style');
      styleEl.setAttribute('data-darkext-fallback', file);
      styleEl.textContent = cssText;
      parent.appendChild(styleEl);
    } catch (_) {
      // Ignore fetch failure in restricted pages
    }
  }

  async function syncInjectedCssFiles(desiredFiles) {
    const desired = Array.isArray(desiredFiles) ? desiredFiles : [];
    const toRemove = injectedCssFiles.filter((f) => !desired.includes(f));
    const toAdd = desired.filter((f) => !injectedCssFiles.includes(f));

    if (toRemove.length > 0) {
      for (const file of toRemove) {
        removeFallbackStyle(file);
      }
      await sendRuntimeMessage(MSG.REMOVE_CSS_FILES, { files: toRemove });
    }

    if (toAdd.length > 0) {
      const resp = await sendRuntimeMessage(MSG.INJECT_CSS_FILES, { files: toAdd });
      if (!resp || !resp.ok) {
        for (const file of toAdd) {
          await injectFallbackStyle(file);
        }
      }
    }

    injectedCssFiles = desired.slice();
  }

  function getDesiredCssFiles(resolved) {
    if (!resolved || !resolved.active) {
      return [];
    }
    const files = [PATHS.BASE_VARIABLES_CSS];
    if (resolved.mode === 'site-theme' && resolved.matchedTheme && resolved.matchedTheme.cssFile) {
      files.push(resolved.matchedTheme.cssFile);
    } else if (resolved.mode === 'filter') {
      files.push(PATHS.UNIVERSAL_FILTER_CSS);
    } else if (resolved.mode === 'dynamic') {
      files.push(PATHS.UNIVERSAL_DYNAMIC_CSS);
    }
    return files;
  }

  function detectNativeDarkCleanly() {
    if (typeof Detector.detectNativeDarkMode !== 'function' || typeof document === 'undefined') {
      return { isNativeDark: false, confidence: 0, reason: 'unavailable', bgLuminance: 1 };
    }
    const root = document.documentElement;
    const wasActive = Boolean(root && root.hasAttribute('data-darkext-active'));

    // Synchronously lift DarkExtension styles without tearing down injected CSS links/observers
    if (wasActive) {
      if (typeof DynamicEngine.pauseForDetection === 'function') {
        DynamicEngine.pauseForDetection();
      } else if (root) {
        root.removeAttribute('data-darkext-active');
      }
    }

    return Detector.detectNativeDarkMode(document);
  }

  async function reportStateToSw(state) {
    await sendRuntimeMessage(MSG.REPORT_TAB_STATE, {
      active: Boolean(state.active),
      mode: state.mode || 'off',
      nativeDarkDetected: Boolean(state.nativeDarkDetected),
      themeId: state.appliedThemeId || null
    });
  }

  async function runApplyCycle(options) {
    const opts = options || {};
    const url = getCurrentUrl();
    const supported = typeof SiteMatcher.isSupportedUrl === 'function'
      ? SiteMatcher.isSupportedUrl(url)
      : /^https?:\/\//i.test(url);

    if (!supported) {
      if (typeof DynamicEngine.teardown === 'function') {
        DynamicEngine.teardown();
      }
      await syncInjectedCssFiles([]);
      lastAppliedState = {
        hostname: '',
        supported: false,
        active: false,
        mode: 'off',
        appliedThemeId: null,
        appliedThemeName: null,
        nativeDarkDetected: false,
        scheduleBlocked: false
      };
      if (typeof DarkExt.removeEarlyShield === 'function') {
        DarkExt.removeEarlyShield();
      }
      return;
    }

    const hostname = typeof SiteMatcher.extractHostname === 'function'
      ? SiteMatcher.extractHostname(url)
      : '';

    const registry = await loadRegistry();

    if (!currentSettings || opts.refetch) {
      const fetched = await fetchSettingsAndCss(hostname);
      currentSettings = fetched.settings;
      currentCustomCss = fetched.customCss;
    }

    const systemPrefersDark = getSystemPrefersDark();

    // First resolve ignoring native detection to check if enabled & whether site-theme applies
    const preResolved = SiteMatcher.resolveEffectiveSiteConfig(hostname, currentSettings, registry, {
      systemPrefersDark,
      nativeDarkDetected: false
    });

    let nativeDarkDetected = false;
    const needsNativeCheck =
      preResolved.active &&
      preResolved.mode !== 'site-theme' &&
      Boolean(currentSettings.autoDetectNativeDark) &&
      !preResolved.forceOverrideNativeDark;

    if (needsNativeCheck) {
      if (typeof document !== 'undefined' && document.readyState !== 'loading') {
        const detection = detectNativeDarkCleanly();
        nativeDarkDetected = Boolean(detection && detection.isNativeDark);
        nativeCheckDone = true;
      } else {
        // At document_start, only skip early if meta/root attrs already clearly signal native dark
        const earlyDetection = detectNativeDarkCleanly();
        nativeDarkDetected = Boolean(earlyDetection && earlyDetection.isNativeDark);
      }
    }

    const resolved = SiteMatcher.resolveEffectiveSiteConfig(hostname, currentSettings, registry, {
      systemPrefersDark,
      nativeDarkDetected
    });

    try {
      if (!resolved.active) {
        if (typeof DynamicEngine.teardown === 'function') {
          DynamicEngine.teardown();
        }
        await syncInjectedCssFiles([]);
        updateShieldHint(false, resolved.preset);
      } else {
        const desiredFiles = getDesiredCssFiles(resolved);
        await syncInjectedCssFiles(desiredFiles);

        if (typeof DynamicEngine.apply === 'function') {
          DynamicEngine.apply({
            mode: resolved.mode,
            preset: resolved.preset,
            siteThemeId: resolved.appliedThemeId,
            dimImages: resolved.dimImages,
            brightness: resolved.brightness,
            contrast: resolved.contrast,
            sepia: resolved.sepia,
            grayscale: resolved.grayscale,
            imageBrightness: resolved.imageBrightness,
            customCss: currentCustomCss,
            onNavigate: handleSpaNavigation
          });
        }
        updateShieldHint(true, resolved.preset);
      }

      lastAppliedState = {
        hostname: resolved.hostname || hostname,
        supported: true,
        active: Boolean(resolved.active),
        mode: resolved.active ? resolved.mode : 'off',
        appliedThemeId: resolved.appliedThemeId || null,
        appliedThemeName: resolved.appliedThemeName || null,
        nativeDarkDetected: Boolean(nativeDarkDetected),
        scheduleBlocked: Boolean(resolved.scheduleBlocked)
      };

      await reportStateToSw(lastAppliedState);
    } finally {
      if (typeof DarkExt.removeEarlyShield === 'function') {
        DarkExt.removeEarlyShield();
      }
    }
  }

  async function applyState(options) {
    if (applyInFlight) {
      pendingReapply = true;
      await applyInFlight;
      if (pendingReapply) {
        pendingReapply = false;
        return applyState(options);
      }
      return;
    }

    applyInFlight = runApplyCycle(options);
    try {
      await applyInFlight;
    } finally {
      applyInFlight = null;
    }

    if (pendingReapply) {
      pendingReapply = false;
      await applyState(options);
    }
  }

  function handleSpaNavigation() {
    if (lastAppliedState.active && (lastAppliedState.mode === 'dynamic' || lastAppliedState.mode === 'site-theme')) {
      if (typeof DynamicEngine.rescan === 'function') {
        DynamicEngine.rescan();
      }
      return;
    }
    nativeCheckDone = false;
    void applyState({ refetch: false });
  }

  function registerMessageListener() {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
      return;
    }

    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || typeof message.type !== 'string') {
        return false;
      }

      if (message.type === MSG.SETTINGS_UPDATED) {
        (async () => {
          try {
            const payload = message.payload || {};
            if (payload.settings) {
              currentSettings = payload.settings;
            }
            if (payload.customCssMap && typeof payload.customCssMap === 'object') {
              const host = SiteMatcher.extractHostname(getCurrentUrl());
              currentCustomCss = host ? (payload.customCssMap[host] || '') : '';
            }
            await applyState({ refetch: !payload.settings });
            sendResponse({ ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
          }
        })();
        return true;
      }

      if (message.type === MSG.GET_TAB_STATUS) {
        (async () => {
          try {
            if (applyInFlight) {
              await applyInFlight;
            }
            sendResponse({
              ok: true,
              hostname: lastAppliedState.hostname,
              supported: lastAppliedState.supported,
              active: lastAppliedState.active,
              mode: lastAppliedState.mode,
              appliedThemeId: lastAppliedState.appliedThemeId,
              appliedThemeName: lastAppliedState.appliedThemeName,
              nativeDarkDetected: lastAppliedState.nativeDarkDetected,
              scheduleBlocked: lastAppliedState.scheduleBlocked
            });
          } catch (err) {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
          }
        })();
        return true;
      }

      if (message.type === MSG.SHOW_TOAST) {
        (async () => {
          try {
            const msgText = message.payload && message.payload.message;
            if (msgText && typeof DynamicEngine.showToast === 'function') {
              DynamicEngine.showToast(msgText);
            }
            sendResponse({ ok: true });
          } catch (err) {
            sendResponse({ ok: false, error: err && err.message ? err.message : String(err) });
          }
        })();
        return true;
      }

      return false;
    });
  }

  function registerLifecycleListeners() {
    if (typeof document !== 'undefined' && document.readyState === 'loading' && typeof document.addEventListener === 'function') {
      document.addEventListener('DOMContentLoaded', async () => {
        if (!nativeCheckDone) {
          await applyState({ refetch: false });
        } else if (
          lastAppliedState.active &&
          (lastAppliedState.mode === 'dynamic' || lastAppliedState.mode === 'site-theme') &&
          typeof DynamicEngine.rescan === 'function'
        ) {
          DynamicEngine.rescan();
        }
      });
    }

    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      try {
        const mql = window.matchMedia('(prefers-color-scheme: dark)');
        const onSchemeChange = async () => {
          if (currentSettings && currentSettings.schedule && currentSettings.schedule.mode === 'system') {
            await applyState({ refetch: false });
          }
        };
        if (typeof mql.addEventListener === 'function') {
          mql.addEventListener('change', onSchemeChange);
        } else if (typeof mql.addListener === 'function') {
          mql.addListener(onSchemeChange);
        }
      } catch (_) {
        // Ignore matchMedia listener errors in restricted contexts
      }
    }
  }

  async function bootstrap() {
    registerMessageListener();
    registerLifecycleListeners();
    await applyState({ refetch: true });
  }

  DarkExt.Content = {
    bootstrap,
    applyState,
    getStatus: () => ({ ...lastAppliedState })
  };

  if (typeof document !== 'undefined') {
    void bootstrap();
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DarkExt.Content;
  }
})(globalThis);
