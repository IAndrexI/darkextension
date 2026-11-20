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

    const str = colorStr.trim().toLowerCase();
    if (!str) {
      return null;
    }

    if (Object.prototype.hasOwnProperty.call(NAMED_COLORS, str)) {
      const c = NAMED_COLORS[str];
      return { r: c.r, g: c.g, b: c.b, a: c.a };
    }

    if (str.startsWith('#')) {
      const hex = str.slice(1);
      if (/^[0-9a-f]{3}$/.test(hex)) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
          a: 1
        };
      }
      if (/^[0-9a-f]{4}$/.test(hex)) {
        return {
          r: parseInt(hex[0] + hex[0], 16),
          g: parseInt(hex[1] + hex[1], 16),
          b: parseInt(hex[2] + hex[2], 16),
          a: parseInt(hex[3] + hex[3], 16) / 255
        };
      }
      if (/^[0-9a-f]{6}$/.test(hex)) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: 1
        };
      }
      if (/^[0-9a-f]{8}$/.test(hex)) {
        return {
          r: parseInt(hex.slice(0, 2), 16),
          g: parseInt(hex.slice(2, 4), 16),
          b: parseInt(hex.slice(4, 6), 16),
          a: parseInt(hex.slice(6, 8), 16) / 255
        };
      }
      return null;
    }

    const fnMatch = str.match(/^(rgba?|hsla?)\((.+)\)$/);
    if (!fnMatch) {
      return null;
    }

    const fnName = fnMatch[1];
    const body = fnMatch[2].trim();
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

    if (fnName === 'rgb' || fnName === 'rgba') {
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

  function linearizeChannel(channel255) {
    const c = clamp(channel255, 0, 255) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  function relativeLuminance(color) {
    const parsed = parseCssColor(color);
    if (!parsed) {
      return null;
    }
    const rLin = linearizeChannel(parsed.r);
    const gLin = linearizeChannel(parsed.g);
    const bLin = linearizeChannel(parsed.b);
    return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
  }

  function isDarkColor(color, threshold) {
    const limit = typeof threshold === 'number' ? threshold : 0.25;
    const parsed = parseCssColor(color);
    if (!parsed || parsed.a < 0.1) {
      return false;
    }
    const lum = relativeLuminance(parsed);
    return lum !== null && lum < limit;
  }

  function isLightColor(color, threshold) {
    const limit = typeof threshold === 'number' ? threshold : 0.35;
    const parsed = parseCssColor(color);
    if (!parsed || parsed.a < 0.1) {
      return false;
    }
    const lum = relativeLuminance(parsed);
    return lum !== null && lum > limit;
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

  function darkenBackgroundColor(color, presetColors) {
    const parsed = parseCssColor(color);
    if (!parsed) {
      return null;
    }
    if (parsed.a < 0.05) {
      return formatCssColor(parsed.r, parsed.g, parsed.b, parsed.a);
    }
    if (isDarkColor(parsed, 0.22)) {
      return formatCssColor(parsed.r, parsed.g, parsed.b, parsed.a);
    }

    const baseTarget = resolvePresetTarget(presetColors, 'bg', '#121418');
    const baseHsl = rgbToHsl(baseTarget.r, baseTarget.g, baseTarget.b);
    const hsl = rgbToHsl(parsed.r, parsed.g, parsed.b);

    // Pure/near-white or neutral light grey surfaces snap smoothly to dark theme surfaces
    if (hsl.s <= 14) {
      if (hsl.l >= 94) {
        return formatCssColor(baseTarget.r, baseTarget.g, baseTarget.b, parsed.a);
      }
      // Map light neutral greys (l: 45..94) into elevated dark surfaces (l: baseL+2 .. baseL+12)
      const invertedRatio = clamp((100 - hsl.l) / 55, 0, 1);
      const targetL = clamp(baseHsl.l + invertedRatio * 12, baseHsl.l, 22);
      const rgb = hslToRgb(baseHsl.h, baseHsl.s, targetL);
      return formatCssColor(rgb.r, rgb.g, rgb.b, parsed.a);
    }

    // Tinted / colored light backgrounds preserve hue while shifting to rich dark surface
    const darkS = clamp(hsl.s * 0.65, 14, 52);
    const darkL = clamp(baseHsl.l + 6 + (100 - hsl.l) * 0.14, 10, 24);
    const rgb = hslToRgb(hsl.h, darkS, darkL);
    return formatCssColor(rgb.r, rgb.g, rgb.b, parsed.a);
  }

  function lightenTextColor(color, presetColors) {
    const parsed = parseCssColor(color);
    if (!parsed) {
      return null;
    }
    if (parsed.a < 0.05) {
      return formatCssColor(parsed.r, parsed.g, parsed.b, parsed.a);
    }
    const lum = relativeLuminance(parsed);
    if (lum !== null && lum >= 0.45) {
      return formatCssColor(parsed.r, parsed.g, parsed.b, parsed.a);
    }

    const textTarget = resolvePresetTarget(presetColors, 'text', '#e6e9ef');
    const targetHsl = rgbToHsl(textTarget.r, textTarget.g, textTarget.b);
    const hsl = rgbToHsl(parsed.r, parsed.g, parsed.b);

    // Neutral dark text (#000 .. #666) maps to readable preset text / secondary text
    if (hsl.s <= 16) {
      if (hsl.l <= 18) {
        return formatCssColor(textTarget.r, textTarget.g, textTarget.b, parsed.a);
      }
      const mutedRatio = clamp((hsl.l - 18) / 45, 0, 1);
      const lightL = clamp(targetHsl.l - mutedRatio * 14, 72, 94);
      const rgb = hslToRgb(targetHsl.h, targetHsl.s, lightL);
      return formatCssColor(rgb.r, rgb.g, rgb.b, parsed.a);
    }

    // Colored dark text (links, accents, badges) stays recognizable at high contrast
    const lightS = clamp(Math.max(hsl.s, 45), 40, 88);
    const lightL = clamp(72 + (100 - hsl.l) * 0.08, 68, 84);
    const rgb = hslToRgb(hsl.h, lightS, lightL);
    return formatCssColor(rgb.r, rgb.g, rgb.b, parsed.a);
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
