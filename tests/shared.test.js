'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function loadShared() {
  const Constants = require(path.join(ROOT, 'src/shared/constants.js'));
  const SiteMatcher = require(path.join(ROOT, 'src/shared/site-matcher.js'));
  const ColorUtils = require(path.join(ROOT, 'src/shared/color-utils.js'));
  const Schedule = require(path.join(ROOT, 'src/shared/schedule.js'));
  const Storage = require(path.join(ROOT, 'src/shared/storage.js'));
  return {
    Constants: Constants?.DEFAULT_SETTINGS ? Constants : globalThis.DarkExt?.Constants,
    SiteMatcher: SiteMatcher?.domainMatches ? SiteMatcher : globalThis.DarkExt?.SiteMatcher,
    ColorUtils: ColorUtils?.parseCssColor ? ColorUtils : globalThis.DarkExt?.ColorUtils,
    Schedule: Schedule?.isScheduleActive ? Schedule : globalThis.DarkExt?.Schedule,
    Storage: Storage?.getSettings ? Storage : globalThis.DarkExt?.Storage,
  };
}

function createChromeStorageMock() {
  const syncStore = {};
  const localStore = {};

  function makeArea(store) {
    return {
      async get(keys) {
        if (keys == null) return { ...store };
        if (typeof keys === 'string') {
          return keys in store ? { [keys]: structuredClone(store[keys]) } : {};
        }
        if (Array.isArray(keys)) {
          const out = {};
          for (const k of keys) {
            if (k in store) out[k] = structuredClone(store[k]);
          }
          return out;
        }
        const out = {};
        for (const [k, defVal] of Object.entries(keys)) {
          out[k] = k in store ? structuredClone(store[k]) : structuredClone(defVal);
        }
        return out;
      },
      async set(items) {
        for (const [k, v] of Object.entries(items)) {
          store[k] = structuredClone(v);
        }
      },
      async remove(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) delete store[k];
      },
      async clear() {
        for (const k of Object.keys(store)) delete store[k];
      },
    };
  }

  return {
    syncStore,
    localStore,
    storage: {
      sync: makeArea(syncStore),
      local: makeArea(localStore),
    },
  };
}

describe('Shared Constants & Global Attachment', () => {
  it('attaches all shared modules to globalThis.DarkExt and exports via module.exports', () => {
    const { Constants, SiteMatcher, ColorUtils, Schedule, Storage } = loadShared();
    assert.ok(globalThis.DarkExt, 'globalThis.DarkExt must exist');
    assert.ok(globalThis.DarkExt.Constants, 'DarkExt.Constants must exist');
    assert.ok(globalThis.DarkExt.SiteMatcher, 'DarkExt.SiteMatcher must exist');
    assert.ok(globalThis.DarkExt.ColorUtils, 'DarkExt.ColorUtils must exist');
    assert.ok(globalThis.DarkExt.Schedule, 'DarkExt.Schedule must exist');
    assert.ok(globalThis.DarkExt.Storage, 'DarkExt.Storage must exist');

    assert.equal(Constants.DEFAULT_SETTINGS.enabled, true);
    assert.equal(Constants.DEFAULT_SETTINGS.preset, 'midnight');
    assert.equal(Constants.DEFAULT_SETTINGS.defaultMode, 'auto');
    assert.equal(Constants.DEFAULT_SETTINGS.brightness, 100);
    assert.equal(Constants.DEFAULT_SETTINGS.contrast, 100);
    assert.equal(Constants.DEFAULT_SETTINGS.sepia, 0);
    assert.equal(Constants.DEFAULT_SETTINGS.imageBrightness, 90);
    assert.equal(Constants.DEFAULT_SETTINGS.grayscale, 0);

    for (const preset of ['midnight', 'oled', 'warm', 'slate', 'nord']) {
      assert.ok(Constants.THEME_PRESETS[preset], `Missing preset ${preset}`);
    }
    assert.ok(SiteMatcher && ColorUtils && Schedule && Storage);
  });
});

