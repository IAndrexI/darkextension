'use strict';

(function initDynamicEngine(global) {
  const DarkExt = (global.DarkExt = global.DarkExt || {});

  const MICRO_BATCH_SIZE = 64;
  const FRAME_BUDGET_MS = 8;
  const MAX_NODES_PER_FRAME = 256;
  const QUEUE_COMPACT_THRESHOLD = 512;
  const MAX_VIBRANT_CACHE_SIZE = 512;
  const MUTATION_DEBOUNCE_MS = 100;
  const TOAST_DURATION_MS = 2200;

  const RUNTIME_VARS_STYLE_ID = 'darkext-runtime-vars';
  const CUSTOM_CSS_STYLE_ID = 'darkext-custom-css';
  const TOAST_HOST_ID = 'darkext-toast-host';
  const STYLED_ATTR = 'data-darkext-styled';

  const DEFAULT_ANCESTOR_BG = Object.freeze({
    lum: 0.02,
    isVibrant: false,
    hasUrlBg: false,
    hasBrightVibrant: false
  });
  const DARKENED_BG_INFO = Object.freeze({
    lum: 0.02,
    isVibrant: false,
    hasUrlBg: false,
    hasBrightVibrant: false
  });

  const SKIP_TAGS = new Set([
    'IMG',
    'VIDEO',
    'PICTURE',
    'CANVAS',
    'IFRAME',
    'SVG',
    'EMBED',
    'OBJECT',
    'SOURCE',
    'TRACK',
    'MAP',
    'AREA',
    'SCRIPT',
    'STYLE',
    'LINK',
    'META',
    'TITLE',
    'HEAD',
    'NOSCRIPT',
    'TEMPLATE'
  ]);

  const BORDER_PROPS = [
    ['borderTopColor', 'border-top-color', 'borderTopWidth', 'borderTopStyle'],
    ['borderRightColor', 'border-right-color', 'borderRightWidth', 'borderRightStyle'],
    ['borderBottomColor', 'border-bottom-color', 'borderBottomWidth', 'borderBottomStyle'],
    ['borderLeftColor', 'border-left-color', 'borderLeftWidth', 'borderLeftStyle']
  ];

  const trackedProps = [
    ['backgroundColor', 'background-color'],
    ['backgroundImage', 'background-image'],
    ['color', 'color'],
    ['borderTopColor', 'border-top-color'],
    ['borderRightColor', 'border-right-color'],
    ['borderBottomColor', 'border-bottom-color'],
    ['borderLeftColor', 'border-left-color']
  ];

  let active = false;
  let currentConfig = null;
  let rafId = null;
  let mutationDebounceTimer = null;
  let toastDismissTimer = null;
  let toastRemoveTimer = null;

  let pendingQueue = [];
  let queueHead = 0;
  let queuedSet = new WeakSet();
  let hiddenSkippedSet = new WeakSet();
  const addedSubtreeBuffer = new Set();
  const attrTargetBuffer = new Set();
  const vibrantColorCache = new Map();

  let originalStyles = new WeakMap();
  let appliedStyles = new WeakMap();
  let observedShadows = new WeakSet();
  const trackedShadowRoots = new Set();
  const shadowObservers = [];
  let mainObserver = null;

  let spaHooked = false;
  let origPushState = null;
  let origReplaceState = null;
  let lastKnownUrl = typeof location !== 'undefined' ? location.href : '';
  let popstateHandler = null;
  let hashchangeHandler = null;
  let navSuccessHandler = null;

  function nowMs() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function clearPendingQueue() {
    pendingQueue.length = 0;
    queueHead = 0;
    queuedSet = new WeakSet();
    hiddenSkippedSet = new WeakSet();
  }

  function compactQueue() {
    if (queueHead >= pendingQueue.length) {
      pendingQueue.length = 0;
      queueHead = 0;
    } else if (queueHead >= QUEUE_COMPACT_THRESHOLD) {
      pendingQueue = pendingQueue.slice(queueHead);
      queueHead = 0;
    }
  }

  function getConstants() {
    return DarkExt.Constants || {};
  }

  function getColorUtils() {
    return DarkExt.ColorUtils || null;
  }

  function isSweepMode(mode) {
    return mode === 'dynamic' || mode === 'site-theme';
  }

  function getPresetColors(presetId) {
    const Constants = getConstants();
    const presets = Constants.THEME_PRESETS || {};
    return presets[presetId] || presets.midnight || {
      bg: '#121418',
      elevated: '#1b1f29',
      subtle: '#242a38',
      border: '#384156',
      borderStrong: '#505d7a',
      text: '#f4f6fa',
      secondary: '#c4ccd9',
      link: '#82b8ff',
      accent: '#4f78ff',
      accentText: '#ffffff'
    };
  }

  function clampNum(val, min, max, fallback) {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  }

  function shouldSkipElement(el) {
    if (!el || el.nodeType !== 1) return true;
    if (el.id === TOAST_HOST_ID || el.id === RUNTIME_VARS_STYLE_ID || el.id === CUSTOM_CSS_STYLE_ID) {
      return true;
    }
    if (el.hasAttribute && el.hasAttribute('data-darkext-fallback')) {
      return true;
    }
    const tag = (el.tagName || '').toUpperCase();
    if (SKIP_TAGS.has(tag)) return true;
    if (el.namespaceURI === 'http://www.w3.org/2000/svg') return true;
    return false;
  }

  function isVibrantBrandColor(parsed, ColorUtils) {
    if (!parsed || parsed.a < 0.2 || !ColorUtils) return false;
    const key = ((parsed.r & 0xff) << 16) | ((parsed.g & 0xff) << 8) | (parsed.b & 0xff);
    if (vibrantColorCache.has(key)) {
      return vibrantColorCache.get(key);
    }
    const hsl = ColorUtils.rgbToHsl(parsed);
    const maxC = Math.max(parsed.r, parsed.g, parsed.b);
    const minC = Math.min(parsed.r, parsed.g, parsed.b);
    const chroma = (maxC - minC) / 255;
    const lum = ColorUtils.relativeLuminance(parsed);
    if (lum === null) return false;
    // Distinguish genuine saturated brand fills (e.g. CTAs/badges) from pale pastel backgrounds
    const result = chroma >= 0.28 && hsl.s >= 35 && hsl.l >= 22 && hsl.l <= 72 && lum < 0.78;
    if (vibrantColorCache.size >= MAX_VIBRANT_CACHE_SIZE) {
      const oldestKey = vibrantColorCache.keys().next().value;
      vibrantColorCache.delete(oldestKey);
    }
    vibrantColorCache.set(key, result);
    return result;
  }

  function getComputedStyleCached(el, win, styleCache) {
    if (!el || !win || typeof win.getComputedStyle !== 'function') {
      return null;
    }
    if (styleCache && styleCache.has(el)) {
      return styleCache.get(el);
    }
    let style = null;
    try {
      style = win.getComputedStyle(el);
    } catch (_) {
      style = null;
    }
    if (styleCache) {
      styleCache.set(el, style);
    }
    return style;
  }

  function backupOriginalStyles(el) {
    if (originalStyles.has(el)) {
      return originalStyles.get(el);
    }
    const snapshot = {
      hadStyleAttr: el.hasAttribute('style'),
      props: {}
    };
    for (const [jsProp, cssProp] of trackedProps) {
      snapshot.props[jsProp] = {
        value: el.style.getPropertyValue(cssProp),
        priority: el.style.getPropertyPriority(cssProp)
      };
    }
    originalStyles.set(el, snapshot);
    return snapshot;
  }

  function restoreElementStyles(el) {
    if (!el) return;
    const snapshot = originalStyles.get(el);
    if (snapshot) {
      for (const [jsProp, cssProp] of trackedProps) {
        const orig = snapshot.props[jsProp];
        if (orig && orig.value) {
          el.style.setProperty(cssProp, orig.value, orig.priority || '');
        } else {
          el.style.removeProperty(cssProp);
        }
      }
      if (!snapshot.hadStyleAttr && el.style.length === 0) {
        el.removeAttribute('style');
      }
      originalStyles.delete(el);
    }
    appliedStyles.delete(el);
    if (el.hasAttribute && el.hasAttribute(STYLED_ATTR)) {
      el.removeAttribute(STYLED_ATTR);
    }
  }

  function isCardLikeElement(el, style) {
    if (!el || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'BODY' || tag === 'HTML' || tag === 'MAIN') return false;
    if (tag === 'ARTICLE') return true;
    const role = el.getAttribute ? (el.getAttribute('role') || '').toLowerCase() : '';
    if (role === 'dialog' || role === 'menu' || role === 'listbox') return true;
    if (style && style.boxShadow && style.boxShadow !== 'none') return true;
    if (style) {
      for (let i = 0; i < BORDER_PROPS.length; i += 1) {
        const [, , widthProp, styleProp] = BORDER_PROPS[i];
        const bw = style[widthProp];
        const bs = style[styleProp];
        if (bw && bw !== '0px' && bs && bs !== 'none' && parseFloat(bw) > 0) {
          return true;
        }
      }
    }
    const cls = typeof el.className === 'string' ? el.className : '';
    return /\b(?:card|tile|panel|popover|modal|dropdown|buybox|item-card)\b/i.test(cls);
  }

  function isSearchOrSubmitButton(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toUpperCase();
    const type = el.getAttribute ? (el.getAttribute('type') || '').toLowerCase() : '';
    if ((tag === 'INPUT' || tag === 'BUTTON') && type === 'submit') return true;
    const role = el.getAttribute ? (el.getAttribute('role') || '').toLowerCase() : '';
    if (tag === 'BUTTON' || role === 'button') {
      const ariaLabel = el.getAttribute ? (el.getAttribute('aria-label') || '') : '';
      const title = el.getAttribute ? (el.getAttribute('title') || '') : '';
      const cls = typeof el.className === 'string' ? el.className : '';
      return /\bsearch\b/i.test(ariaLabel) || /\bsearch\b/i.test(title) || /\bsearch[-_]?(?:btn|button)\b/i.test(cls);
    }
    return false;
  }

  function isTransparentOverlayInput(el, style) {
    if (!el || el.nodeType !== 1) return false;
    if (el.id === 'nav-search-submit-button') return true;
    if (el.classList && el.classList.contains('a-button-input')) return true;
    const tag = (el.tagName || '').toUpperCase();
    if (tag === 'INPUT' && style && style.opacity !== '1' && parseFloat(style.opacity || '1') < 0.12) {
      return true;
    }
    return false;
  }

  function hasLightCssGradient(style, ColorUtils) {
    const bgImg = style && style.backgroundImage;
    if (!bgImg || bgImg === 'none') return false;
    const lower = bgImg.toLowerCase();
    if (lower.includes('url(') || !lower.includes('gradient(')) {
      return false;
    }
    const tokens = bgImg.match(
      /rgba?\([^)]+\)|hsla?\([^)]+\)|#[0-9a-f]{3,8}\b|\b(?:white|snow|ivory|whitesmoke|gainsboro|lightgrey|lightgray|silver|aliceblue|ghostwhite|seashell|beige|linen)\b/gi
    );
    if (!tokens || tokens.length === 0) {
      return true;
    }
    let sawParseable = false;
    for (const token of tokens) {
      const lowerTok = token.toLowerCase();
      if (
        lowerTok === 'white' ||
        lowerTok === 'snow' ||
        lowerTok === 'ivory' ||
        lowerTok === 'whitesmoke' ||
        lowerTok === 'gainsboro' ||
        lowerTok === 'lightgrey' ||
        lowerTok === 'lightgray' ||
        lowerTok === 'silver' ||
        lowerTok === 'aliceblue' ||
        lowerTok === 'ghostwhite' ||
        lowerTok === 'seashell' ||
        lowerTok === 'beige' ||
        lowerTok === 'linen'
      ) {
        return true;
      }
      const parsed = ColorUtils.parseCssColor(token);
      if (!parsed || parsed.a < 0.08) continue;
      sawParseable = true;
      const lum = ColorUtils.relativeLuminance(parsed);
      if (lum !== null && lum > 0.2 && !isVibrantBrandColor(parsed, ColorUtils)) {
        return true;
      }
    }
    return !sawParseable;
  }

  function getAncestorBackgroundInfo(startEl, win, ColorUtils, styleCache, ancestorBgCache) {
    if (!startEl || !win || typeof win.getComputedStyle !== 'function' || !ColorUtils) {
      return DEFAULT_ANCESTOR_BG;
    }
    if (ancestorBgCache && ancestorBgCache.has(startEl)) {
      return ancestorBgCache.get(startEl);
    }

    let cur = startEl;
    let result = DEFAULT_ANCESTOR_BG;
    for (let depth = 0; depth < 6 && cur; depth += 1) {
      if (depth > 0 && ancestorBgCache && ancestorBgCache.has(cur)) {
        result = ancestorBgCache.get(cur);
        break;
      }
      const st = getComputedStyleCached(cur, win, styleCache);
      if (!st) {
        break;
      }
      const bgImg = st.backgroundImage || '';
      if (bgImg && bgImg !== 'none' && bgImg.toLowerCase().includes('url(')) {
        result = { lum: 0.25, isVibrant: false, hasUrlBg: true, hasBrightVibrant: false };
        break;
      }
      const bgStr = st.backgroundColor;
      if (bgStr && bgStr !== 'rgba(0, 0, 0, 0)' && bgStr !== 'transparent') {
        const c = ColorUtils.parseCssColor(bgStr);
        if (c && c.a >= 0.25) {
          const lum = ColorUtils.relativeLuminance(c);
          const resolvedLum = lum === null ? 0.02 : lum;
          const isVibrant = isVibrantBrandColor(c, ColorUtils);
          const upperTag = cur.tagName ? cur.tagName.toUpperCase() : '';
          const hasBrightVibrant =
            depth < 4 &&
            upperTag !== 'BODY' &&
            upperTag !== 'HTML' &&
            c.a >= 0.5 &&
            isVibrant &&
            resolvedLum > 0.35;
          result = {
            lum: resolvedLum,
            isVibrant,
            hasUrlBg: false,
            hasBrightVibrant
          };
          break;
        }
      }
      cur = cur.parentElement;
    }

    if (ancestorBgCache) {
      ancestorBgCache.set(startEl, result);
    }
    return result;
  }

  function computeDarkeningPlan(el, style, presetColors, win, ColorUtils, options, styleCache, ancestorBgCache) {
    if (style.display === 'none' || isTransparentOverlayInput(el, style)) {
      return null;
    }

    const plan = {};
    let hasChanges = false;
    const isSiteThemeSweep = Boolean(options && options.siteThemeSweep);
    const bgImg = style.backgroundImage;
    const hasBgImg = Boolean(bgImg) && bgImg !== 'none';
    const hasBgUrlImage = hasBgImg && bgImg.toLowerCase().includes('url(');

    const bgStr = style.backgroundColor;
    const bg =
      !bgStr || bgStr === 'rgba(0, 0, 0, 0)' || bgStr === 'transparent'
        ? null
        : ColorUtils.parseCssColor(bgStr);
    const bgLum = bg && bg.a >= 0.08 ? ColorUtils.relativeLuminance(bg) : null;

    const fgStr = style.color;
    const fg =
      !fgStr || fgStr === 'rgba(0, 0, 0, 0)' || fgStr === 'transparent'
        ? null
        : ColorUtils.parseCssColor(fgStr);
    const fgLum = fg && fg.a >= 0.1 ? ColorUtils.relativeLuminance(fg) : null;

    const tag = (el.tagName || '').toUpperCase();
    const role = el.getAttribute ? (el.getAttribute('role') || '').toLowerCase() : '';
    const cardLike = isCardLikeElement(el, style);
    const submitOrSearch = isSearchOrSubmitButton(el);
    const isInputOrButton =
      tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON' || role === 'button';

    let bgPreservedBright = false;
    let bgDarkened = false;
    let accentAppliedToSubmit = false;

    const hasSelfVibrantBg = Boolean(bg && bg.a >= 0.2 && isVibrantBrandColor(bg, ColorUtils));
    const lightGradient = hasBgImg && !hasBgUrlImage && !hasSelfVibrantBg && hasLightCssGradient(style, ColorUtils);

    if (lightGradient) {
      plan.backgroundImage = 'none';
      if (submitOrSearch && !isSiteThemeSweep && presetColors.accent) {
        plan.backgroundColor = presetColors.accent;
        plan.color = presetColors.accentText || '#ffffff';
        accentAppliedToSubmit = true;
      } else {
        plan.backgroundColor = cardLike
          ? (presetColors.elevated || '#1b1f29')
          : (presetColors.bg || '#121418');
      }
      bgDarkened = true;
      hasChanges = true;
    }

    if (!bgDarkened && !hasBgUrlImage && bg && bg.a >= 0.08) {
      if (hasSelfVibrantBg) {
        // Preserve brand/CTA element color; ensure text contrast stays readable
        if (bgLum !== null && bgLum > 0.35) {
          bgPreservedBright = true;
        } else if (bgLum !== null && bgLum <= 0.25 && fgLum !== null && fgLum < 0.35) {
          const lightFg = ColorUtils.lightenTextColor(fg, presetColors);
          if (lightFg) {
            plan.color = lightFg;
            hasChanges = true;
          }
        }
      } else if (bgLum !== null && bgLum > 0.13) {
        if (submitOrSearch && !isSiteThemeSweep && presetColors.accent) {
          plan.backgroundColor = presetColors.accent;
          plan.color = presetColors.accentText || '#ffffff';
          bgDarkened = true;
          accentAppliedToSubmit = true;
          hasChanges = true;
        } else if (!(isSiteThemeSweep && submitOrSearch)) {
          let darkBg = ColorUtils.darkenBackgroundColor(bg, presetColors);
          if (
            darkBg &&
            cardLike &&
            presetColors.elevated &&
            darkBg.toLowerCase() === String(presetColors.bg || '').toLowerCase()
          ) {
            darkBg = presetColors.elevated;
          }
          if (darkBg) {
            plan.backgroundColor = darkBg;
            bgDarkened = true;
            hasChanges = true;
          }
        }
      } else if (bgLum !== null && bgLum <= 0.13 && bg.a >= 0.7 && fgLum !== null && fgLum < 0.35 && !submitOrSearch) {
        const lightFg = ColorUtils.lightenTextColor(fg, presetColors);
        if (lightFg) {
          plan.color = lightFg;
          hasChanges = true;
        }
      }
    }

    let effectiveBg;
    let ancestorBgInfo = null;
    if (bgDarkened) {
      effectiveBg = DARKENED_BG_INFO;
    } else if (!hasBgUrlImage && bg && bg.a >= 0.25) {
      effectiveBg = {
        lum: bgLum === null ? 0.02 : bgLum,
        isVibrant: hasSelfVibrantBg,
        hasUrlBg: false,
        hasBrightVibrant: false
      };
    } else {
      ancestorBgInfo = getAncestorBackgroundInfo(el.parentElement, win, ColorUtils, styleCache, ancestorBgCache);
      effectiveBg = ancestorBgInfo;
    }

    if (
      !accentAppliedToSubmit &&
      !bgPreservedBright &&
      !effectiveBg.hasUrlBg &&
      !(effectiveBg.isVibrant && effectiveBg.lum > 0.35)
    ) {
      if (fg && fg.a >= 0.1 && fgLum !== null && fgLum < 0.55 && !(isSiteThemeSweep && submitOrSearch)) {
        let hasBrightVibrantAncestorFlag = false;
        if (!bgDarkened && effectiveBg.lum >= 0.22) {
          const info =
            ancestorBgInfo ||
            getAncestorBackgroundInfo(el.parentElement, win, ColorUtils, styleCache, ancestorBgCache);
          hasBrightVibrantAncestorFlag = Boolean(info && info.hasBrightVibrant);
        }
        if (bgDarkened || effectiveBg.lum < 0.22 || !hasBrightVibrantAncestorFlag) {
          const lightFg = ColorUtils.lightenTextColor(fg, presetColors);
          if (lightFg) {
            plan.color = lightFg;
            hasChanges = true;
          }
        }
      }
    } else if (
      !accentAppliedToSubmit &&
      !effectiveBg.hasUrlBg &&
      (bgPreservedBright || (effectiveBg.isVibrant && effectiveBg.lum > 0.42))
    ) {
      if (fg && fg.a >= 0.1 && fgLum !== null && fgLum > 0.58) {
        plan.color = '#0f1111';
        hasChanges = true;
      }
    }

    for (let i = 0; i < BORDER_PROPS.length; i += 1) {
      const [jsProp, , widthProp, styleProp] = BORDER_PROPS[i];
      const widthStr = style[widthProp];
      const bStyle = style[styleProp];
      if (!widthStr || widthStr === '0px' || !bStyle || bStyle === 'none') {
        continue;
      }
      const bWidth = parseFloat(widthStr);
      if (!bWidth || bWidth <= 0) {
        continue;
      }
      const bColorStr = style[jsProp];
      if (!bColorStr || bColorStr === 'rgba(0, 0, 0, 0)' || bColorStr === 'transparent') {
        continue;
      }
      const bColor = ColorUtils.parseCssColor(bColorStr);
      if (!bColor || bColor.a < 0.1) continue;
      const bLum = ColorUtils.relativeLuminance(bColor);
      if (bLum !== null && bLum > 0.35 && !isVibrantBrandColor(bColor, ColorUtils)) {
        if (accentAppliedToSubmit && presetColors.accent) {
          plan[jsProp] = presetColors.accent;
        } else if (cardLike || isInputOrButton) {
          plan[jsProp] = presetColors.borderStrong || presetColors.border || '#505d7a';
        } else {
          plan[jsProp] = presetColors.border || '#384156';
        }
        hasChanges = true;
      }
    }

    return hasChanges ? plan : null;
  }

  function applyPlanToElement(el, plan) {
    if (!plan) return;
    let hasAny = false;
    for (const key in plan) {
      if (Object.prototype.hasOwnProperty.call(plan, key)) {
        hasAny = true;
        break;
      }
    }
    if (!hasAny) {
      return;
    }

    backupOriginalStyles(el);
    const applied = {};

    for (const [jsProp, cssProp] of trackedProps) {
      if (Object.prototype.hasOwnProperty.call(plan, jsProp)) {
        const nextVal = plan[jsProp];
        el.style.setProperty(cssProp, nextVal, 'important');
        applied[jsProp] = el.style[jsProp];
      }
    }

    el.setAttribute(STYLED_ATTR, '1');
    appliedStyles.set(el, applied);
  }

  function ensureShadowStyle(shadowRoot) {
    if (!shadowRoot || !shadowRoot.querySelector) return;
    if (shadowRoot.querySelector('style[data-darkext-shadow="true"]')) return;
    const styleEl = document.createElement('style');
    styleEl.setAttribute('data-darkext-shadow', 'true');
    styleEl.textContent = [
      ':host { color-scheme: dark; }',
      'a, a:link { color: var(--de-link, #7ab3ff); }',
      'input, textarea, select { background-color: var(--de-bg-elevated, #1a1d24); color: var(--de-text, #e6e9ef); border-color: var(--de-border, #2e3442); }'
    ].join('\n');
    shadowRoot.appendChild(styleEl);
  }

  function observeShadowRoot(shadowRoot) {
    if (!shadowRoot || observedShadows.has(shadowRoot) || typeof MutationObserver !== 'function') {
      return;
    }
    observedShadows.add(shadowRoot);
    trackedShadowRoots.add(shadowRoot);
    ensureShadowStyle(shadowRoot);

    const observer = new MutationObserver(handleMutations);
    observer.observe(shadowRoot, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style']
    });
    shadowObservers.push(observer);
  }

  function enqueueElement(el) {
    if (!el || el.nodeType !== 1 || shouldSkipElement(el) || queuedSet.has(el)) {
      return;
    }
    queuedSet.add(el);
    pendingQueue.push(el);
  }

  function enqueueSubtree(rootNode) {
    if (!rootNode) return;
    if (rootNode.nodeType === 1) {
      if (shouldSkipElement(rootNode)) return;
      if (rootNode.style && rootNode.style.display === 'none') {
        hiddenSkippedSet.add(rootNode);
        return;
      }
      enqueueElement(rootNode);
      if (rootNode.shadowRoot) {
        observeShadowRoot(rootNode.shadowRoot);
        enqueueSubtree(rootNode.shadowRoot);
      }
    }

    const walkerRoot = rootNode;
    if (typeof document !== 'undefined' && typeof document.createTreeWalker === 'function') {
      const hasNodeFilter = typeof NodeFilter !== 'undefined';
      const SHOW_ELEMENT = hasNodeFilter ? NodeFilter.SHOW_ELEMENT : 1;
      const FILTER_ACCEPT = hasNodeFilter && NodeFilter.FILTER_ACCEPT !== undefined ? NodeFilter.FILTER_ACCEPT : 1;
      const FILTER_REJECT = hasNodeFilter && NodeFilter.FILTER_REJECT !== undefined ? NodeFilter.FILTER_REJECT : 2;
      const walker = document.createTreeWalker(walkerRoot, SHOW_ELEMENT, {
        acceptNode(node) {
          if (shouldSkipElement(node)) {
            return FILTER_REJECT;
          }
          if (node.style && node.style.display === 'none') {
            hiddenSkippedSet.add(node);
            return FILTER_REJECT;
          }
          return FILTER_ACCEPT;
        }
      });
      let node = walker.nextNode();
      while (node) {
        if (!shouldSkipElement(node)) {
          if (node.style && node.style.display === 'none') {
            hiddenSkippedSet.add(node);
          } else {
            enqueueElement(node);
            if (node.shadowRoot) {
              observeShadowRoot(node.shadowRoot);
              enqueueSubtree(node.shadowRoot);
            }
          }
        }
        node = walker.nextNode();
      }
      return;
    }

    const children = rootNode.children || [];
    for (let i = 0; i < children.length; i += 1) {
      enqueueSubtree(children[i]);
    }
  }

  function scheduleBatchProcessing() {
    if (!active || !currentConfig || !isSweepMode(currentConfig.mode)) {
      return;
    }
    if (rafId !== null || queueHead >= pendingQueue.length) {
      return;
    }
    const scheduleRaf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
    rafId = scheduleRaf(processBatch);
  }

  function processBatch() {
    rafId = null;
    if (!active || !currentConfig || !isSweepMode(currentConfig.mode)) {
      clearPendingQueue();
      return;
    }

    const win = typeof window !== 'undefined' ? window : global;
    const ColorUtils = getColorUtils();
    if (!win || typeof win.getComputedStyle !== 'function' || !ColorUtils) {
      clearPendingQueue();
      return;
    }

    const presetColors = getPresetColors(currentConfig.preset);
    const planOptions = { siteThemeSweep: currentConfig.mode === 'site-theme' };
    const styleCache = new Map();
    const ancestorBgCache = new Map();

    const frameStart = nowMs();
    let totalProcessed = 0;

    while (
      queueHead < pendingQueue.length &&
      totalProcessed < MAX_NODES_PER_FRAME &&
      (totalProcessed === 0 || nowMs() - frameStart < FRAME_BUDGET_MS)
    ) {
      const microLimit = Math.min(MICRO_BATCH_SIZE, MAX_NODES_PER_FRAME - totalProcessed);
      const batch = [];

      while (batch.length < microLimit && queueHead < pendingQueue.length) {
        const el = pendingQueue[queueHead];
        pendingQueue[queueHead] = undefined;
        queueHead += 1;
        queuedSet.delete(el);
        if (!el || !el.isConnected || shouldSkipElement(el)) {
          continue;
        }
        if (el.style && el.style.display === 'none') {
          hiddenSkippedSet.add(el);
          continue;
        }
        // If previously styled and re-queued due to mutation, restore original before reading site style
        if (appliedStyles.has(el)) {
          restoreElementStyles(el);
          styleCache.delete(el);
          ancestorBgCache.delete(el);
        }
        batch.push(el);
      }

      if (batch.length === 0) {
        break;
      }

      // Read phase: compute all styles before mutating DOM to prevent layout thrashing
      const writes = [];
      for (let i = 0; i < batch.length; i += 1) {
        const el = batch[i];
        const computed = getComputedStyleCached(el, win, styleCache);
        if (!computed) continue;
        if (computed.display === 'none') {
          hiddenSkippedSet.add(el);
          continue;
        }
        const plan = computeDarkeningPlan(
          el,
          computed,
          presetColors,
          win,
          ColorUtils,
          planOptions,
          styleCache,
          ancestorBgCache
        );
        if (plan !== null) {
          writes.push([el, plan]);
        }
      }

      // Write phase
      for (let i = 0; i < writes.length; i += 1) {
        const [el, plan] = writes[i];
        if (el.isConnected) {
          applyPlanToElement(el, plan);
          if (plan.backgroundColor || plan.backgroundImage) {
            styleCache.delete(el);
            ancestorBgCache.delete(el);
          }
        }
      }

      totalProcessed += batch.length;
    }

    compactQueue();
    if (queueHead < pendingQueue.length) {
      scheduleBatchProcessing();
    }
  }

  function didInlineStyleDiverge(el) {
    const applied = appliedStyles.get(el);
    if (!applied) return true;
    for (const [jsProp] of trackedProps) {
      if (applied[jsProp] !== undefined && el.style[jsProp] !== applied[jsProp]) {
        return true;
      }
    }
    return false;
  }

  function handleMutations(records) {
    if (!active || !currentConfig || !isSweepMode(currentConfig.mode)) {
      return;
    }

    for (const record of records) {
      if (record.type === 'childList') {
        for (const added of record.addedNodes) {
          if (added && added.nodeType === 1 && !shouldSkipElement(added)) {
            addedSubtreeBuffer.add(added);
          }
        }
      } else if (record.type === 'attributes') {
        const target = record.target;
        if (!target || target.nodeType !== 1 || shouldSkipElement(target)) {
          continue;
        }
        if (target === document.documentElement && record.attributeName && record.attributeName.startsWith('data-darkext-')) {
          continue;
        }
        if (record.attributeName === 'style' && !didInlineStyleDiverge(target)) {
          continue;
        }
        attrTargetBuffer.add(target);
      }
    }

    if (typeof location !== 'undefined' && location.href !== lastKnownUrl) {
      lastKnownUrl = location.href;
      if (currentConfig && typeof currentConfig.onNavigate === 'function') {
        currentConfig.onNavigate(lastKnownUrl);
      }
    }

    if (addedSubtreeBuffer.size === 0 && attrTargetBuffer.size === 0) {
      return;
    }

    if (mutationDebounceTimer !== null) {
      clearTimeout(mutationDebounceTimer);
    }
    mutationDebounceTimer = setTimeout(flushMutationBuffer, MUTATION_DEBOUNCE_MS);
  }

  function flushMutationBuffer() {
    mutationDebounceTimer = null;
    if (!active || !currentConfig || !isSweepMode(currentConfig.mode)) {
      addedSubtreeBuffer.clear();
      attrTargetBuffer.clear();
      return;
    }

    for (const el of addedSubtreeBuffer) {
      if (el && el.isConnected && !shouldSkipElement(el)) {
        enqueueSubtree(el);
      }
    }
    addedSubtreeBuffer.clear();

    for (const target of attrTargetBuffer) {
      if (target && target.isConnected && !shouldSkipElement(target)) {
        if (hiddenSkippedSet.has(target)) {
          hiddenSkippedSet.delete(target);
          enqueueSubtree(target);
        } else {
          enqueueElement(target);
        }
      }
    }
    attrTargetBuffer.clear();

    scheduleBatchProcessing();
  }

  function startMutationObserver() {
    if (typeof document === 'undefined' || !document.documentElement || typeof MutationObserver !== 'function') {
      return;
    }
    if (!mainObserver) {
      mainObserver = new MutationObserver(handleMutations);
      mainObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style']
      });
    }
  }

  function stopMutationObservers() {
    if (mutationDebounceTimer !== null) {
      clearTimeout(mutationDebounceTimer);
      mutationDebounceTimer = null;
    }
    addedSubtreeBuffer.clear();
    attrTargetBuffer.clear();
    if (mainObserver) {
      mainObserver.disconnect();
      mainObserver = null;
    }
    while (shadowObservers.length > 0) {
      const obs = shadowObservers.pop();
      obs.disconnect();
    }
    observedShadows = new WeakSet();
  }

  function handleSpaRouteChange() {
    if (!active) return;
    if (typeof location !== 'undefined') {
      lastKnownUrl = location.href;
    }
    if (currentConfig && typeof currentConfig.onNavigate === 'function') {
      currentConfig.onNavigate(lastKnownUrl);
    }
    if (currentConfig && isSweepMode(currentConfig.mode) && typeof document !== 'undefined' && document.body) {
      enqueueSubtree(document.body);
      scheduleBatchProcessing();
    }
  }

  function installSpaHooks() {
    if (spaHooked || typeof window === 'undefined') return;
    spaHooked = true;
    lastKnownUrl = typeof location !== 'undefined' ? location.href : '';

    if (window.history) {
      if (typeof window.history.pushState === 'function') {
        origPushState = window.history.pushState;
        window.history.pushState = function wrappedPushState(...args) {
          const ret = origPushState.apply(this, args);
          handleSpaRouteChange();
          return ret;
        };
      }
      if (typeof window.history.replaceState === 'function') {
        origReplaceState = window.history.replaceState;
        window.history.replaceState = function wrappedReplaceState(...args) {
          const ret = origReplaceState.apply(this, args);
          handleSpaRouteChange();
          return ret;
        };
      }
    }

    if (typeof window.addEventListener === 'function') {
      popstateHandler = () => handleSpaRouteChange();
      hashchangeHandler = () => handleSpaRouteChange();
      window.addEventListener('popstate', popstateHandler);
      window.addEventListener('hashchange', hashchangeHandler);
    }

    if (window.navigation && typeof window.navigation.addEventListener === 'function') {
      navSuccessHandler = () => handleSpaRouteChange();
      window.navigation.addEventListener('navigatesuccess', navSuccessHandler);
    }
  }

  function uninstallSpaHooks() {
    if (!spaHooked || typeof window === 'undefined') return;
    spaHooked = false;

    if (window.history) {
      if (origPushState) {
        window.history.pushState = origPushState;
        origPushState = null;
      }
      if (origReplaceState) {
        window.history.replaceState = origReplaceState;
        origReplaceState = null;
      }
    }
    if (typeof window.removeEventListener === 'function') {
      if (popstateHandler) {
        window.removeEventListener('popstate', popstateHandler);
      }
      if (hashchangeHandler) {
        window.removeEventListener('hashchange', hashchangeHandler);
      }
    }
    popstateHandler = null;
    hashchangeHandler = null;
    if (navSuccessHandler && window.navigation && typeof window.navigation.removeEventListener === 'function') {
      window.navigation.removeEventListener('navigatesuccess', navSuccessHandler);
      navSuccessHandler = null;
    }
  }

  function upsertStyleTag(id, cssText) {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(id);
    if (!cssText || !cssText.trim()) {
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      return;
    }
    const parent = document.head || document.documentElement;
    if (!parent) return;
    const styleEl = existing || document.createElement('style');
    if (!existing) {
      styleEl.id = id;
      parent.appendChild(styleEl);
    }
    if (styleEl.textContent !== cssText) {
      styleEl.textContent = cssText;
    }
  }

  function updateRuntimeVars(config) {
    const cfg = config || currentConfig || {};
    const brightness = clampNum(cfg.brightness, 50, 130, 100);
    const contrast = clampNum(cfg.contrast, 70, 140, 100);
    const sepia = clampNum(cfg.sepia, 0, 60, 0);
    const grayscale = clampNum(cfg.grayscale, 0, 100, 0);
    const imageBrightness = clampNum(cfg.imageBrightness, 50, 100, 90);

    const bFactor = (brightness / 100).toFixed(2);
    const cFactor = (contrast / 100).toFixed(2);
    const sFactor = (sepia / 100).toFixed(2);
    const gFactor = (grayscale / 100).toFixed(2);
    const imgFactor = (imageBrightness / 100).toFixed(2);

    const lines = [
      'html[data-darkext-active="true"] {',
      `  --de-image-brightness: ${imgFactor};`,
      `  --de-filter-brightness: ${bFactor};`,
      `  --de-filter-contrast: ${cFactor};`,
      `  --de-filter-sepia: ${sFactor};`,
      `  --de-filter-grayscale: ${gFactor};`,
      '}'
    ];

    const hasCustomFilter =
      brightness !== 100 || contrast !== 100 || sepia !== 0 || grayscale !== 0;

    if (hasCustomFilter && cfg.mode !== 'filter') {
      lines.push(
        'html[data-darkext-active="true"]:not([data-darkext-mode="filter"]) {',
        '  filter: brightness(var(--de-filter-brightness, 1)) contrast(var(--de-filter-contrast, 1)) sepia(var(--de-filter-sepia, 0)) grayscale(var(--de-filter-grayscale, 0));',
        '}'
      );
    }

    upsertStyleTag(RUNTIME_VARS_STYLE_ID, lines.join('\n'));
  }

  function updateCustomCss(cssText) {
    upsertStyleTag(CUSTOM_CSS_STYLE_ID, typeof cssText === 'string' ? cssText : '');
  }

  function setRootAttributes(config) {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const root = document.documentElement;
    root.setAttribute('data-darkext-active', 'true');
    root.setAttribute('data-darkext-mode', config.mode || 'dynamic');
    root.setAttribute('data-darkext-preset', config.preset || 'midnight');

    const imageBrightness = clampNum(config.imageBrightness, 50, 100, 90);
    if (config.dimImages !== false && imageBrightness < 100) {
      root.setAttribute('data-darkext-dim-images', 'true');
    } else {
      root.removeAttribute('data-darkext-dim-images');
    }

    if (config.mode === 'site-theme' && config.siteThemeId) {
      root.setAttribute('data-darkext-site', config.siteThemeId);
    } else {
      root.removeAttribute('data-darkext-site');
    }
  }

  function removeRootAttributes() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    const root = document.documentElement;
    root.removeAttribute('data-darkext-active');
    root.removeAttribute('data-darkext-mode');
    root.removeAttribute('data-darkext-preset');
    root.removeAttribute('data-darkext-site');
    root.removeAttribute('data-darkext-dim-images');
  }

  function restoreAllInlineStyles() {
    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const styled = document.querySelectorAll(`[${STYLED_ATTR}]`);
      for (const el of styled) {
        restoreElementStyles(el);
      }
    }
    for (const shadowRoot of trackedShadowRoots) {
      if (shadowRoot && typeof shadowRoot.querySelectorAll === 'function') {
        const shadowStyled = shadowRoot.querySelectorAll(`[${STYLED_ATTR}]`);
        for (const el of shadowStyled) {
          restoreElementStyles(el);
        }
        const shadowStyles = shadowRoot.querySelectorAll('style[data-darkext-shadow="true"]');
        for (const s of shadowStyles) {
          if (s.parentNode) s.parentNode.removeChild(s);
        }
      }
    }
    trackedShadowRoots.clear();
    originalStyles = new WeakMap();
    appliedStyles = new WeakMap();
  }

  function teardown() {
    active = false;
    currentConfig = null;

    if (rafId !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafId);
      } else {
        clearTimeout(rafId);
      }
      rafId = null;
    }
    clearPendingQueue();
    vibrantColorCache.clear();

    stopMutationObservers();
    uninstallSpaHooks();
    restoreAllInlineStyles();
    removeRootAttributes();

    upsertStyleTag(RUNTIME_VARS_STYLE_ID, '');
    upsertStyleTag(CUSTOM_CSS_STYLE_ID, '');

    if (typeof document !== 'undefined' && typeof document.querySelectorAll === 'function') {
      const fallbacks = document.querySelectorAll('style[data-darkext-fallback]');
      for (const el of fallbacks) {
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    }
  }

  function apply(config) {
    if (!config || config.mode === 'off') {
      teardown();
      return;
    }

    const previousMode = currentConfig ? currentConfig.mode : null;
    const previousPreset = currentConfig ? currentConfig.preset : null;

    // Cleanly reset inline styles when changing sweep/non-sweep mode or preset
    if (isSweepMode(previousMode) && (config.mode !== previousMode || previousPreset !== config.preset)) {
      if (rafId !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
        } else {
          clearTimeout(rafId);
        }
        rafId = null;
      }
      clearPendingQueue();
      stopMutationObservers();
      restoreAllInlineStyles();
    }

    active = true;
    currentConfig = { ...config };

    setRootAttributes(currentConfig);
    updateRuntimeVars(currentConfig);
    updateCustomCss(currentConfig.customCss || '');
    installSpaHooks();

    if (isSweepMode(currentConfig.mode)) {
      startMutationObserver();
      if (typeof document !== 'undefined' && document.documentElement) {
        enqueueSubtree(document.documentElement);
        scheduleBatchProcessing();
      }
    }
  }

  function showToast(message) {
    if (typeof document === 'undefined') return;
    const text = String(message || '').trim();
    if (!text) return;

    const parent = document.documentElement || document.body;
    if (!parent) return;

    let host = document.getElementById(TOAST_HOST_ID);
    if (!host) {
      host = document.createElement('div');
      host.id = TOAST_HOST_ID;
      host.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;pointer-events:none;margin:0;padding:0;border:none;background:transparent;';
      parent.appendChild(host);
    }

    const shadow = host.shadowRoot || (typeof host.attachShadow === 'function' ? host.attachShadow({ mode: 'open' }) : null);
    if (!shadow) return;

    if (toastDismissTimer !== null) {
      clearTimeout(toastDismissTimer);
      toastDismissTimer = null;
    }
    if (toastRemoveTimer !== null) {
      clearTimeout(toastRemoveTimer);
      toastRemoveTimer = null;
    }

    if (!shadow.querySelector('style')) {
      const styleEl = document.createElement('style');
      styleEl.textContent = [
        '.de-toast {',
        '  display: inline-flex;',
        '  align-items: center;',
        '  gap: 8px;',
        '  padding: 10px 16px;',
        '  border-radius: 10px;',
        '  background: rgba(20, 23, 30, 0.96);',
        '  color: #e6e9ef;',
        '  border: 1px solid rgba(108, 140, 255, 0.38);',
        '  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);',
        '  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
        '  font-size: 13px;',
        '  font-weight: 500;',
        '  line-height: 1.35;',
        '  letter-spacing: 0.01em;',
        '  opacity: 0;',
        '  transform: translateY(8px);',
        '  transition: opacity 0.18s ease, transform 0.18s ease;',
        '}',
        '.de-toast.is-visible {',
        '  opacity: 1;',
        '  transform: translateY(0);',
        '}',
        '.de-dot {',
        '  width: 8px;',
        '  height: 8px;',
        '  border-radius: 50%;',
        '  background: #6c8cff;',
        '  flex-shrink: 0;',
        '}'
      ].join('\n');
      shadow.appendChild(styleEl);
    }

    let pill = shadow.querySelector('.de-toast');
    if (!pill) {
      pill = document.createElement('div');
      pill.className = 'de-toast';
      pill.setAttribute('role', 'status');
      pill.setAttribute('aria-live', 'polite');

      const dot = document.createElement('span');
      dot.className = 'de-dot';
      const msgSpan = document.createElement('span');
      msgSpan.className = 'de-msg';

      pill.appendChild(dot);
      pill.appendChild(msgSpan);
      shadow.appendChild(pill);
    }

    const msgSpan = pill.querySelector('.de-msg');
    if (msgSpan) {
      msgSpan.textContent = text;
    }

    // Trigger fade-in on next frame
    const showFn = () => {
      if (pill) pill.classList.add('is-visible');
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(showFn);
    } else {
      showFn();
    }

    toastDismissTimer = setTimeout(() => {
      if (pill) pill.classList.remove('is-visible');
      toastRemoveTimer = setTimeout(() => {
        if (host && host.parentNode) {
          host.parentNode.removeChild(host);
        }
      }, 220);
    }, TOAST_DURATION_MS);
  }

  function rescan() {
    if (!active || !currentConfig || !isSweepMode(currentConfig.mode)) {
      return;
    }
    if (typeof document !== 'undefined' && document.documentElement) {
      enqueueSubtree(document.documentElement);
      scheduleBatchProcessing();
    }
  }

  function pauseForDetection() {
    if (typeof document === 'undefined' || !document.documentElement) return;
    document.documentElement.removeAttribute('data-darkext-active');
    if (currentConfig && isSweepMode(currentConfig.mode)) {
      if (rafId !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
        } else {
          clearTimeout(rafId);
        }
        rafId = null;
      }
      clearPendingQueue();
      restoreAllInlineStyles();
      if (mainObserver && typeof mainObserver.takeRecords === 'function') {
        mainObserver.takeRecords();
      }
      for (const obs of shadowObservers) {
        if (obs && typeof obs.takeRecords === 'function') {
          obs.takeRecords();
        }
      }
    }
  }

  function isActive() {
    return active;
  }

  function getMode() {
    return currentConfig ? currentConfig.mode : 'off';
  }

  DarkExt.DynamicEngine = {
    apply,
    teardown,
    pauseForDetection,
    rescan,
    updateRuntimeVars,
    updateCustomCss,
    showToast,
    isActive,
    getMode
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DarkExt.DynamicEngine;
  }
})(globalThis);
