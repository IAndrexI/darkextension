/* global importScripts, chrome, DarkExt */
'use strict';

importScripts(
  '../shared/constants.js',
  '../shared/site-matcher.js',
  '../shared/color-utils.js',
  '../shared/schedule.js',
  '../shared/storage.js'
);

const { Constants, SiteMatcher, Schedule, Storage } = globalThis.DarkExt;
const { MESSAGE_TYPES, CONTEXT_MENU_IDS, ALARM_NAMES, COMMAND_NAMES, PATHS } = Constants;

async function getActiveTab() {
  if (!chrome.tabs || typeof chrome.tabs.query !== 'function') {
    return null;
  }
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (Array.isArray(tabs) && tabs.length > 0) {
      return tabs[0];
    }
    const fallbackTabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return Array.isArray(fallbackTabs) && fallbackTabs.length > 0 ? fallbackTabs[0] : null;
  } catch {
    return null;
  }
}

async function sendMessageToTab(tabId, message) {
  if (!tabId || !chrome.tabs || typeof chrome.tabs.sendMessage !== 'function') {
    return null;
  }
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    return null;
  }
}

async function broadcastSettingsUpdated(settings, customCssMap) {
  if (!chrome.tabs || typeof chrome.tabs.query !== 'function') {
    return;
  }
  const cssMap = customCssMap || (await Storage.getAllCustomCss());
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch {
    tabs = [];
  }
  for (const tab of tabs) {
    if (tab && typeof tab.id === 'number' && SiteMatcher.isSupportedUrl(tab.url || '')) {
      await sendMessageToTab(tab.id, {
        type: MESSAGE_TYPES.SETTINGS_UPDATED,
        payload: { settings, customCssMap: cssMap }
      });
    }
  }
}

async function saveSessionTabState(tabId, state) {
  if (!tabId || !chrome.storage || !chrome.storage.session) {
    return;
  }
  try {
    const data = await chrome.storage.session.get(Constants.TAB_STATE_SESSION_KEY);
    const map = (data && data[Constants.TAB_STATE_SESSION_KEY]) || {};
    map[String(tabId)] = {
      active: Boolean(state.active),
      mode: state.mode || 'off',
      nativeDarkDetected: Boolean(state.nativeDarkDetected),
      themeId: state.themeId || null,
      updatedAt: Date.now()
    };
    await chrome.storage.session.set({ [Constants.TAB_STATE_SESSION_KEY]: map });
  } catch {
    // Session storage is optional across environments/mocks
  }
}

async function getSessionTabState(tabId) {
  if (!tabId || !chrome.storage || !chrome.storage.session) {
    return null;
  }
  try {
    const data = await chrome.storage.session.get(Constants.TAB_STATE_SESSION_KEY);
    const map = data && data[Constants.TAB_STATE_SESSION_KEY];
    return map ? map[String(tabId)] || null : null;
  } catch {
    return null;
  }
}

async function setBadge(tabId, text, bgColor) {
  if (!chrome.action || typeof chrome.action.setBadgeText !== 'function') {
    return;
  }
  try {
    await chrome.action.setBadgeText({ tabId, text: String(text || '') });
    if (text && bgColor && typeof chrome.action.setBadgeBackgroundColor === 'function') {
      await chrome.action.setBadgeBackgroundColor({ tabId, color: bgColor });
    }
    if (text && typeof chrome.action.setBadgeTextColor === 'function') {
      await chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' });
    }
  } catch {
    // Tab may have closed before badge update completed
  }
}

async function updateTabBadge(tabId, state) {
  if (typeof tabId !== 'number') {
    return;
  }
  if (!state) {
    await setBadge(tabId, '', '#475569');
    return;
  }
  if (state.supported === false) {
    await setBadge(tabId, '', '#475569');
    return;
  }
  if (state.active) {
    await setBadge(tabId, 'ON', '#6c8cff');
    return;
  }
  if (state.globallyDisabled) {
    await setBadge(tabId, 'OFF', '#475569');
    return;
  }
  if (state.scheduleBlocked) {
    await setBadge(tabId, 'ZZZ', '#475569');
    return;
  }
  await setBadge(tabId, '', '#475569');
}

