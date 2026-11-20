(function (root) {
  'use strict';

  const DarkExt = (root.DarkExt = root.DarkExt || {});

  const NAMED_COLORS = Object.freeze({
    transparent: { r: 0, g: 0, b: 0, a: 0 },
    black: { r: 0, g: 0, b: 0, a: 1 },
    white: { r: 255, g: 255, b: 255, a: 1 },
    red: { r: 255, g: 0, b: 0, a: 1 },
    green: { r: 0, g: 128, b: 0, a: 1 },
    lime: { r: 0, g: 255, b: 0, a: 1 },
    blue: { r: 0, g: 0, b: 255, a: 1 },
    yellow: { r: 255, g: 255, b: 0, a: 1 },
    cyan: { r: 0, g: 255, b: 255, a: 1 },
    aqua: { r: 0, g: 255, b: 255, a: 1 },
    magenta: { r: 255, g: 0, b: 255, a: 1 },
    fuchsia: { r: 255, g: 0, b: 255, a: 1 },
    gray: { r: 128, g: 128, b: 128, a: 1 },
    grey: { r: 128, g: 128, b: 128, a: 1 },
    silver: { r: 192, g: 192, b: 192, a: 1 },
    navy: { r: 0, g: 0, b: 128, a: 1 },
    teal: { r: 0, g: 128, b: 128, a: 1 },
    maroon: { r: 128, g: 0, b: 0, a: 1 },
    olive: { r: 128, g: 128, b: 0, a: 1 },
    purple: { r: 128, g: 0, b: 128, a: 1 },
    orange: { r: 255, g: 165, b: 0, a: 1 }
  });

  const MAX_COLOR_CACHE_SIZE = 512;

  const SRGB_LUT = new Float64Array(256);
  for (let i = 0; i < 256; i += 1) {
    const c = i / 255;
    SRGB_LUT[i] = c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  const parseCache = new Map();
  const darkenCache = new Map();
  const lightenCache = new Map();

  function cloneRgba(c) {
    return { r: c.r, g: c.g, b: c.b, a: c.a };
  }

  function setBoundedCache(cache, key, value) {
    if (cache.has(key)) {
      cache.delete(key);
    } else if (cache.size >= MAX_COLOR_CACHE_SIZE) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
    cache.set(key, value);
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function clampByte(value) {
    return Math.round(clamp(value, 0, 255));
  }

  function parseAlpha(token) {
    if (token === undefined || token === null || token === '') {
      return 1;
    }
    const str = String(token).trim();
    if (str.endsWith('%')) {
      const pct = parseFloat(str.slice(0, -1));
      return Number.isFinite(pct) ? clamp(pct / 100, 0, 1) : NaN;
    }
    const num = parseFloat(str);
    return Number.isFinite(num) ? clamp(num, 0, 1) : NaN;
  }

  function parseRgbChannel(token) {
    const str = String(token).trim();
    if (str.endsWith('%')) {
      const pct = parseFloat(str.slice(0, -1));
      return Number.isFinite(pct) ? clampByte((pct / 100) * 255) : NaN;
    }
    const num = parseFloat(str);
    return Number.isFinite(num) ? clampByte(num) : NaN;
  }

  function parseHue(token) {
    const str = String(token).trim().toLowerCase();
    let deg = NaN;
    if (str.endsWith('deg')) {
      deg = parseFloat(str.slice(0, -3));
    } else if (str.endsWith('rad')) {
      deg = (parseFloat(str.slice(0, -3)) * 180) / Math.PI;
    } else if (str.endsWith('grad')) {
      deg = parseFloat(str.slice(0, -4)) * 0.9;
    } else if (str.endsWith('turn')) {
      deg = parseFloat(str.slice(0, -4)) * 360;
    } else {
      deg = parseFloat(str);
    }
    if (!Number.isFinite(deg)) {
      return NaN;
    }
    return ((deg % 360) + 360) % 360;
  }

  function parsePercent(token) {
    const str = String(token).trim();
    const num = parseFloat(str.endsWith('%') ? str.slice(0, -1) : str);
    return Number.isFinite(num) ? clamp(num, 0, 100) : NaN;
  }

  function rgbToHsl(rInput, gInput, bInput) {
    let r = rInput;
    let g = gInput;
    let b = bInput;
    if (rInput && typeof rInput === 'object') {
      r = rInput.r;
      g = rInput.g;
      b = rInput.b;
    }
    const rn = clamp(Number(r), 0, 255) / 255;
    const gn = clamp(Number(g), 0, 255) / 255;
    const bn = clamp(Number(b), 0, 255) / 255;

    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const delta = max - min;
    const l = (max + min) / 2;

    let h = 0;
    let s = 0;

    if (delta !== 0) {
      s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
      if (max === rn) {
        h = (gn - bn) / delta + (gn < bn ? 6 : 0);
      } else if (max === gn) {
        h = (bn - rn) / delta + 2;
      } else {
        h = (rn - gn) / delta + 4;
      }
      h *= 60;
    }

    return {
      h: Math.round(h * 100) / 100,
      s: Math.round(s * 10000) / 100,
      l: Math.round(l * 10000) / 100
    };
  }

  function hueToRgb(p, q, t) {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  }

  function hslToRgb(hInput, sInput, lInput) {
    let h = hInput;
    let s = sInput;
    let l = lInput;
    if (hInput && typeof hInput === 'object') {
      h = hInput.h;
      s = hInput.s;
      l = hInput.l;
    }
    const hn = (((Number(h) % 360) + 360) % 360) / 360;
    const sn = clamp(Number(s), 0, 100) / 100;
    const ln = clamp(Number(l), 0, 100) / 100;

    if (sn === 0) {
      const v = clampByte(ln * 255);
      return { r: v, g: v, b: v };
    }

    const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
    const p = 2 * ln - q;

    return {
      r: clampByte(hueToRgb(p, q, hn + 1 / 3) * 255),
      g: clampByte(hueToRgb(p, q, hn) * 255),
      b: clampByte(hueToRgb(p, q, hn - 1 / 3) * 255)
    };
  }

  function hexDigit(code) {
    if (code >= 48 && code <= 57) return code - 48;
    if (code >= 97 && code <= 102) return code - 87;
    return -1;
  }

  function parseHexColor(str) {
    const len = str.length;
    if (len === 4) {
      const r = hexDigit(str.charCodeAt(1));
      const g = hexDigit(str.charCodeAt(2));
      const b = hexDigit(str.charCodeAt(3));
      if ((r | g | b) < 0) return null;
      return { r: (r << 4) | r, g: (g << 4) | g, b: (b << 4) | b, a: 1 };
    }
    if (len === 5) {
      const r = hexDigit(str.charCodeAt(1));
      const g = hexDigit(str.charCodeAt(2));
      const b = hexDigit(str.charCodeAt(3));
      const a = hexDigit(str.charCodeAt(4));
      if ((r | g | b | a) < 0) return null;
      return { r: (r << 4) | r, g: (g << 4) | g, b: (b << 4) | b, a: ((a << 4) | a) / 255 };
    }
    if (len === 7) {
      const r1 = hexDigit(str.charCodeAt(1));
      const r2 = hexDigit(str.charCodeAt(2));
      const g1 = hexDigit(str.charCodeAt(3));
      const g2 = hexDigit(str.charCodeAt(4));
      const b1 = hexDigit(str.charCodeAt(5));
      const b2 = hexDigit(str.charCodeAt(6));
      if ((r1 | r2 | g1 | g2 | b1 | b2) < 0) return null;
      return { r: (r1 << 4) | r2, g: (g1 << 4) | g2, b: (b1 << 4) | b2, a: 1 };
    }
    if (len === 9) {
      const r1 = hexDigit(str.charCodeAt(1));
      const r2 = hexDigit(str.charCodeAt(2));
      const g1 = hexDigit(str.charCodeAt(3));
      const g2 = hexDigit(str.charCodeAt(4));
      const b1 = hexDigit(str.charCodeAt(5));
      const b2 = hexDigit(str.charCodeAt(6));
      const a1 = hexDigit(str.charCodeAt(7));
      const a2 = hexDigit(str.charCodeAt(8));
      if ((r1 | r2 | g1 | g2 | b1 | b2 | a1 | a2) < 0) return null;
      return { r: (r1 << 4) | r2, g: (g1 << 4) | g2, b: (b1 << 4) | b2, a: ((a1 << 4) | a2) / 255 };
    }
    return null;
  }

  function parseRgbChannelRange(str, start, end) {
    let i = start;
    let j = end;
    while (i < j && str.charCodeAt(i) <= 32) i += 1;
    while (j > i && str.charCodeAt(j - 1) <= 32) j -= 1;
    if (i >= j) {
      return NaN;
    }
    let val = 0;
    let k = i;
    while (k < j) {
      const code = str.charCodeAt(k);
      if (code < 48 || code > 57) {
        return parseRgbChannel(str.slice(i, j));
      }
      val = val * 10 + (code - 48);
      k += 1;
    }
    return val > 255 ? 255 : val;
  }

  function parseAlphaRange(str, start, end) {
    let i = start;
    let j = end;
    while (i < j && str.charCodeAt(i) <= 32) i += 1;
    while (j > i && str.charCodeAt(j - 1) <= 32) j -= 1;
    if (i >= j) {
      return 1;
    }
    if (j === i + 1) {
      const c = str.charCodeAt(i);
      if (c === 48) return 0;
      if (c === 49) return 1;
    }
    if (j > i + 2 && str.charCodeAt(i) === 48 && str.charCodeAt(i + 1) === 46) {
      let num = 0;
      let scale = 1;
      let k = i + 2;
      let allDigits = true;
      while (k < j) {
        const code = str.charCodeAt(k);
        if (code < 48 || code > 57) {
          allDigits = false;
          break;
        }
        num = num * 10 + (code - 48);
        scale *= 10;
        k += 1;
      }
      if (allDigits) {
        return num / scale;
      }
    }
    return parseAlpha(str.slice(i, j));
  }

  function parseCommaRgbFast(str, openIdx, closeIdx) {
    const c1 = str.indexOf(',', openIdx + 1);
    if (c1 === -1 || c1 >= closeIdx) {
      return undefined;
    }
    const c2 = str.indexOf(',', c1 + 1);
    if (c2 === -1 || c2 >= closeIdx) {
      return null;
    }
    const c3 = str.indexOf(',', c2 + 1);
    let bEnd = closeIdx;
    let a = 1;
    if (c3 !== -1 && c3 < closeIdx) {
      const c4 = str.indexOf(',', c3 + 1);
      if (c4 !== -1 && c4 < closeIdx) {
        return null;
      }
      bEnd = c3;
      a = parseAlphaRange(str, c3 + 1, closeIdx);
      if (!Number.isFinite(a)) {
        return null;
      }
    }
    const r = parseRgbChannelRange(str, openIdx + 1, c1);
    const g = parseRgbChannelRange(str, c1 + 1, c2);
    const b = parseRgbChannelRange(str, c2 + 1, bEnd);
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
      return null;
    }
    return { r, g, b, a };
  }

  function parseCssColorUncached(colorStr) {
    const str = colorStr.trim().toLowerCase();
    if (!str) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, str)) {
      return cloneRgba(NAMED_COLORS[str]);
    }

    if (str.charCodeAt(0) === 35) { // '#'
      return parseHexColor(str);
    }

    const openIdx = str.indexOf('(');
    const closeIdx = str.length - 1;
    if (openIdx <= 0 || str.charCodeAt(closeIdx) !== 41 || str.indexOf(')', openIdx + 1) !== closeIdx) {
      return null;
    }

    const fnName = str.slice(0, openIdx);
    const isRgbFn = fnName === 'rgb' || fnName === 'rgba';
    const isHslFn = !isRgbFn && (fnName === 'hsl' || fnName === 'hsla');
    if (!isRgbFn && !isHslFn) {
      return null;
    }

    // Non-regex fast path for standard comma-separated rgb(...) / rgba(...)
    if (isRgbFn) {
      const fastRgb = parseCommaRgbFast(str, openIdx, closeIdx);
      if (fastRgb !== undefined) {
        return fastRgb;
      }
    }

    const body = str.slice(openIdx + 1, closeIdx).trim();
    if (!body) {
      return null;
    }

    let channels;
    let alphaToken;

    if (body.includes(',')) {
      const parts = body.split(',').map((p) => p.trim());
      if (parts.length !== 3 && parts.length !== 4) {
        return null;
      }
      channels = parts.slice(0, 3);
      alphaToken = parts[3];
    } else {
      const slashParts = body.split('/').map((p) => p.trim());
      if (slashParts.length > 2) {
        return null;
      }
      channels = slashParts[0].split(/\s+/).filter(Boolean);
      if (channels.length !== 3) {
        return null;
      }
      alphaToken = slashParts[1];
    }

    const a = parseAlpha(alphaToken);
    if (!Number.isFinite(a)) {
      return null;
    }

    if (isRgbFn) {
      const r = parseRgbChannel(channels[0]);
      const g = parseRgbChannel(channels[1]);
      const b = parseRgbChannel(channels[2]);
      if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) {
        return null;
      }
      return { r, g, b, a };
    }

    const h = parseHue(channels[0]);
    const s = parsePercent(channels[1]);
    const l = parsePercent(channels[2]);
    if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
      return null;
    }
    const rgb = hslToRgb(h, s, l);
    return { r: rgb.r, g: rgb.g, b: rgb.b, a };
  }

  function parseCssColor(colorStr) {
    if (colorStr && typeof colorStr === 'object' && typeof colorStr.r === 'number') {
      return {
        r: clampByte(colorStr.r),
        g: clampByte(colorStr.g),
        b: clampByte(colorStr.b),
        a: typeof colorStr.a === 'number' ? clamp(colorStr.a, 0, 1) : 1
      };
    }

    if (typeof colorStr !== 'string') {
      return null;
    }

    const cached = parseCache.get(colorStr);
    if (cached !== undefined) {
      return cached ? cloneRgba(cached) : null;
    }

    const parsed = parseCssColorUncached(colorStr);
    if (colorStr.length <= 128) {
      setBoundedCache(parseCache, colorStr, parsed ? cloneRgba(parsed) : null);
    }
    return parsed;
  }

  function linearizeChannel(channel255) {
    if (channel255 <= 0) {
      return SRGB_LUT[0];
    }
    if (channel255 >= 255) {
      return SRGB_LUT[255];
    }
    if ((channel255 | 0) === channel255) {
      return SRGB_LUT[channel255];
    }
    const c = channel255 / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminanceRgb(r, g, b) {
    return 0.2126 * linearizeChannel(r) + 0.7152 * linearizeChannel(g) + 0.0722 * linearizeChannel(b);
  }

  function relativeLuminance(color) {
    if (color && typeof color === 'object' && typeof color.r === 'number') {
      return relativeLuminanceRgb(clampByte(color.r), clampByte(color.g), clampByte(color.b));
    }
    const parsed = parseCssColor(color);
    if (!parsed) {
      return null;
    }
    return relativeLuminanceRgb(parsed.r, parsed.g, parsed.b);
  }

  function isDarkColor(color, threshold) {
    const limit = typeof threshold === 'number' ? threshold : 0.25;
    const parsed = parseCssColor(color);
    if (!parsed || parsed.a < 0.1) {
      return false;
    }
    return relativeLuminanceRgb(parsed.r, parsed.g, parsed.b) < limit;
  }

  function isLightColor(color, threshold) {
    const limit = typeof threshold === 'number' ? threshold : 0.35;
    const parsed = parseCssColor(color);
    if (!parsed || parsed.a < 0.1) {
      return false;
    }
    return relativeLuminanceRgb(parsed.r, parsed.g, parsed.b) > limit;
  }

  function formatCssColor(r, g, b, a) {
    const rb = clampByte(r);
    const gb = clampByte(g);
    const bb = clampByte(b);
    const alpha = typeof a === 'number' ? clamp(a, 0, 1) : 1;
    if (alpha < 0.999) {
      const roundedAlpha = Math.round(alpha * 1000) / 1000;
      return `rgba(${rb}, ${gb}, ${bb}, ${roundedAlpha})`;
    }
    const toHex = (n) => n.toString(16).padStart(2, '0');
    return `#${toHex(rb)}${toHex(gb)}${toHex(bb)}`;
  }

  function resolvePresetTarget(presetColors, key, fallbackHex) {
    if (typeof presetColors === 'string') {
      return parseCssColor(presetColors) || parseCssColor(fallbackHex);
    }
    if (presetColors && typeof presetColors === 'object' && presetColors[key]) {
      return parseCssColor(presetColors[key]) || parseCssColor(fallbackHex);
    }
    return parseCssColor(fallbackHex);
  }

  function getColorCachePrefix(color) {
    if (typeof color === 'string') {
      return color.length <= 128 ? `s:${color}` : null;
    }
    if (color && typeof color === 'object' && typeof color.r === 'number') {
      const rb = clampByte(color.r);
      const gb = clampByte(color.g);
      const bb = clampByte(color.b);
      const a = typeof color.a === 'number' ? clamp(color.a, 0, 1) : 1;
      return `o:${rb},${gb},${bb},${a}`;
    }
    return null;
  }

  function getPresetTargetKey(presetColors, key) {
    if (!presetColors) {
      return '';
    }
    const raw = typeof presetColors === 'string'
      ? presetColors
      : (typeof presetColors === 'object' ? presetColors[key] : null);
    if (!raw) {
      return '';
    }
    if (typeof raw === 'string') {
      return raw.length <= 64 ? raw : null;
    }
    if (typeof raw === 'object' && typeof raw.r === 'number') {
      const rb = clampByte(raw.r);
      const gb = clampByte(raw.g);
      const bb = clampByte(raw.b);
      const a = typeof raw.a === 'number' ? clamp(raw.a, 0, 1) : 1;
      return `${rb},${gb},${bb},${a}`;
    }
    return '';
  }

  function getTransformCacheKey(color, presetColors, presetKey) {
    const colorKey = getColorCachePrefix(color);
    if (colorKey === null) {
      return null;
    }
    const targetKey = getPresetTargetKey(presetColors, presetKey);
    if (targetKey === null) {
      return null;
    }
    return targetKey ? `${colorKey}\0${targetKey}` : colorKey;
  }

  function darkenBackgroundColor(color, presetColors) {
    const cacheKey = getTransformCacheKey(color, presetColors, 'bg');
    if (cacheKey !== null) {
      const cached = darkenCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    let result = null;
    const parsed = parseCssColor(color);
    if (parsed) {
      if (parsed.a < 0.05) {
        result = formatCssColor(parsed.r, parsed.g, parsed.b, parsed.a);
      } else if (parsed.a >= 0.1 && relativeLuminanceRgb(parsed.r, parsed.g, parsed.b) < 0.12) {
        result = formatCssColor(parsed.r, parsed.g, parsed.b, parsed.a);
      } else {
        const baseTarget = resolvePresetTarget(presetColors, 'bg', '#121418');
        const baseHsl = rgbToHsl(baseTarget.r, baseTarget.g, baseTarget.b);
        const hsl = rgbToHsl(parsed.r, parsed.g, parsed.b);

        // Pure white snaps to base bg; all white-gray / light-gray / mid-gray surfaces darken deeply
        if (hsl.s <= 14) {
          if (hsl.l >= 96) {
            result = formatCssColor(baseTarget.r, baseTarget.g, baseTarget.b, parsed.a);
          } else {
            const invertedRatio = clamp((96 - hsl.l) / 64, 0, 1);
            const targetL = clamp(baseHsl.l + 3 + invertedRatio * 6, baseHsl.l + 3, 18);
            const rgb = hslToRgb(baseHsl.h, baseHsl.s, targetL);
            result = formatCssColor(rgb.r, rgb.g, rgb.b, parsed.a);
          }
        } else {
          // Tinted / colored light and medium backgrounds preserve subtle hue on a deep dark surface
          const darkS = clamp(hsl.s * 0.55, 12, 46);
          const darkL = clamp(baseHsl.l + 4 + (100 - hsl.l) * 0.08, 10, 19);
          const rgb = hslToRgb(hsl.h, darkS, darkL);
          result = formatCssColor(rgb.r, rgb.g, rgb.b, parsed.a);
        }
      }
    }

    if (cacheKey !== null) {
      setBoundedCache(darkenCache, cacheKey, result);
    }
    return result;
  }

  function lightenTextColor(color, presetColors) {
    const cacheKey = getTransformCacheKey(color, presetColors, 'text');
    if (cacheKey !== null) {
      const cached = lightenCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
    }

    let result = null;
    const parsed = parseCssColor(color);
    if (parsed) {
      if (parsed.a < 0.05) {
        result = formatCssColor(parsed.r, parsed.g, parsed.b, parsed.a);
      } else if (relativeLuminanceRgb(parsed.r, parsed.g, parsed.b) >= 0.55) {
        result = formatCssColor(parsed.r, parsed.g, parsed.b, parsed.a);
      } else {
        const textTarget = resolvePresetTarget(presetColors, 'text', '#f4f6fa');
        const targetHsl = rgbToHsl(textTarget.r, textTarget.g, textTarget.b);
        const hsl = rgbToHsl(parsed.r, parsed.g, parsed.b);

        // Neutral dark and mid-gray text (#000 .. #aaa) maps to crisp white / high-contrast silver
        if (hsl.s <= 18) {
          if (hsl.l <= 32) {
            result = formatCssColor(textTarget.r, textTarget.g, textTarget.b, parsed.a);
          } else {
            const mutedRatio = clamp((hsl.l - 32) / 50, 0, 1);
            const lightL = clamp(targetHsl.l - mutedRatio * 12, 80, 96);
            const rgb = hslToRgb(targetHsl.h, targetHsl.s, lightL);
            result = formatCssColor(rgb.r, rgb.g, rgb.b, parsed.a);
          }
        } else {
          // Colored dark text (links, accents, badges) stays recognizable at high contrast
          const lightS = clamp(Math.max(hsl.s, 45), 40, 88);
          const lightL = clamp(74 + (100 - hsl.l) * 0.08, 72, 86);
          const rgb = hslToRgb(hsl.h, lightS, lightL);
          result = formatCssColor(rgb.r, rgb.g, rgb.b, parsed.a);
        }
      }
    }

    if (cacheKey !== null) {
      setBoundedCache(lightenCache, cacheKey, result);
    }
    return result;
  }

  const ColorUtils = Object.freeze({
    parseCssColor,
    relativeLuminance,
    isDarkColor,
    isLightColor,
    rgbToHsl,
    hslToRgb,
    darkenBackgroundColor,
    lightenTextColor
  });

  DarkExt.ColorUtils = ColorUtils;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ColorUtils;
  }
})(typeof globalThis !== 'undefined' ? globalThis : self);
