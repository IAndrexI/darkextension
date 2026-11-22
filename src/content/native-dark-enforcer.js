'use strict';

(function initNativeDarkEnforcer(global) {
  const STORAGE_KEY = '__darkext_native_enforcer';
  const EVENT_NAME = '__darkext_native_dark_pref';

  const DARK_SCHEME_RE = /^\(?\s*prefers-color-scheme\s*:\s*dark\s*\)?$/i;
  const LIGHT_SCHEME_RE = /^\(?\s*prefers-color-scheme\s*:\s*light\s*\)?$/i;

  function readInitialEnabled() {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage) {
        return sessionStorage.getItem(STORAGE_KEY) !== '0';
      }
    } catch (_) {
      // Ignore Storage/SecurityError on restricted origins
    }
    return true;
  }

  let enabled = readInitialEnabled();

  function persistEnabled(next) {
    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage) {
        sessionStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      }
    } catch (_) {
      // Ignore Storage/SecurityError on restricted origins
    }
  }

  function classifyQuery(query) {
    const q = String(query || '').trim();
    if (DARK_SCHEME_RE.test(q)) return 'dark';
    if (LIGHT_SCHEME_RE.test(q)) return 'light';
    return null;
  }

  const win = typeof window !== 'undefined' ? window : global;
  const origMatchMedia =
    win && typeof win.matchMedia === 'function' ? win.matchMedia.bind(win) : null;

  const trackedLists = new Set();

  function createWrappedMql(query, kind, nativeMql) {
    const listeners = new Set();
    let onchangeHandler = null;

    function computeMatches() {
      if (enabled) {
        return kind === 'dark';
      }
      return nativeMql ? Boolean(nativeMql.matches) : false;
    }

    let lastMatches = computeMatches();

    const wrapper = {
      get media() {
        return nativeMql && typeof nativeMql.media === 'string' ? nativeMql.media : String(query);
      },
      get matches() {
        return computeMatches();
      },
      get onchange() {
        return onchangeHandler;
      },
      set onchange(fn) {
        onchangeHandler = typeof fn === 'function' ? fn : null;
      },
      addEventListener(type, listener) {
        if (type === 'change' && typeof listener === 'function') {
          listeners.add(listener);
        }
      },
      removeEventListener(type, listener) {
        if (type === 'change') {
          listeners.delete(listener);
        }
      },
      addListener(listener) {
        if (typeof listener === 'function') {
          listeners.add(listener);
        }
      },
      removeListener(listener) {
        listeners.delete(listener);
      },
      dispatchEvent(evt) {
        if (onchangeHandler) {
          try {
            onchangeHandler.call(wrapper, evt);
          } catch (_) {
            // Ignore listener errors
          }
        }
        for (const fn of listeners) {
          try {
            fn.call(wrapper, evt);
          } catch (_) {
            // Ignore listener errors
          }
        }
        return true;
      }
    };

    function notifyIfChanged() {
      const nextMatches = computeMatches();
      if (nextMatches === lastMatches) {
        return;
      }
      lastMatches = nextMatches;
      const evt =
        typeof MediaQueryListEvent === 'function'
          ? new MediaQueryListEvent('change', {
              media: wrapper.media,
              matches: nextMatches
            })
          : {
              type: 'change',
              media: wrapper.media,
              matches: nextMatches,
              target: wrapper,
              currentTarget: wrapper
            };
      wrapper.dispatchEvent(evt);
    }

    if (nativeMql && typeof nativeMql.addEventListener === 'function') {
      nativeMql.addEventListener('change', () => {
        if (!enabled) {
          notifyIfChanged();
        }
      });
    }

    trackedLists.add({ notifyIfChanged });
    return wrapper;
  }

  function setEnabled(next) {
    const normalized = Boolean(next);
    if (normalized === enabled) {
      persistEnabled(normalized);
      return;
    }
    enabled = normalized;
    persistEnabled(normalized);
    for (const entry of trackedLists) {
      entry.notifyIfChanged();
    }
  }

  if (win && origMatchMedia) {
    win.matchMedia = function wrappedMatchMedia(query) {
      const kind = classifyQuery(query);
      const nativeMql = origMatchMedia(query);
      if (!kind) {
        return nativeMql;
      }
      return createWrappedMql(query, kind, nativeMql);
    };
  }

  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener(EVENT_NAME, (event) => {
      const detail = event && event.detail;
      if (detail && typeof detail.enabled === 'boolean') {
        setEnabled(detail.enabled);
      }
    });
  }

  const api = {
    isEnabled: () => enabled,
    setEnabled
  };

  global.__darkextNativeEnforcer = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