async function loadSiteThemeRegistry() {
  if (!chrome.runtime || typeof chrome.runtime.getURL !== 'function' || typeof fetch !== 'function') {
    return [];
  }
  try {
    const res = await fetch(chrome.runtime.getURL(PATHS.REGISTRY));
    if (!res.ok) {
      return [];
    }
    const json = await res.json();
    return Array.isArray(json) ? json : [];
  } catch {
    return [];
  }
}

async function refreshTabBadgeFromUrl(tabId, url) {
  if (typeof tabId !== 'number') {
    return;
  }
  if (!SiteMatcher.isSupportedUrl(url || '')) {
    await updateTabBadge(tabId, { supported: false });
    return;
  }
  const settings = await Storage.getSettings();
  if (!settings.enabled) {
    await updateTabBadge(tabId, { supported: true, active: false, globallyDisabled: true });
    return;
  }
  const sessionState = await getSessionTabState(tabId);
  if (sessionState) {
    await updateTabBadge(tabId, {
      supported: true,
      active: sessionState.active,
      scheduleBlocked: !Schedule.isScheduleActive(settings.schedule)
    });
    return;
  }
  const hostname = SiteMatcher.extractHostname(url);
  const registry = await loadSiteThemeRegistry();
  const config = SiteMatcher.resolveEffectiveSiteConfig(hostname, settings, registry);
  await updateTabBadge(tabId, {
    supported: true,
    active: config.active,
    scheduleBlocked: config.scheduleBlocked
  });
}

async function syncScheduleAlarm(settings) {
  if (!chrome.alarms) {
    return;
  }
  try {
    if (settings && settings.schedule && settings.schedule.mode === 'time') {
      await chrome.alarms.create(ALARM_NAMES.SCHEDULE_CHECK, { periodInMinutes: 1 });
    } else if (typeof chrome.alarms.clear === 'function') {
      await chrome.alarms.clear(ALARM_NAMES.SCHEDULE_CHECK);
    }
  } catch {
    // Ignore alarm errors in restricted environments
  }
}

async function clearContextMenus() {
  if (!chrome.contextMenus || typeof chrome.contextMenus.removeAll !== 'function') {
    return;
  }
  let finished = false;
  await new Promise((resolve) => {
    try {
      const maybePromise = chrome.contextMenus.removeAll(() => {
        void chrome.runtime?.lastError;
        if (!finished) {
          finished = true;
          resolve();
        }
      });
      if (maybePromise && typeof maybePromise === 'object') {
        (async () => {
          try {
            await maybePromise;
          } catch {
            // Ignore mock/runtime errors
          }
          if (!finished) {
            finished = true;
            resolve();
          }
        })();
      }
    } catch {
      if (!finished) {
        finished = true;
        resolve();
      }
    }
  });
}

function createContextMenuItem(options) {
  if (!chrome.contextMenus || typeof chrome.contextMenus.create !== 'function') {
    return;
  }
  try {
    chrome.contextMenus.create(options, () => {
      void chrome.runtime?.lastError;
    });
  } catch {
    // Ignore duplicate or unsupported context menu errors
  }
}

async function setupContextMenus() {
  if (!chrome.contextMenus) {
    return;
  }
  await clearContextMenus();
  createContextMenuItem({
    id: CONTEXT_MENU_IDS.TOGGLE_SITE,
    title: 'Toggle Dark Mode on This Site',
    contexts: ['page', 'action']
  });
  createContextMenuItem({
    id: CONTEXT_MENU_IDS.TOGGLE_GLOBAL,
    title: 'Toggle DarkExtension Globally',
    contexts: ['page', 'action']
  });
  createContextMenuItem({
    id: CONTEXT_MENU_IDS.FORCE_DARK,
    title: 'Force Dark Mode on This Site',
    contexts: ['page']
  });
  createContextMenuItem({
    id: CONTEXT_MENU_IDS.OPEN_SIDE_PANEL,
    title: 'Open DarkExtension Side Panel',
    contexts: ['page', 'action']
  });
  createContextMenuItem({
    id: CONTEXT_MENU_IDS.OPEN_OPTIONS,
    title: 'DarkExtension Settings',
    contexts: ['page', 'action']
  });
}