describe('SiteMatcher (src/shared/site-matcher.js)', () => {
  it('normalizes hostnames, extracts hostnames, and validates supported URLs', () => {
    const { SiteMatcher } = loadShared();

    assert.equal(SiteMatcher.normalizeHostname('  Docs.Google.COM. '), 'docs.google.com');
    assert.equal(SiteMatcher.normalizeHostname('SMILE.AMAZON.CO.UK'), 'smile.amazon.co.uk');
    assert.equal(SiteMatcher.normalizeHostname('WWW.Amazon.COM'), 'amazon.com');
    assert.equal(SiteMatcher.normalizeHostname(''), '');

    const amazonHost = SiteMatcher.extractHostname('https://www.amazon.com/dp/B09V3KXJPB?psc=1');
    assert.ok(amazonHost === 'www.amazon.com' || amazonHost === 'amazon.com');
    assert.equal(SiteMatcher.extractHostname('http://en.wikipedia.org:8080/wiki/Dark'), 'en.wikipedia.org');
    assert.equal(SiteMatcher.extractHostname('not-a-url'), '');

    assert.equal(SiteMatcher.isSupportedUrl('https://www.amazon.com/'), true);
    assert.equal(SiteMatcher.isSupportedUrl('http://localhost:3000/test'), true);
    assert.equal(SiteMatcher.isSupportedUrl('chrome://extensions'), false);
    assert.equal(SiteMatcher.isSupportedUrl('about:blank'), false);
    assert.equal(SiteMatcher.isSupportedUrl('edge://settings'), false);
    assert.equal(SiteMatcher.isSupportedUrl('chrome-extension://abcdef/popup.html'), false);
    assert.equal(SiteMatcher.isSupportedUrl(''), false);
  });

  it('matches exact domains, subdomains, regional wildcards, and rejects false suffixes', () => {
    const { SiteMatcher } = loadShared();

    assert.equal(SiteMatcher.domainMatches('etsy.com', 'etsy.com'), true);
    assert.equal(SiteMatcher.domainMatches('shop.etsy.com', 'etsy.com'), true);
    assert.equal(SiteMatcher.domainMatches('notetsy.com', 'etsy.com'), false);

    assert.equal(SiteMatcher.domainMatches('www.amazon.com', '*.amazon.*'), true);
    assert.equal(SiteMatcher.domainMatches('smile.amazon.co.uk', '*.amazon.*'), true);
    assert.equal(SiteMatcher.domainMatches('amazon.de', '*.amazon.*'), true);
    assert.equal(SiteMatcher.domainMatches('www.amazonia.com', '*.amazon.*'), false);

    assert.equal(SiteMatcher.domainMatches('www.ebay.de', '*.ebay.*'), true);
    assert.equal(SiteMatcher.domainMatches('fakeebay.com', '*.ebay.*'), false);
  });

  it('findMatchingTheme matches real registry.json entries for flagship sites', () => {
    const { SiteMatcher } = loadShared();
    const registry = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'src/themes/sites/registry.json'), 'utf8')
    );

    const cases = [
      ['www.amazon.com', 'amazon'],
      ['smile.amazon.co.uk', 'amazon'],
      ['www.ebay.de', 'ebay'],
      ['en.wikipedia.org', 'wikipedia'],
      ['docs.google.com', 'google-workspace'],
    ];

    for (const [host, expectedId] of cases) {
      const theme = SiteMatcher.findMatchingTheme(host, registry);
      assert.ok(theme, `Expected theme match for ${host}`);
      assert.equal(theme.id, expectedId, `Expected ${host} to match "${expectedId}", got "${theme.id}"`);
    }

    assert.equal(SiteMatcher.findMatchingTheme('example.com', registry), null);
  });

  it('resolveEffectiveSiteConfig respects global toggle, site rules, disabledThemes, and matched theme', () => {
    const { Constants, SiteMatcher } = loadShared();
    const registry = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'src/themes/sites/registry.json'), 'utf8')
    );

    const baseSettings = structuredClone(Constants.DEFAULT_SETTINGS);
    const amazonAuto = SiteMatcher.resolveEffectiveSiteConfig('www.amazon.com', baseSettings, registry);
    assert.equal(amazonAuto.enabled, true);
    assert.ok(amazonAuto.matchedTheme && amazonAuto.matchedTheme.id === 'amazon');

    const genericAuto = SiteMatcher.resolveEffectiveSiteConfig('example.com', baseSettings, registry);
    assert.equal(genericAuto.enabled, true);
    assert.equal(genericAuto.matchedTheme, null);

    // Disabled theme falls back to universal mode
    const withDisabledTheme = { ...baseSettings, disabledThemes: ['amazon'] };
    const amazonNoTheme = SiteMatcher.resolveEffectiveSiteConfig('www.amazon.com', withDisabledTheme, registry);
    assert.equal(amazonNoTheme.matchedTheme, null);

    // Site rule disabling a site
    const withRuleOff = {
      ...baseSettings,
      siteRules: { 'www.amazon.com': { enabled: false, mode: 'auto' } },
    };
    const amazonOff = SiteMatcher.resolveEffectiveSiteConfig('www.amazon.com', withRuleOff, registry);
    assert.equal(amazonOff.enabled, false);

    // Site rule forcing filter mode
    const withFilter = {
      ...baseSettings,
      siteRules: { 'example.com': { enabled: true, mode: 'filter', preset: 'oled' } },
    };
    const genericFilter = SiteMatcher.resolveEffectiveSiteConfig('example.com', withFilter, registry);
    assert.equal(genericFilter.enabled, true);
    assert.equal(genericFilter.mode, 'filter');
    assert.equal(genericFilter.preset, 'oled');

    // Native dark mode skip & forceOverrideNativeDark
    const skippedNative = SiteMatcher.resolveEffectiveSiteConfig('example.com', baseSettings, registry, {
      nativeDarkDetected: true,
    });
    assert.equal(skippedNative.active, false);
    assert.equal(skippedNative.skippedNativeDark, true);

    // Even a curated site-theme domain is skipped in auto mode when native dark mode is already active
    const wikiNativeSkipped = SiteMatcher.resolveEffectiveSiteConfig('en.wikipedia.org', baseSettings, registry, {
      nativeDarkDetected: true,
    });
    assert.equal(wikiNativeSkipped.active, false);
    assert.equal(wikiNativeSkipped.mode, 'off');
    assert.equal(wikiNativeSkipped.skippedNativeDark, true);

    const wikiForcedOverride = SiteMatcher.resolveEffectiveSiteConfig(
      'en.wikipedia.org',
      {
        ...baseSettings,
        siteRules: { 'en.wikipedia.org': { enabled: true, mode: 'auto', forceOverrideNativeDark: true } },
      },
      registry,
      { nativeDarkDetected: true }
    );
    assert.equal(wikiForcedOverride.active, true);
    assert.equal(wikiForcedOverride.mode, 'site-theme');
    assert.equal(wikiForcedOverride.skippedNativeDark, false);

    const forcedNative = SiteMatcher.resolveEffectiveSiteConfig(
      'example.com',
      {
        ...baseSettings,
        siteRules: { 'example.com': { enabled: true, mode: 'dynamic', forceOverrideNativeDark: true } },
      },
      registry,
      { nativeDarkDetected: true }
    );
    assert.equal(forcedNative.active, true);
    assert.equal(forcedNative.skippedNativeDark, false);

    // Schedule blocked
    const noonScheduleBlocked = SiteMatcher.resolveEffectiveSiteConfig(
      'example.com',
      { ...baseSettings, schedule: { mode: 'time', startTime: '20:00', endTime: '07:00' } },
      registry,
      { now: new Date(2026, 0, 1, 12, 0) }
    );
    assert.equal(noonScheduleBlocked.active, false);
    assert.equal(noonScheduleBlocked.scheduleBlocked, true);
  });
});

