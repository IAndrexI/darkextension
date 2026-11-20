(function (root) {
  'use strict';

  const DarkExt = (root.DarkExt = root.DarkExt || {});

  const STORAGE_KEY = 'darkext_settings';
  const CUSTOM_CSS_KEY = 'darkext_custom_css';
  const TAB_STATE_SESSION_KEY = 'darkext_tab_states';

  const PRESET_IDS = Object.freeze(['midnight', 'oled', 'warm', 'slate', 'nord']);

  const MODES = Object.freeze({
    AUTO: 'auto',
    DYNAMIC: 'dynamic',
    FILTER: 'filter',
    SITE_THEME: 'site-theme',
    OFF: 'off'
  });

  const SCHEDULE_MODES = Object.freeze({
    OFF: 'off',
    SYSTEM: 'system',
    TIME: 'time'
  });

  const LIMITS = Object.freeze({
    brightness: Object.freeze({ min: 50, max: 130, default: 100 }),
    contrast: Object.freeze({ min: 70, max: 140, default: 100 }),
    sepia: Object.freeze({ min: 0, max: 60, default: 0 }),
    imageBrightness: Object.freeze({ min: 50, max: 100, default: 90 }),
    grayscale: Object.freeze({ min: 0, max: 100, default: 0 })
  });

  const THEME_PRESETS = Object.freeze({
    midnight: Object.freeze({
      id: 'midnight',
      name: 'Midnight',
      description: 'Deep charcoal slate with crisp neutral contrast',
      bg: '#121418',
      elevated: '#1c2029',
      subtle: '#262b38',
      hover: '#303747',
      border: '#363e50',
      borderStrong: '#4b566e',
      text: '#e6e9ef',
      secondary: '#a8b0c0',
      muted: '#7e889c',
      link: '#7ab3ff',
      linkVisited: '#b095ff',
      accent: '#4f78ff',
      accentHover: '#698dff',
      accentText: '#ffffff',
      danger: '#f87171',
      success: '#4ade80',
      warning: '#fbbf24',
      scrollbarTrack: '#121418',
      scrollbarThumb: '#363e50'
    }),
    oled: Object.freeze({
      id: 'oled',
      name: 'OLED Pure Black',
      description: 'True #000000 black background for OLED displays',
      bg: '#000000',
      elevated: '#111216',
      subtle: '#1b1d24',
      hover: '#252833',
      border: '#2e3240',
      borderStrong: '#454b5e',
      text: '#f0f0f5',
      secondary: '#a0a0b0',
      muted: '#767687',
      link: '#66b2ff',
      linkVisited: '#a88bff',
      accent: '#3b82f6',
      accentHover: '#60a5fa',
      accentText: '#ffffff',
      danger: '#ff6b6b',
      success: '#34d399',
      warning: '#fbbf24',
      scrollbarTrack: '#000000',
      scrollbarThumb: '#2e3240'
    }),
    warm: Object.freeze({
      id: 'warm',
      name: 'Warm Sepia',
      description: 'Cozy low-blue-light sepia espresso tones for late night reading',
      bg: '#181512',
      elevated: '#25201b',
      subtle: '#312a23',
      hover: '#3d352c',
      border: '#483e34',
      borderStrong: '#615346',
      text: '#ebe3d5',
      secondary: '#b8aa96',
      muted: '#8c7e6c',
      link: '#e0a96d',
      linkVisited: '#c98e9e',
      accent: '#e09f4c',
      accentHover: '#ebb164',
      accentText: '#181512',
      danger: '#e57373',
      success: '#81c784',
      warning: '#ffb74d',
      scrollbarTrack: '#181512',
      scrollbarThumb: '#483e34'
    }),
    slate: Object.freeze({
      id: 'slate',
      name: 'Slate Blue',
      description: 'Modern cool navy palette with bright cyan highlights',
      bg: '#0f172a',
      elevated: '#1e293b',
      subtle: '#293548',
      hover: '#36455c',
      border: '#41526b',
      borderStrong: '#586e8f',
      text: '#f1f5f9',
      secondary: '#94a3b8',
      muted: '#6e7f96',
      link: '#38bdf8',
      linkVisited: '#a78bfa',
      accent: '#38bdf8',
      accentHover: '#7dd3fc',
      accentText: '#0b1324',
      danger: '#f87171',
      success: '#4ade80',
      warning: '#facc15',
      scrollbarTrack: '#0f172a',
      scrollbarThumb: '#41526b'
    }),
    nord: Object.freeze({
      id: 'nord',
      name: 'Nord',
      description: 'Arctic bluish-grey palette inspired by Nord',
      bg: '#242933',
      elevated: '#303744',
      subtle: '#3d4556',
      hover: '#495266',
      border: '#566178',
      borderStrong: '#6c7994',
      text: '#eceff4',
      secondary: '#d8dee9',
      muted: '#9aa5ba',
      link: '#88c0d0',
      linkVisited: '#b48ead',
      accent: '#88c0d0',
      accentHover: '#9ed0de',
      accentText: '#1a1f28',
      danger: '#bf616a',
      success: '#a3be8c',
      warning: '#ebcb8b',
      scrollbarTrack: '#242933',
      scrollbarThumb: '#566178'
    })
  });

  const DEFAULT_SETTINGS = Object.freeze({
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
    schedule: Object.freeze({
      mode: 'off',
      startTime: '20:00',
      endTime: '07:00'
    }),
    disabledThemes: Object.freeze([]),
    siteRules: Object.freeze({})
  });

  const MESSAGE_TYPES = Object.freeze({
    GET_SETTINGS: 'GET_SETTINGS',
    UPDATE_SETTINGS: 'UPDATE_SETTINGS',
    SET_SITE_RULE: 'SET_SITE_RULE',
    DELETE_SITE_RULE: 'DELETE_SITE_RULE',
    TOGGLE_GLOBAL: 'TOGGLE_GLOBAL',
    TOGGLE_SITE: 'TOGGLE_SITE',
    GET_CUSTOM_CSS: 'GET_CUSTOM_CSS',
    SET_CUSTOM_CSS: 'SET_CUSTOM_CSS',
    GET_ALL_CUSTOM_CSS: 'GET_ALL_CUSTOM_CSS',
    GET_TAB_STATUS: 'GET_TAB_STATUS',
    INJECT_CSS_FILES: 'INJECT_CSS_FILES',
    REMOVE_CSS_FILES: 'REMOVE_CSS_FILES',
    REPORT_TAB_STATE: 'REPORT_TAB_STATE',
    SETTINGS_UPDATED: 'SETTINGS_UPDATED',
    SHOW_TOAST: 'SHOW_TOAST',
    RESET_SETTINGS: 'RESET_SETTINGS'
  });

  const CONTEXT_MENU_IDS = Object.freeze({
    TOGGLE_SITE: 'darkext-toggle-site',
    TOGGLE_GLOBAL: 'darkext-toggle-global',
    FORCE_DARK: 'darkext-force-dark',
    OPEN_SIDE_PANEL: 'darkext-open-side-panel',
    OPEN_OPTIONS: 'darkext-open-options'
  });

  const ALARM_NAMES = Object.freeze({
    SCHEDULE_CHECK: 'darkext-schedule-check'
  });

  const COMMAND_NAMES = Object.freeze({
    TOGGLE_SITE: 'toggle-site',
    TOGGLE_GLOBAL: 'toggle-global'
  });

  const PATHS = Object.freeze({
    REGISTRY: 'src/themes/sites/registry.json',
    BASE_VARIABLES_CSS: 'src/themes/base/variables.css',
    UNIVERSAL_DYNAMIC_CSS: 'src/themes/base/universal-dynamic.css',
    UNIVERSAL_FILTER_CSS: 'src/themes/base/universal-filter.css'
  });

  const Constants = Object.freeze({
    STORAGE_KEY,
    CUSTOM_CSS_KEY,
    TAB_STATE_SESSION_KEY,
    PRESET_IDS,
    MODES,
    SCHEDULE_MODES,
    LIMITS,
    THEME_PRESETS,
    DEFAULT_SETTINGS,
    MESSAGE_TYPES,
    CONTEXT_MENU_IDS,
    ALARM_NAMES,
    COMMAND_NAMES,
    PATHS
  });

  DarkExt.Constants = Constants;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Constants;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