async function performToggleGlobal(targetTabId) {
  const current = await Storage.getSettings();
  const nextEnabled = !current.enabled;
  const settings = await Storage.updateSettings({ enabled: nextEnabled });
  await syncScheduleAlarm(settings);
  await broadcastSettingsUpdated(settings);

  const tab = targetTabId ? { id: targetTabId } : await getActiveTab();
  if (tab && typeof tab.id === 'number') {
    await updateTabBadge(tab.id, {
      supported: true,
      active: settings.enabled && Schedule.isScheduleActive(settings.schedule),
      globallyDisabled: !settings.enabled
    });
    const message = settings.enabled ? 'DarkExtension enabled' : 'DarkExtension paused';
    await sendMessageToTab(tab.id, {
      type: MESSAGE_TYPES.SHOW_TOAST,
      payload: { message }
    });
  }
  return { ok: true, enabled: settings.enabled };
}

async function performToggleSite(rawHostname, targetTabId) {
  let host = SiteMatcher.normalizeHostname(rawHostname || '');
  let tabId = targetTabId;

  if (!host) {
    let tab = null;
    if (tabId && chrome.tabs && typeof chrome.tabs.get === 'function') {
      try {
        tab = await chrome.tabs.get(tabId);
      } catch {
        tab = null;
      }
    } else {
      tab = await getActiveTab();
    }
    if (tab) {
      tabId = tab.id;
      if (SiteMatcher.isSupportedUrl(tab.url || '')) {
        host = SiteMatcher.extractHostname(tab.url);
      }
    }
  }

  if (!host) {
    return { ok: false, error: 'Unsupported or missing hostname' };
  }

  const current = await Storage.getSettings();
  const existing = current.siteRules && current.siteRules[host];
  const wasDisabled = Boolean(existing && (existing.enabled === false || existing.mode === 'off'));
  const siteEnabled = wasDisabled;

  const nextRule = {
    ...(existing || {}),
    enabled: siteEnabled,
    mode: siteEnabled
      ? (existing && existing.mode && existing.mode !== 'off' ? existing.mode : 'auto')
      : (existing && existing.mode && existing.mode !== 'off' ? existing.mode : 'auto')
  };

  const settings = await Storage.setSiteRule(host, nextRule);
  await broadcastSettingsUpdated(settings);

  if (typeof tabId === 'number') {
    await updateTabBadge(tabId, {
      supported: true,
      active: settings.enabled && siteEnabled && Schedule.isScheduleActive(settings.schedule),
      globallyDisabled: !settings.enabled
    });
    const message = siteEnabled
      ? `Dark mode enabled on ${host}`
      : `Dark mode disabled on ${host}`;
    await sendMessageToTab(tabId, {
      type: MESSAGE_TYPES.SHOW_TOAST,
      payload: { message }
    });
  }

  return { ok: true, siteEnabled };
}

