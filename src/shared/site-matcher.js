(function (root) {
  'use strict';

  const DarkExt = (root.DarkExt = root.DarkExt || {});

  let Constants = DarkExt.Constants;
  if (!Constants && typeof require === 'function') {
    Constants = require('./constants.js');
  }

  let Schedule = DarkExt.Schedule;
  if (!Schedule && typeof require === 'function') {
    Schedule = require('./schedule.js');
  }

  const MAX_PATTERN_REGEX_CACHE = 256;
  const patternRegexCache = new Map();

  function isCleanLowercaseHost(input) {
    const len = input.length;
    if (len === 0 || input.charCodeAt(len - 1) === 46) {
      return false;
    }
    for (let i = 0; i < len; i += 1) {
      const c = input.charCodeAt(i);
      const isValid =
        (c >= 97 && c <= 122) || // a-z
        (c >= 48 && c <= 57) ||  // 0-9
        c === 45 ||              // -
        c === 46 ||              // .
        c === 95;                // _
      if (!isValid) {
        return false;
      }
    }
    return true;
  }

  function normalizeHostname(input) {
    if (typeof input !== 'string') {
      return '';
    }
    if (isCleanLowercaseHost(input)) {
      if (input.startsWith('www.') && input.indexOf('.', 4) > 4) {
        return input.slice(4);
      }
      return input;
    }
    let host = input.trim().toLowerCase();
    if (!host) {
      return '';
    }
    if (host.includes('://')) {
      try {
        host = new URL(host).hostname.toLowerCase();
      } catch {
        host = (host.split('://')[1] || '').toLowerCase();
      }
    }
    host = host.split('/')[0].split('?')[0].split('#')[0];
    if (host.startsWith('[')) {
      const endIdx = host.indexOf(']');
      if (endIdx !== -1) {
        host = host.slice(0, endIdx + 1);
      }
    } else {
      host = host.replace(/:\d+$/, '');
    }
    host = host.replace(/\.+$/, '');
    host = host.replace(/^www\.(?=[^.]+\.)/, '');
    return host;
  }

  function isSupportedUrl(url) {
    if (typeof url !== 'string') {
      return false;
    }
    const trimmed = url.trim();
    if (!trimmed) {
      return false;
    }
    const c0 = trimmed.charCodeAt(0);
    if (c0 !== 104 && c0 !== 72) {
      return false;
    }
    const lowerPrefix = trimmed.slice(0, 6).toLowerCase();
    if (!lowerPrefix.startsWith('http:') && !lowerPrefix.startsWith('https:')) {
      return false;
    }
    try {
      const parsed = new URL(trimmed);
      return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname);
    } catch {
      return false;
    }
  }

  function extractHostname(url) {
    if (!isSupportedUrl(url)) {
      return '';
    }
    try {
      const parsed = new URL(url.trim());
      return normalizeHostname(parsed.hostname);
    } catch {
      return '';
    }
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function getWildcardPatternRegex(pat) {
    let regex = patternRegexCache.get(pat);
    if (regex !== undefined) {
      return regex;
    }

    // Build anchored regex supporting leading "*." (root + subdomains),
    // trailing ".*" (1-2 label TLD/ccTLD such as .com or .co.uk), and middle "*".
    let work = pat;
    let prefix = '^';
    let suffix = '$';

    if (work.startsWith('*.')) {
      prefix = '^(?:[a-z0-9-]+\\.)*';
      work = work.slice(2);
    }

    if (work.endsWith('.*')) {
      suffix = '\\.[a-z0-9-]+(?:\\.[a-z0-9-]+)?$';
      work = work.slice(0, -2);
    }

    const middleSegments = work.split('*').map(escapeRegex);
    const middle = middleSegments.join('[^.]*');
    regex = new RegExp(prefix + middle + suffix);

    if (pat.length <= 256) {
      if (patternRegexCache.size >= MAX_PATTERN_REGEX_CACHE) {
        const oldestKey = patternRegexCache.keys().next().value;
        patternRegexCache.delete(oldestKey);
      }
      patternRegexCache.set(pat, regex);
    }
    return regex;
  }

  function domainMatches(hostname, pattern) {
    const host = normalizeHostname(hostname);
    if (!host || typeof pattern !== 'string') {
      return false;
    }

    let pat = pattern.trim().toLowerCase();
    if (pat.endsWith('.')) {
      pat = pat.replace(/\.+$/, '');
    }
    if (!pat) {
      return false;
    }

    if (!pat.includes('*')) {
      const normPat = normalizeHostname(pat);
      if (!normPat) {
        return false;
      }
      return host === normPat || host.endsWith('.' + normPat);
    }

    return getWildcardPatternRegex(pat).test(host);
  }

  function scoreDomainPattern(host, pattern) {
    const pat = String(pattern || '').trim().toLowerCase().replace(/\.+$/, '');
    if (!pat) {
      return 0;
    }
    if (!pat.includes('*')) {
      const normPat = normalizeHostname(pat);
      if (host === normPat) {
        return 3000 + normPat.length;
      }
      if (host.endsWith('.' + normPat)) {
        return 2000 + normPat.length;
      }
      return 0;
    }
    if (domainMatches(host, pat)) {
      const literalLen = pat.replace(/\*/g, '').length;
      return 1000 + literalLen;
    }
    return 0;
  }

  function findMatchingTheme(hostname, registry, disabledThemes) {
    const host = normalizeHostname(hostname);
    if (!host || !Array.isArray(registry)) {
      return null;
    }
    const disabledSet = new Set(Array.isArray(disabledThemes) ? disabledThemes : []);

    let bestTheme = null;
    let bestScore = 0;

    for (const theme of registry) {
      if (!theme || !theme.id || disabledSet.has(theme.id)) {
        continue;
      }
      const domains = Array.isArray(theme.domains) ? theme.domains : [];
      for (const pattern of domains) {
        const score = scoreDomainPattern(host, pattern);
        if (score > bestScore) {
          bestScore = score;
          bestTheme = theme;
        }
      }
    }

    return bestTheme;
  }

  function findMatchingSiteRule(host, siteRules) {
    if (!host || !siteRules || typeof siteRules !== 'object') {
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(siteRules, host) && siteRules[host]) {
      return siteRules[host];
    }

    let bestRule = null;
    let bestScore = 0;
    for (const key of Object.keys(siteRules)) {
      const rule = siteRules[key];
      if (!rule || typeof rule !== 'object') {
        continue;
      }
      const score = scoreDomainPattern(host, key);
      if (score > bestScore) {
        bestScore = score;
        bestRule = rule;
      }
    }
    return bestRule;
  }

  function resolveEffectiveSiteConfig(hostname, settings, registry, options) {
    const defaults = Constants ? Constants.DEFAULT_SETTINGS : {};
    const cfg = Object.assign({}, defaults, settings || {});
    const opts = options && typeof options === 'object' ? options : {};
    const host = normalizeHostname(hostname);

    const siteRule = findMatchingSiteRule(host, cfg.siteRules);
    const matchedTheme = findMatchingTheme(host, registry || [], cfg.disabledThemes);

    const preset = (siteRule && siteRule.preset) || cfg.preset || 'midnight';
    const brightness = (siteRule && typeof siteRule.brightness === 'number') ? siteRule.brightness : (typeof cfg.brightness === 'number' ? cfg.brightness : 100);
    const contrast = (siteRule && typeof siteRule.contrast === 'number') ? siteRule.contrast : (typeof cfg.contrast === 'number' ? cfg.contrast : 100);
    const sepia = (siteRule && typeof siteRule.sepia === 'number') ? siteRule.sepia : (typeof cfg.sepia === 'number' ? cfg.sepia : 0);
    const grayscale = (siteRule && typeof siteRule.grayscale === 'number') ? siteRule.grayscale : (typeof cfg.grayscale === 'number' ? cfg.grayscale : 0);
    const imageBrightness = (siteRule && typeof siteRule.imageBrightness === 'number') ? siteRule.imageBrightness : (typeof cfg.imageBrightness === 'number' ? cfg.imageBrightness : 90);
    const dimImages = (siteRule && typeof siteRule.dimImages === 'boolean') ? siteRule.dimImages : (typeof cfg.dimImages === 'boolean' ? cfg.dimImages : true);
    const forceOverrideNativeDark = Boolean(siteRule && siteRule.forceOverrideNativeDark);

    const scheduleActive = Schedule ? Schedule.isScheduleActive(cfg.schedule, opts) : true;
    const scheduleBlocked = Boolean(cfg.enabled) && !scheduleActive;
    const requestedMode = (siteRule && siteRule.mode) || cfg.defaultMode || 'auto';

    let active = false;
    let mode = 'off';
    let appliedThemeId = null;
    let appliedThemeName = null;
    let appliedTheme = null;
    let skippedNativeDark = false;

    const siteDisabled = Boolean(siteRule && (siteRule.enabled === false || siteRule.mode === 'off'));

    if (!cfg.enabled || scheduleBlocked || siteDisabled || requestedMode === 'off') {
      active = false;
      mode = 'off';
    } else if ((requestedMode === 'auto' || requestedMode === 'site-theme') && matchedTheme) {
      active = true;
      mode = 'site-theme';
      appliedThemeId = matchedTheme.id;
      appliedThemeName = matchedTheme.name || matchedTheme.id;
      appliedTheme = matchedTheme;
    } else {
      const nativeDarkDetected = Boolean(opts.nativeDarkDetected);
      const shouldSkipNative = Boolean(cfg.autoDetectNativeDark) && nativeDarkDetected && !forceOverrideNativeDark;
      const fallbackMode = requestedMode === 'filter' ? 'filter' : 'dynamic';
      mode = fallbackMode;
      if (shouldSkipNative) {
        active = false;
        skippedNativeDark = true;
      } else {
        active = true;
      }
    }

    return {
      hostname: host,
      active,
      enabled: active,
      mode,
      requestedMode,
      preset,
      brightness,
      contrast,
      sepia,
      grayscale,
      imageBrightness,
      dimImages,
      forceOverrideNativeDark,
      appliedThemeId,
      appliedThemeName,
      matchedTheme: appliedTheme,
      siteRule: siteRule || null,
      scheduleBlocked,
      skippedNativeDark
    };
  }

  const SiteMatcher = Object.freeze({
    normalizeHostname,
    extractHostname,
    isSupportedUrl,
    domainMatches,
    findMatchingTheme,
    resolveEffectiveSiteConfig
  });

  DarkExt.SiteMatcher = SiteMatcher;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SiteMatcher;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