describe('ColorUtils (src/shared/color-utils.js)', () => {
  it('parses hex, rgb, rgba, and hsl colors and computes luminance accurately', () => {
    const { ColorUtils } = loadShared();

    assert.deepEqual(ColorUtils.parseCssColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
    assert.deepEqual(ColorUtils.parseCssColor('#121418'), { r: 18, g: 20, b: 24, a: 1 });

    const hex8 = ColorUtils.parseCssColor('#00000080');
    assert.ok(hex8 && hex8.r === 0 && hex8.g === 0 && hex8.b === 0);
    assert.ok(Math.abs(hex8.a - 128 / 255) < 0.02);

    assert.deepEqual(ColorUtils.parseCssColor('rgb(18, 20, 24)'), { r: 18, g: 20, b: 24, a: 1 });
    assert.deepEqual(ColorUtils.parseCssColor('rgba(255, 128, 0, 0.5)'), { r: 255, g: 128, b: 0, a: 0.5 });

    const hslRed = ColorUtils.parseCssColor('hsl(0, 100%, 50%)');
    assert.ok(hslRed && hslRed.r >= 254 && hslRed.g <= 1 && hslRed.b <= 1 && hslRed.a === 1);

    assert.equal(ColorUtils.parseCssColor('not-a-color'), null);

    // rgbToHsl / hslToRgb round-trip
    const hslBlue = ColorUtils.rgbToHsl(0, 128, 255);
    assert.ok(hslBlue.h > 205 && hslBlue.h < 215);
    const backRgb = ColorUtils.hslToRgb(hslBlue);
    assert.ok(Math.abs(backRgb.r - 0) <= 2 && Math.abs(backRgb.g - 128) <= 2 && Math.abs(backRgb.b - 255) <= 2);

    assert.ok(ColorUtils.relativeLuminance({ r: 255, g: 255, b: 255 }) > 0.99);
    assert.equal(ColorUtils.relativeLuminance({ r: 0, g: 0, b: 0 }), 0);

    assert.equal(ColorUtils.isDarkColor({ r: 18, g: 20, b: 24 }), true);
    assert.equal(ColorUtils.isLightColor({ r: 18, g: 20, b: 24 }), false);
    assert.equal(ColorUtils.isLightColor({ r: 255, g: 255, b: 255 }), true);
    assert.equal(ColorUtils.isDarkColor({ r: 255, g: 255, b: 255 }), false);
  });

  it('darkens light backgrounds and lightens dark text into readable colors', () => {
    const { ColorUtils } = loadShared();

    const darkBgStr = ColorUtils.darkenBackgroundColor({ r: 255, g: 255, b: 255, a: 1 });
    assert.equal(typeof darkBgStr, 'string');
    const parsedDark = ColorUtils.parseCssColor(darkBgStr);
    assert.ok(parsedDark, `darkenBackgroundColor returned unparseable color: ${darkBgStr}`);
    assert.ok(ColorUtils.relativeLuminance(parsedDark) < 0.2, 'Darkened white bg should have low luminance');

    const lightTextStr = ColorUtils.lightenTextColor({ r: 20, g: 20, b: 20, a: 1 });
    assert.equal(typeof lightTextStr, 'string');
    const parsedLight = ColorUtils.parseCssColor(lightTextStr);
    assert.ok(parsedLight, `lightenTextColor returned unparseable color: ${lightTextStr}`);
    assert.ok(ColorUtils.relativeLuminance(parsedLight) > 0.45, 'Lightened dark text should have high luminance');

    // White-gray and mid-gray surfaces must darken deeply (< 0.06 luminance) for crisp white text contrast
    for (const grayHex of ['#f0f2f2', '#e3e6e6', '#cccccc', '#888888', '#767676']) {
      const darkened = ColorUtils.darkenBackgroundColor(grayHex);
      const parsed = ColorUtils.parseCssColor(darkened);
      assert.ok(parsed, `Expected valid darkened color for ${grayHex}`);
      const lum = ColorUtils.relativeLuminance(parsed);
      assert.ok(
        lum !== null && lum < 0.06,
        `Expected ${grayHex} -> ${darkened} to have luminance < 0.06, got ${lum}`
      );
    }

    // Dark and mid-gray text must lift to high luminance (>= 0.55)
    for (const textHex of ['#111111', '#555555', '#767676', '#888888']) {
      const lightened = ColorUtils.lightenTextColor(textHex);
      const parsed = ColorUtils.parseCssColor(lightened);
      assert.ok(parsed, `Expected valid lightened text color for ${textHex}`);
      const lum = ColorUtils.relativeLuminance(parsed);
      assert.ok(
        lum !== null && lum >= 0.55,
        `Expected ${textHex} -> ${lightened} to have luminance >= 0.55, got ${lum}`
      );
    }
  });
});

describe('Schedule (src/shared/schedule.js)', () => {
  it('handles off, system, daytime windows, and overnight wrap-around windows', () => {
    const { Schedule } = loadShared();

    assert.equal(Schedule.parseTimeToMinutes('00:00'), 0);
    assert.equal(Schedule.parseTimeToMinutes('07:30'), 450);
    assert.equal(Schedule.parseTimeToMinutes('20:00'), 1200);

    // Daytime window 09:00 - 17:00
    assert.equal(Schedule.isWithinTimeWindow(12 * 60, '09:00', '17:00'), true);
    assert.equal(Schedule.isWithinTimeWindow(9 * 60, '09:00', '17:00'), true);
    assert.equal(Schedule.isWithinTimeWindow(8 * 60 + 59, '09:00', '17:00'), false);
    assert.equal(Schedule.isWithinTimeWindow(18 * 60, '09:00', '17:00'), false);

    // Overnight wrap-around 20:00 - 07:00
    assert.equal(Schedule.isWithinTimeWindow(22 * 60, '20:00', '07:00'), true);
    assert.equal(Schedule.isWithinTimeWindow(2 * 60 + 30, '20:00', '07:00'), true);
    assert.equal(Schedule.isWithinTimeWindow(12 * 60, '20:00', '07:00'), false);
    assert.equal(Schedule.isWithinTimeWindow(19 * 60 + 59, '20:00', '07:00'), false);
    assert.equal(Schedule.isWithinTimeWindow(7 * 60 + 1, '20:00', '07:00'), false);

    // isScheduleActive
    assert.equal(Schedule.isScheduleActive({ mode: 'off' }), true);
    assert.equal(Schedule.isScheduleActive({ mode: 'system' }, true), true);
    assert.equal(Schedule.isScheduleActive({ mode: 'system' }, false), false);

    const nightDate = new Date(2026, 0, 1, 22, 30);
    const noonDate = new Date(2026, 0, 1, 12, 0);
    const overnight = { mode: 'time', startTime: '20:00', endTime: '07:00' };
    assert.equal(Schedule.isScheduleActive(overnight, false, nightDate), true);
    assert.equal(Schedule.isScheduleActive(overnight, false, noonDate), false);
  });
});

describe('Storage (src/shared/storage.js)', () => {
  let prevChrome;

  beforeEach(() => {
    prevChrome = globalThis.chrome;
    globalThis.chrome = createChromeStorageMock();
  });

  afterEach(() => {
    globalThis.chrome = prevChrome;
  });

  it('persists settings, site rules, custom CSS, and supports resetAll', async () => {
    const { Constants, Storage } = loadShared();

    const initial = await Storage.getSettings();
    assert.deepEqual(initial, Constants.DEFAULT_SETTINGS);

    const updated = await Storage.updateSettings({ preset: 'oled', brightness: 92 });
    assert.equal(updated.preset, 'oled');
    assert.equal(updated.brightness, 92);

    const fetched = await Storage.getSettings();
    assert.equal(fetched.preset, 'oled');
    assert.equal(fetched.brightness, 92);

    await Storage.setSiteRule('www.amazon.com', { enabled: false, mode: 'filter' });
    const afterRule = await Storage.getSettings();
    assert.equal(afterRule.siteRules['amazon.com'].enabled, false);
    assert.equal(afterRule.siteRules['amazon.com'].mode, 'filter');

    await Storage.deleteSiteRule('www.amazon.com');
    const afterDelete = await Storage.getSettings();
    assert.equal(afterDelete.siteRules['amazon.com'], undefined);

    await Storage.setCustomCss('www.ebay.com', 'body { background: #000; }');
    const css = await Storage.getCustomCss('www.ebay.com');
    assert.equal(css, 'body { background: #000; }');

    const allCss = await Storage.getAllCustomCss();
    assert.equal(allCss['ebay.com'], 'body { background: #000; }');

    const resetResult = await Storage.resetAll();
    assert.equal(resetResult.preset, Constants.DEFAULT_SETTINGS.preset);
    assert.deepEqual(resetResult.siteRules, {});
    const afterResetCss = await Storage.getAllCustomCss();
    assert.deepEqual(afterResetCss, {});
  });
});