async function handleMessage(message, sender) {
  const type = message && message.type;
  const payload = (message && message.payload) || {};

  switch (type) {
    case MESSAGE_TYPES.GET_SETTINGS: {
      const settings = await Storage.getSettings();
      const hostname = SiteMatcher.normalizeHostname(
        payload.hostname || SiteMatcher.extractHostname((sender && sender.tab && sender.tab.url) || '')
      );
      const customCss = hostname ? await Storage.getCustomCss(hostname) : '';
      const effectiveEnabled = Boolean(settings.enabled) && Schedule.isScheduleActive(settings.schedule);
      return { ok: true, settings, effectiveEnabled, customCss };
    }

    case MESSAGE_TYPES.UPDATE_SETTINGS: {
      const patch = payload.patch && typeof payload.patch === 'object' ? payload.patch : payload;
      const settings = await Storage.updateSettings(patch);
      await syncScheduleAlarm(settings);
      await broadcastSettingsUpdated(settings);
      const activeTab = await getActiveTab();
      if (activeTab && typeof activeTab.id === 'number') {
        await refreshTabBadgeFromUrl(activeTab.id, activeTab.url);
      }
      return { ok: true, settings };
    }

    case MESSAGE_TYPES.SET_SITE_RULE: {
      const settings = await Storage.setSiteRule(payload.hostname, payload.rule);
      await broadcastSettingsUpdated(settings);
      const activeTab = await getActiveTab();
      if (activeTab && typeof activeTab.id === 'number') {
        await refreshTabBadgeFromUrl(activeTab.id, activeTab.url);
      }
      return { ok: true, settings };
    }

    case MESSAGE_TYPES.DELETE_SITE_RULE: {
      const settings = await Storage.deleteSiteRule(payload.hostname);
      await broadcastSettingsUpdated(settings);
      const activeTab = await getActiveTab();
      if (activeTab && typeof activeTab.id === 'number') {
        await refreshTabBadgeFromUrl(activeTab.id, activeTab.url);
      }
      return { ok: true, settings };
    }

    case MESSAGE_TYPES.TOGGLE_GLOBAL: {
      return performToggleGlobal(sender && sender.tab ? sender.tab.id : undefined);
    }

    case MESSAGE_TYPES.TOGGLE_SITE: {
      const senderUrl = (sender && sender.tab && sender.tab.url) || '';
      const host = payload.hostname || SiteMatcher.extractHostname(senderUrl);
      return performToggleSite(host, sender && sender.tab ? sender.tab.id : undefined);
    }

    case MESSAGE_TYPES.GET_CUSTOM_CSS: {
      const css = await Storage.getCustomCss(payload.hostname || '');
      return { ok: true, css };
    }

    case MESSAGE_TYPES.SET_CUSTOM_CSS: {
      const map = await Storage.setCustomCss(payload.hostname || '', payload.css || '');
      const settings = await Storage.getSettings();
      await broadcastSettingsUpdated(settings, map);
      return { ok: true };
    }

    case MESSAGE_TYPES.GET_ALL_CUSTOM_CSS: {
      const map = await Storage.getAllCustomCss();
      return { ok: true, map };
    }

    case MESSAGE_TYPES.GET_TAB_STATUS: {
      const targetTab = (sender && sender.tab) || (await getActiveTab());
      const url = (payload.url) || (targetTab && targetTab.url) || '';
      const supported = SiteMatcher.isSupportedUrl(url);
      const hostname = supported ? SiteMatcher.extractHostname(url) : '';
      if (!supported || !hostname) {
        return {
          ok: true,
          hostname: '',
          supported: false,
          active: false,
          mode: 'off',
          appliedThemeId: null,
          appliedThemeName: null,
          nativeDarkDetected: false,
          scheduleBlocked: false
        };
      }
      const settings = await Storage.getSettings();
      const registry = await loadSiteThemeRegistry();
      const sessionState = targetTab && typeof targetTab.id === 'number'
        ? await getSessionTabState(targetTab.id)
        : null;
      const nativeDarkDetected = Boolean(sessionState && sessionState.nativeDarkDetected);
      const resolved = SiteMatcher.resolveEffectiveSiteConfig(hostname, settings, registry, {
        nativeDarkDetected
      });
      return {
        ok: true,
        hostname: resolved.hostname,
        supported: true,
        active: resolved.active,
        mode: resolved.mode,
        appliedThemeId: resolved.appliedThemeId,
        appliedThemeName: resolved.appliedThemeName,
        nativeDarkDetected,
        scheduleBlocked: resolved.scheduleBlocked
      };
    }

    case MESSAGE_TYPES.INJECT_CSS_FILES: {
      const tabId = (sender && sender.tab && sender.tab.id) || payload.tabId;
      const files = Array.isArray(payload.files) ? payload.files.filter((f) => typeof f === 'string' && f) : [];
      if (typeof tabId !== 'number') {
        return { ok: false, error: 'Missing target tabId for CSS injection' };
      }
      if (files.length > 0 && chrome.scripting && typeof chrome.scripting.insertCSS === 'function') {
        const target = { tabId };
        if (sender && typeof sender.frameId === 'number') {
          target.frameIds = [sender.frameId];
        }
        await chrome.scripting.insertCSS({
          target,
          files
        });
      }
      return { ok: true };
    }

    case MESSAGE_TYPES.REMOVE_CSS_FILES: {
      const tabId = (sender && sender.tab && sender.tab.id) || payload.tabId;
      const files = Array.isArray(payload.files) ? payload.files.filter((f) => typeof f === 'string' && f) : [];
      if (typeof tabId !== 'number') {
        return { ok: false, error: 'Missing target tabId for CSS removal' };
      }
      if (files.length > 0 && chrome.scripting && typeof chrome.scripting.removeCSS === 'function') {
        try {
          const target = { tabId };
          if (sender && typeof sender.frameId === 'number') {
            target.frameIds = [sender.frameId];
          }
          await chrome.scripting.removeCSS({
            target,
            files
          });
        } catch {
          // Ignore if CSS was not previously injected
        }
      }
      return { ok: true };
    }

    case MESSAGE_TYPES.REPORT_TAB_STATE: {
      const tabId = sender && sender.tab && sender.tab.id;
      if (typeof tabId === 'number') {
        await saveSessionTabState(tabId, payload);
        const settings = await Storage.getSettings();
        await updateTabBadge(tabId, {
          supported: true,
          active: Boolean(payload.active),
          globallyDisabled: !settings.enabled,
          scheduleBlocked: Boolean(settings.enabled) && !Schedule.isScheduleActive(settings.schedule)
        });
      }
      return { ok: true };
    }

    case MESSAGE_TYPES.RESET_SETTINGS: {
      const settings = await Storage.resetAll();
      await syncScheduleAlarm(settings);
      await broadcastSettingsUpdated(settings, {});
      const activeTab = await getActiveTab();
      if (activeTab && typeof activeTab.id === 'number') {
        await refreshTabBadgeFromUrl(activeTab.id, activeTab.url);
      }
      return { ok: true, settings };
    }

    default:
      return { ok: false, error: `Unknown message type: ${String(type)}` };
  }
}

