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
      elevated: '#1b1f29',
      subtle: '#242a38',
      hover: '#2e3648',
      border: '#384156',
      borderStrong: '#505d7a',
      text: '#f4f6fa',
      secondary: '#c4ccd9',
      muted: '#98a3b8',
      link: '#82b8ff',
      linkVisited: '#b89eff',
      accent: '#4f78ff',
      accentHover: '#698dff',
      accentText: '#ffffff',
      danger: '#f87171',
      success: '#4ade80',
      warning: '#fbbf24',
      scrollbarTrack: '#121418',
      scrollbarThumb: '#384156'
    }),
    oled: Object.freeze({
      id: 'oled',
      name: 'OLED Pure Black',
      description: 'True #000000 black background for OLED displays',
      bg: '#000000',
      elevated: '#101217',
      subtle: '#1a1d26',
      hover: '#242936',
      border: '#2f3545',
      borderStrong: '#4a5269',
      text: '#f8f9fc',
      secondary: '#c2c8d6',
      muted: '#939bad',
      link: '#75baff',
      linkVisited: '#b299ff',
      accent: '#3b82f6',
      accentHover: '#60a5fa',
      accentText: '#ffffff',
      danger: '#ff6b6b',
      success: '#34d399',
      warning: '#fbbf24',
      scrollbarTrack: '#000000',
      scrollbarThumb: '#2f3545'
    }),
    warm: Object.freeze({
      id: 'warm',
      name: 'Warm Sepia',
      description: 'Cozy low-blue-light sepia espresso tones for late night reading',
      bg: '#181512',
      elevated: '#231e19',
      subtle: '#2e2821',
      hover: '#3a322a',
      border: '#483e33',
      borderStrong: '#635547',
      text: '#f6f0e6',
      secondary: '#d2c5b2',
      muted: '#a69680',
      link: '#eab578',
      linkVisited: '#d49ba8',
      accent: '#e09f4c',
      accentHover: '#ebb164',
      accentText: '#181512',
      danger: '#e57373',
      success: '#81c784',
      warning: '#ffb74d',
      scrollbarTrack: '#181512',
      scrollbarThumb: '#483e33'
    }),
    slate: Object.freeze({
      id: 'slate',
      name: 'Slate Blue',
      description: 'Modern cool navy palette with bright cyan highlights',
      bg: '#0f172a',
      elevated: '#1a2438',
      subtle: '#24324b',
      hover: '#304160',
      border: '#415476',
      borderStrong: '#5a729c',
      text: '#f8fafc',
      secondary: '#c4d3e8',
      muted: '#94a8c4',
      link: '#5cc8ff',
      linkVisited: '#b59cff',
      accent: '#38bdf8',
      accentHover: '#7dd3fc',
      accentText: '#0b1324',
      danger: '#f87171',
      success: '#4ade80',
      warning: '#facc15',
      scrollbarTrack: '#0f172a',
      scrollbarThumb: '#415476'
    }),
    nord: Object.freeze({
      id: 'nord',
      name: 'Nord',
      description: 'Arctic bluish-grey palette inspired by Nord',
      bg: '#242933',
      elevated: '#2d3442',
      subtle: '#374052',
      hover: '#434e63',
      border: '#525f78',
      borderStrong: '#6c7b99',
      text: '#f4f6fb',
      secondary: '#d8e0ec',
      muted: '#a9b5c9',
      link: '#92cde0',
      linkVisited: '#c19ebb',
      accent: '#88c0d0',
      accentHover: '#9ed0de',
      accentText: '#1a1f28',
      danger: '#bf616a',
      success: '#a3be8c',
      warning: '#ebcb8b',
      scrollbarTrack: '#242933',
      scrollbarThumb: '#525f78'
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
