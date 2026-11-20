'use strict';

(function initDetector(global) {
  const DarkExt = (global.DarkExt = global.DarkExt || {});

  const DARK_LUMINANCE_THRESHOLD = 0.22;

  const DARK_CLASS_RE = /^(dark|dark-mode|dark-theme|theme-dark|night|night-mode|is-dark|color-scheme-dark|theme--dark|sl-theme-dark)$/i;
  const DARK_ATTR_NAMES = [
    'data-theme',
    'data-color-mode',
    'data-bs-theme',
    'data-mode',
    'data-color-scheme',
    'data-ui-theme',
    'theme'
  ];
  const DARK_ATTR_VAL_RE = /^(dark|night|black|oled|midnight|dim|dark[-_].*)$/i;
  const PRIMARY_CONTAINER_SELECTOR = 'main, [role="main"], #main, #content, #app, #root, #__next, .app, .main-content';
  const MAX_CANDIDATE_CHECKS = 15;
  const EARLY_EXIT_COVERAGE = 0.55;

  function getColorUtils() {
    return DarkExt.ColorUtils || null;
  }

  function parseBgSample(el, win, ColorUtils) {
    if (!el || !win || typeof win.getComputedStyle !== 'function' || !ColorUtils) {
      return null;
    }
    let style;
    try {
      style = win.getComputedStyle(el);
    } catch (_) {
      return null;
    }
    const bgStr = style && style.backgroundColor;
    if (!bgStr || bgStr === 'transparent' || bgStr === 'rgba(0, 0, 0, 0)') {
      return null;
    }
    const parsed = ColorUtils.parseCssColor(bgStr);
    if (!parsed) {
      return null;
    }
    const alpha = typeof parsed.a === 'number' ? parsed.a : 1;
    if (alpha < 0.5) {
      return null;
    }
    const lum = ColorUtils.relativeLuminance(parsed);
    if (typeof lum !== 'number' || Number.isNaN(lum)) {
      return null;
    }
    return { lum, alpha, color: parsed, style };
  }

  function parseTextLuminance(el, win, ColorUtils) {
    if (!el || !win || typeof win.getComputedStyle !== 'function' || !ColorUtils) {
      return null;
    }
    try {
      const style = win.getComputedStyle(el);
      if (!style || !style.color) return null;
      const parsed = ColorUtils.parseCssColor(style.color);
      if (!parsed || (typeof parsed.a === 'number' && parsed.a < 0.2)) return null;
      const lum = ColorUtils.relativeLuminance(parsed);
      return typeof lum === 'number' && !Number.isNaN(lum) ? lum : null;
    } catch (_) {
      return null;
    }
  }

  function inspectMetaColorScheme(doc) {
    const result = { hasDark: false, hasLight: false, isDarkOnly: false, isAdaptive: false };
    if (!doc || typeof doc.querySelectorAll !== 'function') {
      return result;
    }
    const metas = doc.querySelectorAll('meta[name="color-scheme"], meta[name="supported-color-schemes"]');
    for (const meta of metas) {
      const content = (meta.getAttribute('content') || '').toLowerCase().trim();
      if (!content) continue;
      const tokens = content.split(/[\s,]+/).filter(Boolean);
      if (tokens.includes('dark')) result.hasDark = true;
      if (tokens.includes('light')) result.hasLight = true;
    }
    result.isDarkOnly = result.hasDark && !result.hasLight;
    result.isAdaptive = result.hasDark && result.hasLight;
    return result;
  }

  function hasDarkHintsOnElement(el) {
    if (!el) return false;
    if (el.classList && el.classList.length > 0) {
      for (const cls of el.classList) {
        if (!cls.startsWith('darkext') && DARK_CLASS_RE.test(cls)) {
          return true;
        }
      }
    } else if (typeof el.className === 'string' && el.className) {
      const tokens = el.className.trim().split(/\s+/);
      for (const cls of tokens) {
        if (!cls.startsWith('darkext') && DARK_CLASS_RE.test(cls)) {
          return true;
        }
      }
    }
    if (typeof el.getAttribute === 'function') {
      for (const attr of DARK_ATTR_NAMES) {
        const val = el.getAttribute(attr);
        if (val && DARK_ATTR_VAL_RE.test(val.trim())) {
          return true;
        }
      }
    }
    return false;
  }

  function findLargestContainerSample(doc, body, win, ColorUtils) {
    if (!doc || !win || typeof doc.querySelectorAll !== 'function') {
      return null;
    }

    const vw = win.innerWidth || 1024;
    const vh = win.innerHeight || 768;
    const viewportArea = Math.max(1, vw * vh);

    const candidates = [];
    const seen = new Set();

    const named = doc.querySelectorAll(PRIMARY_CONTAINER_SELECTOR);
    for (const el of named) {
      if (!seen.has(el)) {
        seen.add(el);
        candidates.push(el);
        if (candidates.length >= MAX_CANDIDATE_CHECKS) {
          break;
        }
      }
    }

    if (candidates.length < MAX_CANDIDATE_CHECKS && body && body.children) {
      const limit = Math.min(body.children.length, 12);
      for (let i = 0; i < limit; i += 1) {
        const child = body.children[i];
        const tag = (child.tagName || '').toUpperCase();
        if (
          tag === 'SCRIPT' ||
          tag === 'STYLE' ||
          tag === 'LINK' ||
          tag === 'HEADER' ||
          tag === 'NAV' ||
          tag === 'FOOTER' ||
          child.id === 'darkext-toast-host'
        ) {
          continue;
        }
        if (!seen.has(child)) {
          seen.add(child);
          candidates.push(child);
          if (candidates.length >= MAX_CANDIDATE_CHECKS) {
            break;
          }
        }
      }
    }

    let best = null;
    const scanLimit = Math.min(candidates.length, MAX_CANDIDATE_CHECKS);
    for (let i = 0; i < scanLimit; i += 1) {
      const el = candidates[i];
      const sample = parseBgSample(el, win, ColorUtils);
      if (!sample) continue;
      if (sample.style.display === 'none' || sample.style.visibility === 'hidden') {
        continue;
      }
      let area = 0;
      if (typeof el.getBoundingClientRect === 'function') {
        try {
          const rect = el.getBoundingClientRect();
          if (rect && rect.width > 0 && rect.height > 0) {
            area = rect.width * rect.height;
          }
        } catch (_) {
          area = 0;
        }
      }
      const coverage = area / viewportArea;
      // Only consider containers that cover meaningful area, or have zero layout box in headless mocks
      if (area > 0 && coverage < 0.25) {
        continue;
      }
      if (!best || area > best.area) {
        best = { el, sample, area, coverage };
        if (coverage >= EARLY_EXIT_COVERAGE) {
          break;
        }
      }
    }

    return best;
  }

  function detectNativeDarkMode(doc) {
    const targetDoc = doc || (typeof document !== 'undefined' ? document : null);
    if (!targetDoc || !targetDoc.documentElement) {
      return {
        isNativeDark: false,
        confidence: 0,
        reason: 'no-document',
        bgLuminance: 1
      };
    }

    const root = targetDoc.documentElement;
    const body = targetDoc.body || null;
    const win = targetDoc.defaultView || (typeof window !== 'undefined' ? window : global);
    const ColorUtils = getColorUtils();

    const metaInfo = inspectMetaColorScheme(targetDoc);
    let systemDark = false;
    try {
      systemDark = Boolean(
        win &&
        typeof win.matchMedia === 'function' &&
        win.matchMedia('(prefers-color-scheme: dark)').matches
      );
    } catch (_) {
      systemDark = false;
    }

    // Check computed CSS color-scheme on root only when DarkExtension isn't active on root
    let computedDarkColorScheme = false;
    const darkExtActiveOnRoot = typeof root.hasAttribute === 'function' && root.hasAttribute('data-darkext-active');
    if (!darkExtActiveOnRoot && win && typeof win.getComputedStyle === 'function') {
      try {
        const rootStyle = win.getComputedStyle(root);
        const cs = (rootStyle && rootStyle.colorScheme ? String(rootStyle.colorScheme) : '').toLowerCase();
        if (cs.includes('dark') && (!cs.includes('light') || systemDark)) {
          computedDarkColorScheme = true;
        }
      } catch (_) {
        computedDarkColorScheme = false;
      }
    }

    const htmlSample = parseBgSample(root, win, ColorUtils);
    const bodySample = parseBgSample(body, win, ColorUtils);
    const containerBest = findLargestContainerSample(targetDoc, body, win, ColorUtils);

    let effectiveSample = null;
    let primaryEl = body || root;

    if (containerBest && containerBest.coverage >= 0.45) {
      effectiveSample = containerBest.sample;
      primaryEl = containerBest.el;
    } else if (bodySample) {
      effectiveSample = bodySample;
      primaryEl = body;
    } else if (containerBest) {
      effectiveSample = containerBest.sample;
      primaryEl = containerBest.el;
    } else if (htmlSample) {
      effectiveSample = htmlSample;
      primaryEl = root;
    }

    const opaqueFound = Boolean(effectiveSample);
    const bgLuminance = opaqueFound ? effectiveSample.lum : 1;
    const hasDarkAttr = hasDarkHintsOnElement(root) || hasDarkHintsOnElement(body);
    const metaDarkEffective = metaInfo.isDarkOnly || (metaInfo.isAdaptive && systemDark) || computedDarkColorScheme;

    if (hasDarkAttr) {
      if (opaqueFound && bgLuminance < DARK_LUMINANCE_THRESHOLD) {
        return {
          isNativeDark: true,
          confidence: 0.96,
          reason: 'dark-attribute-verified',
          bgLuminance
        };
      }
      if (!opaqueFound && metaDarkEffective) {
        return {
          isNativeDark: true,
          confidence: 0.88,
          reason: 'dark-attribute-and-color-scheme',
          bgLuminance: 0.05
        };
      }
      return {
        isNativeDark: false,
        confidence: 0.9,
        reason: 'dark-attribute-rejected-by-light-bg',
        bgLuminance
      };
    }

    if (metaDarkEffective) {
      if (!opaqueFound) {
        return {
          isNativeDark: true,
          confidence: 0.9,
          reason: metaInfo.hasDark ? 'meta-color-scheme-dark' : 'css-color-scheme-dark',
          bgLuminance: 0.05
        };
      }
      if (bgLuminance < DARK_LUMINANCE_THRESHOLD) {
        return {
          isNativeDark: true,
          confidence: 0.95,
          reason: 'color-scheme-and-dark-bg',
          bgLuminance
        };
      }
      return {
        isNativeDark: false,
        confidence: 0.85,
        reason: 'light-bg-overrides-color-scheme',
        bgLuminance
      };
    }

    if (opaqueFound && bgLuminance < DARK_LUMINANCE_THRESHOLD) {
      const textLum = parseTextLuminance(primaryEl, win, ColorUtils);
      if (textLum !== null && textLum > 0.35) {
        return {
          isNativeDark: true,
          confidence: 0.92,
          reason: 'computed-dark-bg-light-text',
          bgLuminance
        };
      }
      return {
        isNativeDark: true,
        confidence: 0.78,
        reason: 'computed-dark-bg',
        bgLuminance
      };
    }

    return {
      isNativeDark: false,
      confidence: 0.92,
      reason: 'light-background',
      bgLuminance
    };
  }

  DarkExt.Detector = {
    detectNativeDarkMode
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DarkExt.Detector;
  }
})(globalThis);