if (chrome.runtime && chrome.runtime.onInstalled) {
  chrome.runtime.onInstalled.addListener(async () => {
    const settings = await Storage.getSettings();
    await Storage.saveSettings(settings);
    await setupContextMenus();
    await syncScheduleAlarm(settings);
    const activeTab = await getActiveTab();
    if (activeTab && typeof activeTab.id === 'number') {
      await refreshTabBadgeFromUrl(activeTab.id, activeTab.url);
    }
  });
}

if (chrome.runtime && chrome.runtime.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    const settings = await Storage.getSettings();
    await setupContextMenus();
    await syncScheduleAlarm(settings);
  });
}

if (chrome.contextMenus && chrome.contextMenus.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    const menuId = info && info.menuItemId;

    if (menuId === CONTEXT_MENU_IDS.OPEN_SIDE_PANEL) {
      if (chrome.sidePanel && typeof chrome.sidePanel.open === 'function') {
        try {
          if (tab && typeof tab.windowId === 'number') {
            await chrome.sidePanel.open({ windowId: tab.windowId });
            return;
          }
          const fallbackTab = await getActiveTab();
          if (fallbackTab && typeof fallbackTab.windowId === 'number') {
            await chrome.sidePanel.open({ windowId: fallbackTab.windowId });
            return;
          }
        } catch {
          // Fall through to options page if sidePanel is unavailable or gesture expired
        }
      }
      if (chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
        await chrome.runtime.openOptionsPage();
      }
      return;
    }

    const activeTab = tab || (await getActiveTab());
    const tabId = activeTab && activeTab.id;
    const tabUrl = (activeTab && activeTab.url) || '';

    if (menuId === CONTEXT_MENU_IDS.TOGGLE_SITE) {
      if (!SiteMatcher.isSupportedUrl(tabUrl)) {
        return;
      }
      const host = SiteMatcher.extractHostname(tabUrl);
      await performToggleSite(host, tabId);
      return;
    }

    if (menuId === CONTEXT_MENU_IDS.TOGGLE_GLOBAL) {
      await performToggleGlobal(tabId);
      return;
    }

    if (menuId === CONTEXT_MENU_IDS.FORCE_DARK) {
      if (!SiteMatcher.isSupportedUrl(tabUrl)) {
        return;
      }
      const host = SiteMatcher.extractHostname(tabUrl);
      const current = await Storage.getSettings();
      const existing = current.siteRules && current.siteRules[host];
      const nextRule = {
        ...(existing || {}),
        enabled: true,
        mode: existing && existing.mode && existing.mode !== 'off' ? existing.mode : 'auto',
        forceOverrideNativeDark: true
      };
      const settings = await Storage.setSiteRule(host, nextRule);
      await broadcastSettingsUpdated(settings);
      if (typeof tabId === 'number') {
        await updateTabBadge(tabId, { supported: true, active: settings.enabled });
        await sendMessageToTab(tabId, {
          type: MESSAGE_TYPES.SHOW_TOAST,
          payload: { message: `Forced dark mode enabled on ${host}` }
        });
      }
      return;
    }

    if (menuId === CONTEXT_MENU_IDS.OPEN_OPTIONS) {
      if (chrome.runtime && typeof chrome.runtime.openOptionsPage === 'function') {
        await chrome.runtime.openOptionsPage();
      }
    }
  });
}

