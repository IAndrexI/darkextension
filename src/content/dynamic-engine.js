'use strict';

(function initDynamicEngine(global) {
  const DarkExt = (global.DarkExt = global.DarkExt || {});

  const BATCH_SIZE = 40;
  const MUTATION_DEBOUNCE_MS = 75;
  const TOAST_DURATION_MS = 2200;

  const RUNTIME_VARS_STYLE_ID = 'darkext-runtime-vars';
  const CUSTOM_CSS_STYLE_ID = 'darkext-custom-css';
  const TOAST_HOST_ID = 'darkext-toast-host';
  const STYLED_ATTR = 'data-darkext-styled';

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

  const pendingQueue = [];
  const queuedSet = new WeakSet();
  const mutationBuffer = new Set();

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

  function getConstants() {
    return DarkExt.Constants || {};
  }

  function getColorUtils() {
    return DarkExt.ColorUtils || null;
  }

  function getPresetColors(presetId) {
    const Constants = getConstants();
    const presets = Constants.THEME_PRESETS || {};
    return presets[presetId] || presets.midnight || {
      bg: '#121418',
      elevated: '#1a1d24',
      subtle: '#222630',
      border: '#2e3442',
      text: '#e6e9ef',
      secondary: '#a8b0c0',
      link: '#7ab3ff',
      accent: '#6c8cff'
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
    const hsl = ColorUtils.rgbToHsl(parsed);
    const maxC = Math.max(parsed.r, parsed.g, parsed.b);
    const minC = Math.min(parsed.r, parsed.g, parsed.b);
    const chroma = (maxC - minC) / 255;
    const lum = ColorUtils.relativeLuminance(parsed);
    if (lum === null) return false;
    // Distinguish genuine saturated brand fills (e.g. CTAs/badges) from pale pastel backgrounds
    return chroma >= 0.28 && hsl.s >= 35 && hsl.l >= 22 && hsl.l <= 72 && lum < 0.78;
  }

  function hasBrightVibrantAncestor(el, win, ColorUtils) {
    if (!el || !win || typeof win.getComputedStyle !== 'function' || !ColorUtils) {
      return false;
    }
    let parent = el.parentElement;
    for (let depth = 0; depth < 4 && parent; depth += 1) {
      if (parent.tagName === 'BODY' || parent.tagName === 'HTML') {
        break;
      }
      try {
        const pStyle = win.getComputedStyle(parent);
        const pBg = ColorUtils.parseCssColor(pStyle.backgroundColor);
        if (pBg && pBg.a >= 0.5 && isVibrantBrandColor(pBg, ColorUtils)) {
          const lum = ColorUtils.relativeLuminance(pBg);
          if (lum !== null && lum > 0.35) {
            return true;
          }
        }
      } catch (_) {
        break;
      }
      parent = parent.parentElement;
    }
    return false;
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

  function computeDarkeningPlan(el, style, presetColors, win, ColorUtils) {
    const plan = {};
    const hasBgUrlImage =
      Boolean(style.backgroundImage) &&
      style.backgroundImage !== 'none' &&
      style.backgroundImage.toLowerCase().includes('url(');

    const bg = ColorUtils.parseCssColor(style.backgroundColor);
    const fg = ColorUtils.parseCssColor(style.color);
    const fgLum = fg && fg.a >= 0.1 ? ColorUtils.relativeLuminance(fg) : null;

    let bgPreservedBright = false;
    let bgDarkened = false;

    if (!hasBgUrlImage && bg && bg.a >= 0.08) {
      const bgLum = ColorUtils.relativeLuminance(bg);
      if (isVibrantBrandColor(bg, ColorUtils)) {
        // Preserve brand/CTA element color; ensure text contrast stays readable
        if (bgLum !== null && bgLum > 0.35) {
          bgPreservedBright = true;
        } else if (bgLum !== null && bgLum <= 0.25 && fgLum !== null && fgLum < 0.25) {
          const lightFg = ColorUtils.lightenTextColor(fg, presetColors);
          if (lightFg) plan.color = lightFg;
        }
      } else if (bgLum !== null && bgLum > 0.24) {
        const darkBg = ColorUtils.darkenBackgroundColor(bg, presetColors);
        if (darkBg) {
          plan.backgroundColor = darkBg;
          bgDarkened = true;
        }
      } else if (bgLum !== null && bgLum <= 0.24 && bg.a >= 0.7 && fgLum !== null && fgLum < 0.2) {
        const lightFg = ColorUtils.lightenTextColor(fg, presetColors);
        if (lightFg) plan.color = lightFg;
      }
    }

    if (!hasBgUrlImage && !bgPreservedBright && fg && fg.a >= 0.1 && fgLum !== null && fgLum < 0.45) {
      if (bgDarkened || !hasBrightVibrantAncestor(el, win, ColorUtils)) {
        const lightFg = ColorUtils.lightenTextColor(fg, presetColors);
        if (lightFg) {
          plan.color = lightFg;
        }
      }
    }

    for (const [jsProp, , widthProp, styleProp] of BORDER_PROPS) {
      const bWidth = parseFloat(style[widthProp] || '0');
      const bStyle = style[styleProp];
      if (!bWidth || bWidth <= 0 || !bStyle || bStyle === 'none') {
        continue;
      }
      const bColor = ColorUtils.parseCssColor(style[jsProp]);
      if (!bColor || bColor.a < 0.1) continue;
      const bLum = ColorUtils.relativeLuminance(bColor);
      if (bLum !== null && bLum > 0.35 && !isVibrantBrandColor(bColor, ColorUtils)) {
        plan[jsProp] = presetColors.border || '#2e3442';
      }
    }

    return plan;
  }

  function applyPlanToElement(el, plan) {
    const keys = Object.keys(plan);
    if (keys.length === 0) {
      return;
    }

    backupOriginalStyles(el);
    const applied = {};

    for (const [jsProp, cssProp] of trackedProps) {
      if (Object.prototype.hasOwnProperty.call(plan, jsProp)) {
        const nextVal = plan[jsProp];
        const useImportant = el.style.getPropertyPriority(cssProp) === 'important';
        el.style.setProperty(cssProp, nextVal, useImportant ? 'important' : '');
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
      enqueueElement(rootNode);
      if (rootNode.shadowRoot) {
        observeShadowRoot(rootNode.shadowRoot);
        enqueueSubtree(rootNode.shadowRoot);
      }
    }

    const walkerRoot = rootNode;
    if (typeof document !== 'undefined' && typeof document.createTreeWalker === 'function') {
      const SHOW_ELEMENT = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_ELEMENT : 1;
      const walker = document.createTreeWalker(walkerRoot, SHOW_ELEMENT);
      let node = walker.nextNode();
      while (node) {
        if (!shouldSkipElement(node)) {
          enqueueElement(node);
          if (node.shadowRoot) {
            observeShadowRoot(node.shadowRoot);
            enqueueSubtree(node.shadowRoot);
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
    if (!active || !currentConfig || currentConfig.mode !== 'dynamic') {
      return;
    }
    if (rafId !== null || pendingQueue.length === 0) {
      return;
    }
    const scheduleRaf = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16);
    rafId = scheduleRaf(processBatch);
  }

  function processBatch() {
    rafId = null;
    if (!active || !currentConfig || currentConfig.mode !== 'dynamic') {
      pendingQueue.length = 0;
      return;
    }

    const win = typeof window !== 'undefined' ? window : global;
    const ColorUtils = getColorUtils();
    if (!win || typeof win.getComputedStyle !== 'function' || !ColorUtils) {
      pendingQueue.length = 0;
      return;
    }

    const presetColors = getPresetColors(currentConfig.preset);
    const batch = [];

    while (batch.length < BATCH_SIZE && pendingQueue.length > 0) {
      const el = pendingQueue.shift();
      queuedSet.delete(el);
      if (!el || !el.isConnected || shouldSkipElement(el)) {
        continue;
      }
      // If previously styled and re-queued due to mutation, restore original before reading site style
      if (appliedStyles.has(el)) {
        restoreElementStyles(el);
      }
      batch.push(el);
    }

    // Read phase: compute all styles before mutating DOM to prevent layout thrashing
    const writes = [];
    for (const el of batch) {
      let computed;
      try {
        computed = win.getComputedStyle(el);
      } catch (_) {
        continue;
      }
      if (!computed) continue;
      const plan = computeDarkeningPlan(el, computed, presetColors, win, ColorUtils);
      if (Object.keys(plan).length > 0) {
        writes.push([el, plan]);
      }
    }

    // Write phase
    for (const [el, plan] of writes) {
      if (el.isConnected) {
        applyPlanToElement(el, plan);
      }
    }

    if (pendingQueue.length > 0) {
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
    if (!active || !currentConfig || currentConfig.mode !== 'dynamic') {
      return;
    }

    for (const record of records) {
      if (record.type === 'childList') {
        for (const added of record.addedNodes) {
          if (added && added.nodeType === 1 && !shouldSkipElement(added)) {
            mutationBuffer.add(added);
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
        mutationBuffer.add(target);
      }
    }

    if (typeof location !== 'undefined' && location.href !== lastKnownUrl) {
      lastKnownUrl = location.href;
      if (currentConfig && typeof currentConfig.onNavigate === 'function') {
        currentConfig.onNavigate(lastKnownUrl);
      }
    }

    if (mutationBuffer.size === 0) {
      return;
    }

    if (mutationDebounceTimer !== null) {
      clearTimeout(mutationDebounceTimer);
    }
    mutationDebounceTimer = setTimeout(flushMutationBuffer, MUTATION_DEBOUNCE_MS);
  }

  function flushMutationBuffer() {
    mutationDebounceTimer = null;
    if (!active || !currentConfig || currentConfig.mode !== 'dynamic') {
      mutationBuffer.clear();
      return;
    }

    for (const el of mutationBuffer) {
      if (el && el.isConnected && !shouldSkipElement(el)) {
        enqueueSubtree(el);
      }
    }
    mutationBuffer.clear();
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
    mutationBuffer.clear();
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
    if (currentConfig && currentConfig.mode === 'dynamic' && typeof document !== 'undefined' && document.body) {
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
    root.setAttribute('data-darkext-dim-images', config.dimImages === false ? 'false' : 'true');

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
    pendingQueue.length = 0;

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

    // Cleanly reset inline dynamic styles when leaving dynamic mode or changing preset
    if (previousMode === 'dynamic' && (config.mode !== 'dynamic' || previousPreset !== config.preset)) {
      if (rafId !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
        } else {
          clearTimeout(rafId);
        }
        rafId = null;
      }
      pendingQueue.length = 0;
      stopMutationObservers();
      restoreAllInlineStyles();
    }

    active = true;
    currentConfig = { ...config };

    setRootAttributes(currentConfig);
    updateRuntimeVars(currentConfig);
    updateCustomCss(currentConfig.customCss || '');
    installSpaHooks();

    if (currentConfig.mode === 'dynamic') {
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
    if (!active || !currentConfig || currentConfig.mode !== 'dynamic') {
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
    if (currentConfig && currentConfig.mode === 'dynamic') {
      if (rafId !== null) {
        if (typeof cancelAnimationFrame === 'function') {
          cancelAnimationFrame(rafId);
        } else {
          clearTimeout(rafId);
        }
        rafId = null;
      }
      pendingQueue.length = 0;
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