if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener(async (command) => {
    const activeTab = await getActiveTab();
    const tabId = activeTab && activeTab.id;
    const tabUrl = (activeTab && activeTab.url) || '';

    if (command === COMMAND_NAMES.TOGGLE_SITE) {
      if (!SiteMatcher.isSupportedUrl(tabUrl)) {
        return;
      }
      const host = SiteMatcher.extractHostname(tabUrl);
      await performToggleSite(host, tabId);
      return;
    }

    if (command === COMMAND_NAMES.TOGGLE_GLOBAL) {
      await performToggleGlobal(tabId);
    }
  });
}

if (chrome.alarms && chrome.alarms.onAlarm) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm && alarm.name === ALARM_NAMES.SCHEDULE_CHECK) {
      const settings = await Storage.getSettings();
      await broadcastSettingsUpdated(settings);
      const activeTab = await getActiveTab();
      if (activeTab && typeof activeTab.id === 'number') {
        await refreshTabBadgeFromUrl(activeTab.id, activeTab.url);
      }
    }
  });
}

if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (!activeInfo || typeof activeInfo.tabId !== 'number') {
      return;
    }
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      await refreshTabBadgeFromUrl(activeInfo.tabId, tab && tab.url);
    } catch {
      // Tab may no longer exist
    }
  });
}

if (chrome.tabs && chrome.tabs.onUpdated) {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (!changeInfo || (changeInfo.status !== 'complete' && !changeInfo.url)) {
      return;
    }
    await refreshTabBadgeFromUrl(tabId, (tab && tab.url) || changeInfo.url || '');
  });
}

if (chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    (async () => {
      try {
        const result = await handleMessage(message, sender);
        sendResponse(result);
      } catch (err) {
        sendResponse({
          ok: false,
          error: err && err.message ? err.message : String(err)
        });
      }
    })();
    return true;
  });
}
