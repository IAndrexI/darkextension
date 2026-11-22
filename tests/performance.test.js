'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { performance } = require('node:perf_hooks');

const ROOT = path.resolve(__dirname, '..');

function readRepoFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function stripJsComments(src) {
  let out = '';
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === '/' && next === '/') {
      const nl = src.indexOf('\n', i + 2);
      if (nl === -1) break;
      out += '\n';
      i = nl + 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;
      out += ' ';
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      out += ch;
      i += 1;
      while (i < len) {
        out += src[i];
        if (src[i] === '\\' && i + 1 < len) {
          i += 1;
          out += src[i];
          i += 1;
          continue;
        }
        if (src[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function loadFreshSharedModules() {
  const paths = [
    'src/shared/constants.js',
    'src/shared/schedule.js',
    'src/shared/site-matcher.js',
    'src/shared/color-utils.js',
    'src/shared/storage.js',
  ].map((rel) => path.join(ROOT, rel));

  for (const p of paths) {
    delete require.cache[require.resolve(p)];
  }

  const Constants = require(paths[0]);
  const Schedule = require(paths[1]);
  const SiteMatcher = require(paths[2]);
  const ColorUtils = require(paths[3]);
  const Storage = require(paths[4]);

  return { Constants, Schedule, SiteMatcher, ColorUtils, Storage };
}

function camelToKebab(prop) {
  return prop.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

function createMockDomHarness(options = {}) {
  const initialUrl = options.url || 'https://example.com/page';
  const getComputedStyleCalls = new Map();
  const getBoundingClientRectCalls = new Map();
  const rafQueue = new Map();
  let nextRafId = 1;
  const timerQueue = new Map();
  let nextTimerId = 1;
  const observers = [];

  function createMockStyle(ownerEl) {
    const props = new Map();

    function syncStyleAttr() {
      if (!ownerEl) return;
      if (props.size === 0) {
        if (!ownerEl._rawStyleKeepEmpty) {
          ownerEl._attrs.delete('style');
        }
        return;
      }
      const parts = [];
      for (const [k, entry] of props.entries()) {
        parts.push(`${k}: ${entry.value}${entry.priority ? ' !' + entry.priority : ''}`);
      }
      ownerEl._attrs.set('style', parts.join('; '));
    }

    const target = {
      setProperty(name, value, priority = '') {
        const key = String(name).toLowerCase();
        if (value === undefined || value === null || value === '') {
          props.delete(key);
        } else {
          props.set(key, { value: String(value), priority: priority ? String(priority) : '' });
        }
        syncStyleAttr();
      },
      removeProperty(name) {
        const key = String(name).toLowerCase();
        const prev = props.get(key);
        props.delete(key);
        syncStyleAttr();
        return prev ? prev.value : '';
      },
      getPropertyValue(name) {
        const key = String(name).toLowerCase();
        const entry = props.get(key);
        return entry ? entry.value : '';
      },
      getPropertyPriority(name) {
        const key = String(name).toLowerCase();
        const entry = props.get(key);
        return entry ? entry.priority : '';
      },
      get length() {
        return props.size;
      },
      get cssText() {
        const parts = [];
        for (const [k, entry] of props.entries()) {
          parts.push(`${k}: ${entry.value}${entry.priority ? ' !' + entry.priority : ''};`);
        }
        return parts.join(' ');
      },
      set cssText(val) {
        props.clear();
        const raw = String(val || '').trim();
        if (raw) {
          for (const decl of raw.split(';')) {
            const idx = decl.indexOf(':');
            if (idx === -1) continue;
            const k = decl.slice(0, idx).trim().toLowerCase();
            let v = decl.slice(idx + 1).trim();
            let priority = '';
            if (v.toLowerCase().endsWith('!important')) {
              priority = 'important';
              v = v.slice(0, -10).trim();
            }
            if (k && v) {
              props.set(k, { value: v, priority });
            }
          }
        }
        syncStyleAttr();
      },
      _props: props,
    };

    return new Proxy(target, {
      get(obj, prop) {
        if (prop in obj) {
          const val = obj[prop];
          return typeof val === 'function' ? val.bind(obj) : val;
        }
        if (typeof prop === 'string') {
          const kebab = camelToKebab(prop);
          const entry = props.get(kebab);
          return entry ? entry.value : '';
        }
        return undefined;
      },
      set(obj, prop, value) {
        if (prop === 'cssText') {
          obj.cssText = value;
          return true;
        }
        if (typeof prop === 'string') {
          obj.setProperty(camelToKebab(prop), value, '');
          return true;
        }
        obj[prop] = value;
        return true;
      },
    });
  }

  function matchesSimpleSelector(el, selector) {
    const sel = selector.trim();
    if (!sel) return false;
    if (sel.includes(',')) {
      return sel.split(',').some((part) => matchesSimpleSelector(el, part));
    }
    if (sel.startsWith('#')) {
      return el.id === sel.slice(1);
    }
    if (sel.startsWith('.')) {
      return el.classList.contains(sel.slice(1));
    }
    const tagAttrMatch = /^([a-zA-Z0-9_-]+)?\[([^\]=]+)(?:=["']([^"']*)["'])?\]$/.exec(sel);
    if (tagAttrMatch) {
      const tag = tagAttrMatch[1];
      const attr = tagAttrMatch[2];
      const val = tagAttrMatch[3];
      if (tag && el.tagName.toLowerCase() !== tag.toLowerCase()) return false;
      if (!el.hasAttribute(attr)) return false;
      if (val !== undefined && el.getAttribute(attr) !== val) return false;
      return true;
    }
    return el.tagName.toLowerCase() === sel.toLowerCase();
  }

  function createMockElement(tagName, computedOverrides = {}) {
    const el = {
      nodeType: 1,
      tagName: String(tagName || 'div').toUpperCase(),
      namespaceURI: 'http://www.w3.org/1999/xhtml',
      children: [],
      parentNode: null,
      parentElement: null,
      shadowRoot: null,
      _attrs: new Map(),
      _textContent: '',
      _rawStyleKeepEmpty: false,
      _rect: { width: 0, height: 0, top: 0, left: 0 },
      _computed: Object.assign(
        {
          display: 'block',
          visibility: 'visible',
          position: 'static',
          backgroundColor: 'rgba(0, 0, 0, 0)',
          backgroundImage: 'none',
          backgroundRepeat: 'repeat',
          mixBlendMode: 'normal',
          color: 'rgb(17, 17, 17)',
          opacity: '1',
          boxShadow: 'none',
          colorScheme: 'light',
          borderTopWidth: '0px',
          borderTopStyle: 'none',
          borderTopColor: 'rgb(0, 0, 0)',
          borderRightWidth: '0px',
          borderRightStyle: 'none',
          borderRightColor: 'rgb(0, 0, 0)',
          borderBottomWidth: '0px',
          borderBottomStyle: 'none',
          borderBottomColor: 'rgb(0, 0, 0)',
          borderLeftWidth: '0px',
          borderLeftStyle: 'none',
          borderLeftColor: 'rgb(0, 0, 0)',
        },
        computedOverrides
      ),
      get id() {
        return el._attrs.get('id') || '';
      },
      set id(v) {
        if (v) el._attrs.set('id', String(v));
        else el._attrs.delete('id');
      },
      get className() {
        return el._attrs.get('class') || '';
      },
      set className(v) {
        if (v) el._attrs.set('class', String(v));
        else el._attrs.delete('class');
      },
      get textContent() {
        return el._textContent;
      },
      set textContent(v) {
        el._textContent = String(v ?? '');
      },
      get isConnected() {
        let cur = el;
        while (cur) {
          if (cur === doc.documentElement) return true;
          cur = cur.parentNode || cur.host || null;
        }
        return false;
      },
      setAttribute(name, value) {
        el._attrs.set(String(name), String(value));
      },
      getAttribute(name) {
        const key = String(name);
        return el._attrs.has(key) ? el._attrs.get(key) : null;
      },
      hasAttribute(name) {
        return el._attrs.has(String(name));
      },
      removeAttribute(name) {
        el._attrs.delete(String(name));
      },
      appendChild(child) {
        if (child.parentNode && child.parentNode !== el && typeof child.parentNode.removeChild === 'function') {
          child.parentNode.removeChild(child);
        }
        child.parentNode = el;
        child.parentElement = el.nodeType === 1 ? el : null;
        el.children.push(child);
        return child;
      },
      removeChild(child) {
        const idx = el.children.indexOf(child);
        if (idx !== -1) {
          el.children.splice(idx, 1);
          child.parentNode = null;
          child.parentElement = null;
        }
        return child;
      },
      remove() {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      },
      attachShadow() {
        const root = {
          nodeType: 11,
          host: el,
          children: [],
          appendChild(child) {
            child.parentNode = root;
            child.parentElement = null;
            root.children.push(child);
            return child;
          },
          removeChild(child) {
            const idx = root.children.indexOf(child);
            if (idx !== -1) {
              root.children.splice(idx, 1);
              child.parentNode = null;
            }
            return child;
          },
          querySelector(sel) {
            return root.querySelectorAll(sel)[0] || null;
          },
          querySelectorAll(sel) {
            const out = [];
            function walk(node) {
              for (const c of node.children || []) {
                if (c.nodeType === 1) {
                  if (matchesSimpleSelector(c, sel)) out.push(c);
                  walk(c);
                }
              }
            }
            walk(root);
            return out;
          },
        };
        el.shadowRoot = root;
        return root;
      },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        function walk(node) {
          for (const c of node.children || []) {
            if (c.nodeType === 1) {
              if (matchesSimpleSelector(c, sel)) out.push(c);
              walk(c);
            }
          }
        }
        walk(el);
        return out;
      },
      getBoundingClientRect() {
        getBoundingClientRectCalls.set(el, (getBoundingClientRectCalls.get(el) || 0) + 1);
        return el._rect;
      },
    };

    el.style = createMockStyle(el);

    el.classList = {
      add(...tokens) {
        const cur = new Set((el.className || '').split(/\s+/).filter(Boolean));
        for (const t of tokens) cur.add(t);
        el.className = Array.from(cur).join(' ');
      },
      remove(...tokens) {
        const cur = new Set((el.className || '').split(/\s+/).filter(Boolean));
        for (const t of tokens) cur.delete(t);
        el.className = Array.from(cur).join(' ');
      },
      contains(token) {
        return (el.className || '').split(/\s+/).filter(Boolean).includes(token);
      },
      toggle(token, force) {
        const has = el.classList.contains(token);
        const next = force !== undefined ? Boolean(force) : !has;
        if (next) el.classList.add(token);
        else el.classList.remove(token);
        return next;
      },
      get length() {
        return (el.className || '').split(/\s+/).filter(Boolean).length;
      },
      [Symbol.iterator]() {
        return (el.className || '').split(/\s+/).filter(Boolean)[Symbol.iterator]();
      },
    };

    return el;
  }

  const html = createMockElement('html', { backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(17, 17, 17)' });
  const head = createMockElement('head');
  const body = createMockElement('body', { backgroundColor: 'rgb(255, 255, 255)', color: 'rgb(17, 17, 17)' });
  html.appendChild(head);
  html.appendChild(body);

  const docListeners = new Map();
  const winListeners = new Map();

  const doc = {
    documentElement: html,
    head,
    body,
    readyState: options.readyState || 'complete',
    defaultView: null,
    createElement(tag) {
      return createMockElement(tag);
    },
    getElementById(id) {
      if (html.id === id) return html;
      return html.querySelector(`#${id}`);
    },
    querySelector(sel) {
      if (matchesSimpleSelector(html, sel)) return html;
      return html.querySelector(sel);
    },
    querySelectorAll(sel) {
      const results = [];
      if (matchesSimpleSelector(html, sel)) results.push(html);
      results.push(...html.querySelectorAll(sel));
      return results;
    },
    createTreeWalker(rootNode) {
      const nodes = [];
      function collect(node) {
        for (const child of node.children || []) {
          if (child.nodeType === 1) {
            nodes.push(child);
            collect(child);
          }
        }
      }
      if (rootNode) collect(rootNode);
      let idx = 0;
      return {
        nextNode() {
          if (idx >= nodes.length) return null;
          return nodes[idx++];
        },
      };
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = docListeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
  };

  class MockMutationObserver {
    constructor(callback) {
      this.callback = callback;
      this.observed = [];
      this.disconnected = false;
      observers.push(this);
    }
    observe(target, opts) {
      this.disconnected = false;
      this.observed.push({ target, opts });
    }
    disconnect() {
      this.disconnected = true;
    }
    takeRecords() {
      return [];
    }
  }

  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    history: {
      pushState() {},
      replaceState() {},
    },
    matchMedia() {
      return {
        matches: Boolean(options.prefersDark),
        addEventListener() {},
        removeEventListener() {},
      };
    },
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, []);
      winListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = winListeners.get(type);
      if (!list) return;
      const idx = list.indexOf(fn);
      if (idx !== -1) list.splice(idx, 1);
    },
    getComputedStyle(el) {
      getComputedStyleCalls.set(el, (getComputedStyleCalls.get(el) || 0) + 1);
      return new Proxy(el._computed || {}, {
        get(target, prop) {
          if (typeof prop === 'string') {
            const kebab = camelToKebab(prop);
            if (el.style && el.style._props && el.style._props.has(kebab)) {
              return el.style._props.get(kebab).value;
            }
          }
          return target[prop] !== undefined ? target[prop] : '';
        },
      });
    },
  };
  doc.defaultView = win;

  function mockSetTimeout(fn) {
    const id = nextTimerId++;
    timerQueue.set(id, fn);
    return id;
  }

  function mockClearTimeout(id) {
    timerQueue.delete(id);
  }

  function mockRaf(fn) {
    const id = nextRafId++;
    rafQueue.set(id, fn);
    return id;
  }

  function mockCancelRaf(id) {
    rafQueue.delete(id);
  }

  function flushTimers() {
    const entries = Array.from(timerQueue.entries());
    timerQueue.clear();
    for (const [, fn] of entries) {
      fn();
    }
    return entries.length;
  }

  function flushFrames(maxFrames = 50) {
    let executed = 0;
    while (rafQueue.size > 0 && executed < maxFrames) {
      const entries = Array.from(rafQueue.entries());
      rafQueue.clear();
      for (const [, fn] of entries) {
        executed += 1;
        fn(performance.now());
      }
    }
    return executed;
  }

  function triggerMutations(records) {
    for (const obs of observers) {
      if (!obs.disconnected && typeof obs.callback === 'function') {
        obs.callback(records, obs);
      }
    }
  }

  return {
    html,
    head,
    body,
    doc,
    win,
    location: { href: initialUrl },
    createMockElement,
    MockMutationObserver,
    getComputedStyleCalls,
    getBoundingClientRectCalls,
    observers,
    rafQueue,
    timerQueue,
    mockSetTimeout,
    mockClearTimeout,
    mockRaf,
    mockCancelRaf,
    flushTimers,
    flushFrames,
    triggerMutations,
  };
}

describe('ColorUtils Performance & Cache Safety', () => {
  it('benchmarks 20,000 calls across parseCssColor, darkenBackgroundColor, lightenTextColor, and relativeLuminance under 150ms', (t) => {
    const { ColorUtils } = loadFreshSharedModules();
    const samples = [
      '#ffffff',
      '#f4f6fa',
      '#e3e6e6',
      '#cccccc',
      '#767676',
      '#111111',
      '#121418',
      '#0066cc',
      'rgb(255, 255, 255)',
      'rgb(18, 20, 24)',
      'rgb(240, 242, 245)',
      'rgba(0, 102, 204, 0.85)',
      'rgba(0, 0, 0, 0)',
      'rgba(255, 153, 0, 1)',
      'hsl(210, 60%, 40%)',
      'white',
      'black',
      'transparent',
    ];
    const presetColors = { bg: '#121418', text: '#f4f6fa' };

    let sink = 0;
    const iterations = 5000; // 5,000 * 4 calls = 20,000 calls total
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      const color = samples[i % samples.length];
      const parsed = ColorUtils.parseCssColor(color);
      const dark = ColorUtils.darkenBackgroundColor(color, presetColors);
      const light = ColorUtils.lightenTextColor(color, presetColors);
      const lum = ColorUtils.relativeLuminance(color);
      sink += (parsed ? parsed.r : 0) + (dark ? dark.length : 0) + (light ? light.length : 0) + (lum || 0);
    }
    const elapsedMs = performance.now() - start;

    assert.ok(sink > 0, 'Benchmark loop must produce non-zero checksum');
    t.diagnostic(`ColorUtils 20,000 calls elapsed: ${elapsedMs.toFixed(2)}ms (budget < 150ms)`);
    console.log(`[benchmark] ColorUtils 20,000 calls: ${elapsedMs.toFixed(2)}ms`);
    assert.ok(elapsedMs < 150, `Expected 20,000 ColorUtils calls < 150ms, took ${elapsedMs.toFixed(2)}ms`);
  });

  it('protects parseCssColor cache immutability from caller mutations', () => {
    const { ColorUtils } = loadFreshSharedModules();

    const first = ColorUtils.parseCssColor('rgb(100, 150, 200)');
    assert.deepEqual(first, { r: 100, g: 150, b: 200, a: 1 });
    first.r = 0;
    first.g = 0;
    first.b = 0;
    first.a = 0;

    const second = ColorUtils.parseCssColor('rgb(100, 150, 200)');
    assert.equal(second.r, 100, 'Mutating returned object must not corrupt cached r');
    assert.equal(second.g, 150, 'Mutating returned object must not corrupt cached g');
    assert.equal(second.b, 200, 'Mutating returned object must not corrupt cached b');
    assert.equal(second.a, 1, 'Mutating returned object must not corrupt cached a');

    // Also verify hex & named colors return fresh copies
    const hex1 = ColorUtils.parseCssColor('#6496c8');
    hex1.r = 1;
    const hex2 = ColorUtils.parseCssColor('#6496c8');
    assert.equal(hex2.r, 100);

    const named1 = ColorUtils.parseCssColor('white');
    named1.r = 0;
    const named2 = ColorUtils.parseCssColor('white');
    assert.equal(named2.r, 255);
  });

  it('handles > 600 distinct colors cleanly with bounded FIFO/LRU caches', () => {
    const { ColorUtils } = loadFreshSharedModules();
    const src = readRepoFile('src/shared/color-utils.js');
    assert.ok(src.includes('parseCache'), 'color-utils.js should define parseCache');
    assert.ok(src.includes('darkenCache'), 'color-utils.js should define darkenCache');
    assert.ok(src.includes('lightenCache'), 'color-utils.js should define lightenCache');

    for (let i = 0; i < 700; i += 1) {
      const r = i % 256;
      const g = Math.floor(i / 256);
      const b = (i * 17) % 256;
      const color = `rgb(${r}, ${g}, ${b})`;
      const parsed = ColorUtils.parseCssColor(color);
      assert.deepEqual(parsed, { r, g, b, a: 1 });
      const dark = ColorUtils.darkenBackgroundColor(color);
      const light = ColorUtils.lightenTextColor(color);
      const lum = ColorUtils.relativeLuminance(color);
      assert.equal(typeof dark, 'string');
      assert.equal(typeof light, 'string');
      assert.equal(typeof lum, 'number');
    }

    // Re-parse early entries after eviction
    const evictedReCheck = ColorUtils.parseCssColor('rgb(5, 0, 85)');
    assert.deepEqual(evictedReCheck, { r: 5, g: 0, b: 85, a: 1 });

    // Fast path edge cases still parse accurately
    assert.deepEqual(ColorUtils.parseCssColor('rgba(12, 34, 56, 0.5)'), { r: 12, g: 34, b: 56, a: 0.5 });
    assert.deepEqual(ColorUtils.parseCssColor('rgb( 255 , 128 , 0 )'), { r: 255, g: 128, b: 0, a: 1 });
    assert.deepEqual(ColorUtils.parseCssColor('rgb(100%, 50%, 0%)'), { r: 255, g: 128, b: 0, a: 1 });
    assert.equal(ColorUtils.parseCssColor('rgb(bad, 0, 0)'), null);
  });

  it('verifies SRGB_LUT accuracy against IEC sRGB transfer function across 0-255 values', () => {
    const { ColorUtils } = loadFreshSharedModules();
    const src = readRepoFile('src/shared/color-utils.js');
    assert.ok(src.includes('SRGB_LUT'), 'color-utils.js must precompute SRGB_LUT');
    assert.match(src, /new\s+Float64Array\s*\(\s*256\s*\)/, 'SRGB_LUT must be a 256-entry Float64Array');

    const sampleChannels = [0, 1, 5, 10, 11, 16, 32, 64, 100, 128, 192, 224, 250, 255];
    for (const c of sampleChannels) {
      const norm = c / 255;
      const expected = c <= 10 ? norm / 12.92 : ((norm + 0.055) / 1.055) ** 2.4;
      const actual = ColorUtils.relativeLuminance({ r: c, g: c, b: c, a: 1 });
      assert.ok(
        Math.abs(actual - expected) < 1e-6,
        `Channel ${c}: expected ${expected}, got ${actual}`
      );
    }
  });
});

describe('SiteMatcher Performance & Semantics', () => {
  it('benchmarks 10,000 calls across normalizeHostname and domainMatches under 150ms', (t) => {
    const { SiteMatcher } = loadFreshSharedModules();
    const src = readRepoFile('src/shared/site-matcher.js');
    assert.ok(src.includes('patternRegexCache'), 'site-matcher.js must define patternRegexCache');

    const hosts = [
      'amazon.com',
      'docs.google.com',
      'en.wikipedia.org',
      'www.amazon.com',
      'HTTPS://WWW.EBAY.DE/itm/12345',
      'Smile.Amazon.Co.Uk.',
      'localhost:3000',
    ];
    const matchCases = [
      ['www.amazon.com', '*.amazon.*', true],
      ['smile.amazon.co.uk', '*.amazon.*', true],
      ['www.amazonia.com', '*.amazon.*', false],
      ['shop.etsy.com', 'etsy.com', true],
      ['notetsy.com', 'etsy.com', false],
      ['en.wikipedia.org', '*.wikipedia.org', true],
      ['docs.google.com', 'docs.google.com', true],
    ];

    let matchesCount = 0;
    const iterations = 5000; // 5,000 normalizeHostname + 5,000 domainMatches = 10,000 calls
    const start = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      const norm = SiteMatcher.normalizeHostname(hosts[i % hosts.length]);
      const [h, pat] = matchCases[i % matchCases.length];
      if (SiteMatcher.domainMatches(h, pat)) matchesCount += 1;
      if (norm.length === 0) throw new Error('Unexpected empty hostname');
    }
    const elapsedMs = performance.now() - start;

    assert.ok(matchesCount > 0);
    t.diagnostic(`SiteMatcher 10,000 calls elapsed: ${elapsedMs.toFixed(2)}ms (budget < 150ms)`);
    console.log(`[benchmark] SiteMatcher 10,000 calls: ${elapsedMs.toFixed(2)}ms`);
    assert.ok(elapsedMs < 150, `Expected 10,000 SiteMatcher calls < 150ms, took ${elapsedMs.toFixed(2)}ms`);

    // Exact semantics verification
    assert.equal(SiteMatcher.normalizeHostname('amazon.com'), 'amazon.com');
    assert.equal(SiteMatcher.normalizeHostname('www.amazon.com'), 'amazon.com');
    assert.equal(SiteMatcher.normalizeHostname('www.com'), 'www.com');
    assert.equal(SiteMatcher.normalizeHostname('docs.google.com.'), 'docs.google.com');
    assert.equal(SiteMatcher.normalizeHostname('https://WWW.Ebay.COM:8080/b'), 'ebay.com');
    assert.equal(SiteMatcher.normalizeHostname('[::1]:8080'), '[::1]');

    for (const [host, pattern, expected] of matchCases) {
      assert.equal(
        SiteMatcher.domainMatches(host, pattern),
        expected,
        `domainMatches("${host}", "${pattern}") expected ${expected}`
      );
    }

    // Bounded patternRegexCache across > 300 distinct wildcard patterns
    for (let i = 0; i < 320; i += 1) {
      assert.equal(SiteMatcher.domainMatches(`sub.site${i}.com`, `*.site${i}.com`), true);
      assert.equal(SiteMatcher.domainMatches(`sub.other${i}.com`, `*.site${i}.com`), false);
    }
  });
});

describe('DynamicEngine Structural & Functional Optimization Checks', () => {
  it('uses O(1) queueHead, frame time budget, split mutation buffers, batch caches, and vibrantColorCache', () => {
    const src = stripJsComments(readRepoFile('src/content/dynamic-engine.js'));

    assert.ok(src.includes('queueHead'), 'dynamic-engine.js must use O(1) queueHead index');
    assert.equal(/pendingQueue\.shift\s*\(/.test(src), false, 'dynamic-engine.js must NOT call pendingQueue.shift()');
    assert.ok(src.includes('FRAME_BUDGET_MS'), 'dynamic-engine.js must define FRAME_BUDGET_MS');
    assert.ok(src.includes('performance.now()'), 'dynamic-engine.js must measure frame budget with performance.now()');
    assert.ok(src.includes('addedSubtreeBuffer'), 'dynamic-engine.js must use addedSubtreeBuffer');
    assert.ok(src.includes('attrTargetBuffer'), 'dynamic-engine.js must use attrTargetBuffer');
    assert.ok(src.includes('styleCache'), 'dynamic-engine.js must use batch styleCache');
    assert.ok(src.includes('ancestorBgCache'), 'dynamic-engine.js must use batch ancestorBgCache');
    assert.ok(src.includes('vibrantColorCache'), 'dynamic-engine.js must use vibrantColorCache');
  });

  function loadDynamicEngineInMockDom(options = {}) {
    const { Constants, ColorUtils } = loadFreshSharedModules();
    const dom = createMockDomHarness(options);

    const sandbox = {
      console,
      performance,
      NodeFilter: { SHOW_ELEMENT: 1 },
      MutationObserver: dom.MockMutationObserver,
      document: dom.doc,
      window: dom.win,
      location: dom.location,
      requestAnimationFrame: dom.mockRaf,
      cancelAnimationFrame: dom.mockCancelRaf,
      setTimeout: dom.mockSetTimeout,
      clearTimeout: dom.mockClearTimeout,
      DarkExt: {
        Constants,
        ColorUtils,
      },
      globalThis: null,
    };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    const engineCode = readRepoFile('src/content/dynamic-engine.js');
    vm.runInContext(engineCode, context, { filename: path.join(ROOT, 'src/content/dynamic-engine.js') });

    return {
      DynamicEngine: context.DarkExt.DynamicEngine,
      dom,
      context,
    };
  }

  it('conditionally gates data-darkext-dim-images attribute based on dimImages and imageBrightness', () => {
    const { DynamicEngine, dom } = loadDynamicEngineInMockDom();

    DynamicEngine.apply({
      mode: 'dynamic',
      preset: 'midnight',
      dimImages: true,
      imageBrightness: 80,
    });
    assert.equal(dom.html.getAttribute('data-darkext-dim-images'), 'true');

    DynamicEngine.apply({
      mode: 'dynamic',
      preset: 'midnight',
      dimImages: true,
      imageBrightness: 100,
    });
    assert.equal(dom.html.hasAttribute('data-darkext-dim-images'), false);

    DynamicEngine.apply({
      mode: 'dynamic',
      preset: 'midnight',
      dimImages: false,
      imageBrightness: 80,
    });
    assert.equal(dom.html.hasAttribute('data-darkext-dim-images'), false);

    DynamicEngine.apply({
      mode: 'dynamic',
      preset: 'midnight',
      dimImages: true,
      imageBrightness: 90,
    });
    assert.equal(dom.html.getAttribute('data-darkext-dim-images'), 'true');

    DynamicEngine.teardown();
  });

  it('runs apply, multi-frame sweep, style/ancestor cache reuse, split mutation buffering, and clean teardown', () => {
    const { DynamicEngine, dom } = loadDynamicEngineInMockDom();

    // Shared light container with 25 sibling nodes + hidden subtree + vibrant CTA + extra nodes for multi-frame sweep
    const card = dom.createMockElement('div', {
      backgroundColor: 'rgb(245, 245, 245)',
      color: 'rgb(20, 20, 20)',
      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.1)',
    });
    card.className = 'card';
    dom.body.appendChild(card);

    const children = [];
    for (let i = 0; i < 25; i += 1) {
      const span = dom.createMockElement('span', {
        backgroundColor: 'rgba(0, 0, 0, 0)',
        color: 'rgb(34, 34, 34)',
      });
      card.appendChild(span);
      children.push(span);
    }

    const hiddenDiv = dom.createMockElement('div', {
      display: 'none',
      backgroundColor: 'rgb(255, 255, 255)',
      color: 'rgb(0, 0, 0)',
    });
    hiddenDiv.style.setProperty('display', 'none');
    const hiddenChild = dom.createMockElement('p', {
      backgroundColor: 'rgb(255, 255, 255)',
      color: 'rgb(0, 0, 0)',
    });
    hiddenDiv.appendChild(hiddenChild);
    dom.body.appendChild(hiddenDiv);

    const ctaBtn = dom.createMockElement('button', {
      backgroundColor: 'rgb(255, 153, 0)',
      color: 'rgb(15, 17, 17)',
    });
    dom.body.appendChild(ctaBtn);

    // Add 300 extra elements to verify time/node-capped multi-frame processing
    const bulkNodes = [];
    for (let i = 0; i < 300; i += 1) {
      const item = dom.createMockElement('div', {
        backgroundColor: 'rgb(255, 255, 255)',
        color: 'rgb(17, 17, 17)',
      });
      dom.body.appendChild(item);
      bulkNodes.push(item);
    }

    DynamicEngine.apply({
      mode: 'dynamic',
      preset: 'midnight',
      dimImages: true,
      imageBrightness: 85,
    });

    assert.equal(DynamicEngine.isActive(), true);
    assert.equal(DynamicEngine.getMode(), 'dynamic');
    assert.equal(dom.html.getAttribute('data-darkext-active'), 'true');
    // First-paint viewport (300 nodes) should be darkened atomically inside apply() with zero frame crawl
    const styledAtApply = bulkNodes.filter((n) => n.getAttribute('data-darkext-styled') === '1').length;
    assert.equal(
      styledAtApply,
      bulkNodes.length,
      `Expected all ${bulkNodes.length} initial viewport nodes darkened synchronously on apply(), got ${styledAtApply}`
    );

    assert.equal(card.getAttribute('data-darkext-styled'), '1');
    assert.ok(card.style.getPropertyValue('background-color'), 'Light card background should be darkened');
    for (const span of children) {
      assert.equal(span.getAttribute('data-darkext-styled'), '1');
      assert.ok(span.style.getPropertyValue('color'), 'Dark text on transparent child should be lightened');
    }
    assert.equal(hiddenDiv.hasAttribute('data-darkext-styled'), false, 'display:none element must be skipped');

    // Batch cache check: card has 25 children sharing it as immediate parent; getComputedStyle on card should be cached
    const cardStyleCalls = dom.getComputedStyleCalls.get(card) || 0;
    assert.ok(
      cardStyleCalls <= 4,
      `Expected batch style/ancestor cache to keep card getComputedStyle calls <= 4, got ${cardStyleCalls}`
    );

    // Mutation test 1: childList mutation enqueues and darkens newly inserted subtree immediately pre-paint
    const dynParent = dom.createMockElement('div', {
      backgroundColor: 'rgb(255, 255, 255)',
      color: 'rgb(20, 20, 20)',
    });
    const dynChild = dom.createMockElement('p', {
      backgroundColor: 'rgb(250, 250, 250)',
      color: 'rgb(30, 30, 30)',
    });
    dynParent.appendChild(dynChild);
    dom.body.appendChild(dynParent);

    dom.triggerMutations([{ type: 'childList', addedNodes: [dynParent] }]);

    assert.equal(
      dynParent.getAttribute('data-darkext-styled'),
      '1',
      'childList added parent must darken immediately pre-paint without waiting for debounce timer'
    );
    assert.equal(
      dynChild.getAttribute('data-darkext-styled'),
      '1',
      'childList added child must darken immediately pre-paint without waiting for debounce timer'
    );

    // Mutation test 2: attributes mutation enqueues ONLY target element, not its subtree children
    const attrParent = dom.createMockElement('div', {
      backgroundColor: 'rgb(255, 255, 255)',
      color: 'rgb(20, 20, 20)',
    });
    const attrChild = dom.createMockElement('span', {
      backgroundColor: 'rgb(255, 255, 255)',
      color: 'rgb(20, 20, 20)',
    });
    attrParent.appendChild(attrChild);
    dom.body.appendChild(attrParent);
    // Do NOT emit childList for attrParent/attrChild; emit attributes ONLY on attrParent
    dom.triggerMutations([{ type: 'attributes', target: attrParent, attributeName: 'class' }]);
    dom.flushTimers();
    dom.flushFrames(10);

    assert.equal(attrParent.getAttribute('data-darkext-styled'), '1');
    assert.equal(
      attrChild.hasAttribute('data-darkext-styled'),
      false,
      'Attribute mutation must enqueue only the target element, not re-walk its entire subtree'
    );

    // Teardown test: restores all styles, clears root attributes, disconnects observers, clears queue
    DynamicEngine.teardown();
    assert.equal(DynamicEngine.isActive(), false);
    assert.equal(DynamicEngine.getMode(), 'off');
    assert.equal(dom.html.hasAttribute('data-darkext-active'), false);
    assert.equal(dom.html.hasAttribute('data-darkext-mode'), false);
    assert.equal(dom.html.hasAttribute('data-darkext-preset'), false);
    assert.equal(dom.html.hasAttribute('data-darkext-dim-images'), false);
    assert.equal(dom.doc.getElementById('darkext-runtime-vars'), null);
    assert.equal(card.hasAttribute('data-darkext-styled'), false);
    assert.equal(card.hasAttribute('style'), false);
    assert.equal(dynChild.hasAttribute('data-darkext-styled'), false);
    assert.ok(dom.observers.every((o) => o.disconnected), 'All MutationObservers must disconnect on teardown');

    // Re-apply after teardown works cleanly
    DynamicEngine.apply({
      mode: 'dynamic',
      preset: 'oled',
      dimImages: true,
      imageBrightness: 90,
    });
    dom.flushFrames(20);
    assert.equal(card.getAttribute('data-darkext-styled'), '1');
    DynamicEngine.teardown();

    // Very large DOM (> 1,200 node sync cap) schedules rAF spillover and drains cleanly
    const massiveNodes = [];
    for (let i = 0; i < 1600; i += 1) {
      const node = dom.createMockElement('div', {
        backgroundColor: 'rgb(255, 255, 255)',
        color: 'rgb(17, 17, 17)',
      });
      dom.body.appendChild(node);
      massiveNodes.push(node);
    }
    DynamicEngine.apply({
      mode: 'dynamic',
      preset: 'midnight',
      dimImages: false,
      imageBrightness: 100,
    });
    assert.ok(dom.rafQueue.size > 0, 'DOMs exceeding MAX_NODES_PER_SYNC_PASS must schedule rAF spillover');
    const styledAfterSync = massiveNodes.filter((n) => n.hasAttribute('data-darkext-styled')).length;
    assert.ok(
      styledAfterSync > 0 && styledAfterSync < massiveNodes.length,
      `Expected partial sync + rAF continuation for 1600+ nodes, got ${styledAfterSync} styled initially`
    );
    dom.flushFrames(20);
    assert.equal(dom.rafQueue.size, 0, 'Remaining nodes must finish draining across animation frames');
    assert.equal(massiveNodes[massiveNodes.length - 1].getAttribute('data-darkext-styled'), '1');
    DynamicEngine.teardown();
  });

  it('neutralizes mix-blend-mode: multiply on media wrappers & light tint overlays and restores cleanly', () => {
    const { DynamicEngine, dom } = loadDynamicEngineInMockDom();

    const imgWrap = dom.createMockElement('div', {
      mixBlendMode: 'multiply',
      backgroundColor: 'rgba(0, 0, 0, 0)',
    });
    const prodImg = dom.createMockElement('img');
    imgWrap.appendChild(prodImg);
    dom.body.appendChild(imgWrap);

    const tintOverlay = dom.createMockElement('div', {
      mixBlendMode: 'multiply',
      backgroundColor: 'rgb(247, 247, 247)',
      position: 'absolute',
    });
    dom.body.appendChild(tintOverlay);

    DynamicEngine.apply({
      mode: 'site-theme',
      preset: 'oled',
      siteThemeId: 'amazon',
      dimImages: true,
      imageBrightness: 90,
    });
    dom.flushFrames(5);

    assert.equal(imgWrap.style.getPropertyValue('mix-blend-mode'), 'normal');
    assert.equal(tintOverlay.style.getPropertyValue('mix-blend-mode'), 'normal');
    assert.equal(
      tintOverlay.style.getPropertyValue('background-color'),
      'transparent',
      'Empty multiply light tint overlay must become transparent instead of opaque black'
    );

    DynamicEngine.teardown();
    assert.equal(imgWrap.style.getPropertyValue('mix-blend-mode'), '');
    assert.equal(tintOverlay.style.getPropertyValue('background-color'), '');
    assert.equal(tintOverlay.style.getPropertyValue('mix-blend-mode'), '');
  });

  it('darkens exposed white side margins on centered hero url(...) containers without touching leaf sprites', () => {
    const { DynamicEngine, dom } = loadDynamicEngineInMockDom();

    const heroWrapper = dom.createMockElement('div', {
      backgroundImage: 'url("https://example.com/hero.jpg")',
      backgroundRepeat: 'no-repeat',
      backgroundColor: 'rgb(255, 255, 255)',
    });
    heroWrapper.appendChild(dom.createMockElement('a'));
    dom.body.appendChild(heroWrapper);

    const leafSprite = dom.createMockElement('div', {
      backgroundImage: 'url("https://example.com/sprite.png")',
      backgroundRepeat: 'no-repeat',
      backgroundColor: 'rgb(255, 255, 255)',
    });
    dom.body.appendChild(leafSprite);

    DynamicEngine.apply({
      mode: 'site-theme',
      preset: 'midnight',
      siteThemeId: 'amazon',
      dimImages: false,
      imageBrightness: 100,
    });
    dom.flushFrames(5);

    assert.ok(
      heroWrapper.style.getPropertyValue('background-color'),
      'Centered hero url(...) container with white side margins must have background-color darkened'
    );
    assert.equal(
      heroWrapper.style.getPropertyValue('background-image'),
      '',
      'Hero container background-image must remain intact'
    );
    assert.equal(
      leafSprite.style.getPropertyValue('background-color'),
      '',
      'Empty leaf url(...) sprite element must not have its background altered'
    );

    DynamicEngine.teardown();
  });
});

describe('Startup, Broadcast & CSS Performance Audits', () => {
  it('content.js reads DarkExt.Storage directly in parallel with Promise.all and deduplicates REPORT_TAB_STATE', async () => {
    const contentSrc = stripJsComments(readRepoFile('src/content/content.js'));
    assert.ok(contentSrc.includes('Promise.all'), 'content.js must use Promise.all for parallel startup');
    assert.match(
      contentSrc,
      /DarkExt\.Storage/,
      'content.js startup must reference DarkExt.Storage'
    );
    assert.match(
      contentSrc,
      /\bgetSettings\s*\(/,
      'content.js startup must call getSettings() directly on storage'
    );
    assert.match(
      contentSrc,
      /\bgetCustomCss\s*\(/,
      'content.js startup must call getCustomCss() directly on storage'
    );

    const { Constants, Schedule, SiteMatcher, ColorUtils, Storage } = loadFreshSharedModules();
    const dom = createMockDomHarness({ url: 'https://www.amazon.com/dp/B09' });
    const sentMessages = [];
    const syncStore = {
      [Constants.STORAGE_KEY]: { ...Constants.DEFAULT_SETTINGS },
    };
    const localStore = {
      [Constants.CUSTOM_CSS_KEY]: { 'amazon.com': 'body { opacity: 1; }' },
    };

    const registryJson = readRepoFile('src/themes/sites/registry.json');

    const makeStorageArea = (store) => ({
      async get(keys) {
        if (keys == null) return structuredClone(store);
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
    });

    const sandbox = {
      console,
      URL,
      performance,
      NodeFilter: { SHOW_ELEMENT: 1 },
      MutationObserver: dom.MockMutationObserver,
      document: dom.doc,
      window: dom.win,
      location: dom.location,
      requestAnimationFrame: dom.mockRaf,
      cancelAnimationFrame: dom.mockCancelRaf,
      setTimeout: dom.mockSetTimeout,
      clearTimeout: dom.mockClearTimeout,
      fetch: async () => ({
        ok: true,
        json: async () => JSON.parse(registryJson),
      }),
      chrome: {
        storage: {
          sync: makeStorageArea(syncStore),
          local: makeStorageArea(localStore),
        },
        runtime: {
          getURL: (rel) => `chrome-extension://test/${rel}`,
          onMessage: { addListener() {} },
          async sendMessage(msg) {
            sentMessages.push(msg);
            return { ok: true };
          },
        },
      },
      DarkExt: { Constants, Schedule, SiteMatcher, ColorUtils, Storage },
      globalThis: null,
    };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);

    // Reload Storage bound to sandbox's chrome mock
    for (const rel of [
      'src/shared/constants.js',
      'src/shared/schedule.js',
      'src/shared/site-matcher.js',
      'src/shared/color-utils.js',
      'src/shared/storage.js',
      'src/content/detector.js',
      'src/content/dynamic-engine.js',
      'src/content/content.js',
    ]) {
      vm.runInContext(readRepoFile(rel), context, { filename: path.join(ROOT, rel) });
    }

    // Allow microtasks from bootstrap() to settle
    await new Promise((r) => setTimeout(r, 10));

    assert.equal(
      sentMessages.filter((m) => m.type === 'GET_SETTINGS').length,
      0,
      'content.js startup must not block on GET_SETTINGS SW message when Storage is available'
    );
    const reportsInitial = sentMessages.filter((m) => m.type === 'REPORT_TAB_STATE').length;
    assert.equal(reportsInitial, 1, 'Initial apply should report tab state once');

    // Re-running applyState with identical state must deduplicate REPORT_TAB_STATE
    await context.DarkExt.Content.applyState({ refetch: false });
    assert.equal(
      sentMessages.filter((m) => m.type === 'REPORT_TAB_STATE').length,
      1,
      'Unchanged state must deduplicate REPORT_TAB_STATE'
    );

    // Changing state must send a fresh REPORT_TAB_STATE
    syncStore[Constants.STORAGE_KEY] = { ...Constants.DEFAULT_SETTINGS, enabled: false };
    await context.DarkExt.Content.applyState({ refetch: true });
    assert.equal(
      sentMessages.filter((m) => m.type === 'REPORT_TAB_STATE').length,
      2,
      'Changed state must emit updated REPORT_TAB_STATE'
    );
  });

  it('detector.js removes article from PRIMARY_CONTAINER_SELECTOR and caps candidate scanning', () => {
    const detectorSrc = readRepoFile('src/content/detector.js');
    const selMatch = /PRIMARY_CONTAINER_SELECTOR\s*=\s*['"`]([^'"`]+)['"`]/.exec(detectorSrc);
    assert.ok(selMatch, 'detector.js must define PRIMARY_CONTAINER_SELECTOR');
    assert.equal(
      /\barticle\b/i.test(selMatch[1]),
      false,
      `PRIMARY_CONTAINER_SELECTOR must not include article, got: ${selMatch[1]}`
    );

    // Functional check: 30 candidate containers should be capped at <= 15 getBoundingClientRect calls
    const { ColorUtils } = loadFreshSharedModules();
    const dom = createMockDomHarness();
    for (let i = 0; i < 30; i += 1) {
      const div = dom.createMockElement('div', {
        backgroundColor: 'rgb(255, 255, 255)',
        color: 'rgb(17, 17, 17)',
      });
      div._rect = { width: 400, height: 400, top: 0, left: 0 }; // coverage = 160k / 1.024M ~ 0.156 (< 0.55)
      dom.body.appendChild(div);
    }

    const sandbox = {
      console,
      window: dom.win,
      document: dom.doc,
      DarkExt: { ColorUtils },
      globalThis: null,
    };
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(detectorSrc, context, { filename: path.join(ROOT, 'src/content/detector.js') });

    context.DarkExt.Detector.detectNativeDarkMode(dom.doc);
    let totalRectCalls = 0;
    for (const c of dom.getBoundingClientRectCalls.values()) totalRectCalls += c;
    assert.ok(totalRectCalls <= 15, `Expected candidate scan capped at <= 15 getBoundingClientRect calls, got ${totalRectCalls}`);
  });

  it('early-inject.js uses #f4f6fa text color in pre-paint shield', () => {
    const earlySrc = stripJsComments(readRepoFile('src/content/early-inject.js'));
    assert.ok(earlySrc.includes('#f4f6fa'), 'early-inject.js must use #f4f6fa');
    assert.equal(earlySrc.includes('#e6e9ef'), false, 'early-inject.js should replace #e6e9ef with #f4f6fa');
  });

  it('service-worker.js caches registry.json, uses Promise.allSettled in broadcastSettingsUpdated, and filters tabs.onUpdated', async () => {
    const swSrc = readRepoFile('src/background/service-worker.js');
    assert.ok(swSrc.includes('Promise.allSettled'), 'service-worker.js must use Promise.allSettled for tab broadcasts');
    assert.match(swSrc, /cachedRegistry|registryPromise/, 'service-worker.js must cache registry.json in memory');

    // Functional VM check for registry caching, filtered tabs.onUpdated, and Promise.allSettled resilience
    const registryJson = readRepoFile('src/themes/sites/registry.json');
    const manifestObj = JSON.parse(readRepoFile('manifest.json'));
    let fetchCount = 0;
    let storageSyncGetCount = 0;
    const badgeCalls = [];
    const tabMessages = [];

    const tabs = [
      { id: 1, active: true, currentWindow: true, url: 'https://www.amazon.com/' },
      { id: 2, active: false, currentWindow: true, url: 'https://www.ebay.com/' },
      { id: 3, active: false, currentWindow: true, url: 'https://en.wikipedia.org/' },
    ];

    const onMessageListeners = [];
    const onUpdatedListeners = [];
    const syncStore = {};
    const localStore = {};

    const chromeMock = {
      storage: {
        sync: {
          async get(key) {
            storageSyncGetCount += 1;
            return key in syncStore ? { [key]: structuredClone(syncStore[key]) } : {};
          },
          async set(items) {
            Object.assign(syncStore, structuredClone(items));
          },
          async clear() {},
        },
        local: {
          async get(key) {
            return key in localStore ? { [key]: structuredClone(localStore[key]) } : {};
          },
          async set(items) {
            Object.assign(localStore, structuredClone(items));
          },
          async clear() {},
        },
      },
      runtime: {
        id: 'darkext-perf-test',
        getManifest: () => manifestObj,
        getURL: (rel) => `chrome-extension://darkext-perf-test/${rel}`,
        onInstalled: { addListener() {} },
        onStartup: { addListener() {} },
        onMessage: { addListener: (fn) => onMessageListeners.push(fn) },
      },
      contextMenus: {
        create() {},
        removeAll(cb) { if (cb) cb(); },
        onClicked: { addListener() {} },
      },
      commands: { onCommand: { addListener() {} } },
      alarms: {
        async create() {},
        async clear() { return true; },
        onAlarm: { addListener() {} },
      },
      tabs: {
        async query(q) {
          if (q && q.active) return [tabs[0]];
          return tabs;
        },
        async get(id) {
          return tabs.find((t) => t.id === id) || tabs[0];
        },
        async sendMessage(tabId, msg) {
          if (tabId === 2) throw new Error('Receiving end does not exist');
          tabMessages.push({ tabId, msg });
          return { ok: true };
        },
        onActivated: { addListener() {} },
        onUpdated: { addListener: (fn) => onUpdatedListeners.push(fn) },
      },
      scripting: {
        async insertCSS() {},
        async removeCSS() {},
      },
      action: {
        async setBadgeText(details) { badgeCalls.push(details); },
        async setBadgeBackgroundColor() {},
        async setBadgeTextColor() {},
      },
    };

    const swDir = path.join(ROOT, 'src/background');
    const sandbox = {
      console,
      URL,
      chrome: chromeMock,
      self: null,
      globalThis: null,
      fetch: async () => {
        fetchCount += 1;
        return {
          ok: true,
          json: async () => JSON.parse(registryJson),
        };
      },
      importScripts(...scripts) {
        for (const rel of scripts) {
          const target = path.resolve(swDir, rel);
          vm.runInContext(fs.readFileSync(target, 'utf8'), context, { filename: target });
        }
      },
    };
    sandbox.self = sandbox;
    sandbox.globalThis = sandbox;
    const context = vm.createContext(sandbox);
    vm.runInContext(swSrc, context, { filename: path.join(swDir, 'service-worker.js') });

    function sendMsg(msg) {
      return new Promise((resolve, reject) => {
        const ret = onMessageListeners[0](msg, { tab: tabs[0] }, resolve);
        if (ret !== true) reject(new Error('Expected synchronous return true'));
      });
    }

    // Multiple GET_TAB_STATUS calls should only fetch registry.json once
    await sendMsg({ type: 'GET_TAB_STATUS', payload: { url: 'https://www.amazon.com/' } });
    await sendMsg({ type: 'GET_TAB_STATUS', payload: { url: 'https://www.ebay.com/' } });
    await sendMsg({ type: 'GET_TAB_STATUS', payload: { url: 'https://en.wikipedia.org/' } });
    assert.equal(fetchCount, 1, `Expected cached registry.json to be fetched once, got ${fetchCount}`);

    // tabs.onUpdated early filtering
    assert.ok(onUpdatedListeners.length > 0, 'Service worker must register tabs.onUpdated listener');
    const onUpdated = onUpdatedListeners[0];
    const prevStorageCount = storageSyncGetCount;
    const prevBadgeCount = badgeCalls.length;

    await onUpdated(10, { status: 'loading' }, { id: 10, url: 'https://www.amazon.com/' });
    assert.equal(storageSyncGetCount, prevStorageCount, 'tabs.onUpdated should ignore loading without url');
    assert.equal(badgeCalls.length, prevBadgeCount, 'tabs.onUpdated should not set badge on loading without url');

    await onUpdated(11, { status: 'complete', url: 'chrome://extensions' }, { id: 11, url: 'chrome://extensions' });
    await onUpdated(12, { status: 'complete', url: 'vivaldi://settings' }, { id: 12, url: 'vivaldi://settings' });
    await onUpdated(13, { status: 'complete', url: 'about:blank' }, { id: 13, url: 'about:blank' });
    assert.equal(storageSyncGetCount, prevStorageCount, 'tabs.onUpdated must skip storage reads for non-HTTP(S) URLs');
    assert.equal(fetchCount, 1, 'tabs.onUpdated must not fetch registry for non-HTTP(S) URLs');

    // Parallel broadcast resilience when one tab rejects
    const updResp = await sendMsg({ type: 'UPDATE_SETTINGS', payload: { patch: { preset: 'oled' } } });
    assert.equal(updResp.ok, true);
    const updatedTabIds = tabMessages
      .filter((m) => m.msg && m.msg.type === 'SETTINGS_UPDATED')
      .map((m) => m.tabId);
    assert.ok(updatedTabIds.includes(1), 'Healthy tab 1 must receive SETTINGS_UPDATED');
    assert.ok(updatedTabIds.includes(3), 'Healthy tab 3 must still receive SETTINGS_UPDATED even when tab 2 rejects');
  });

  it('variables.css drops transition: filter on img, video while retaining all 26 --de-* variables', () => {
    const varsCss = readRepoFile('src/themes/base/variables.css');
    const imgRuleMatch = /img\s*,\s*[\s\S]*?video\s*\{([^}]*)\}/.exec(varsCss);
    assert.ok(imgRuleMatch, 'variables.css must retain img, video dimming rule');
    assert.ok(imgRuleMatch[1].includes('filter:'), 'img, video rule must retain filter: brightness(...)');
    assert.equal(
      /transition\s*:/i.test(imgRuleMatch[1]),
      false,
      'variables.css must NOT apply transition: filter on bulk img, video rule'
    );

    const requiredVars = [
      '--de-bg',
      '--de-bg-elevated',
      '--de-bg-subtle',
      '--de-bg-hover',
      '--de-border',
      '--de-border-strong',
      '--de-text',
      '--de-text-secondary',
      '--de-text-muted',
      '--de-link',
      '--de-link-visited',
      '--de-accent',
      '--de-accent-hover',
      '--de-accent-text',
      '--de-danger',
      '--de-success',
      '--de-warning',
      '--de-shadow',
      '--de-card-shadow',
      '--de-scrollbar-track',
      '--de-scrollbar-thumb',
      '--de-image-brightness',
      '--de-filter-brightness',
      '--de-filter-contrast',
      '--de-filter-sepia',
      '--de-filter-grayscale',
    ];
    assert.equal(requiredVars.length, 26);
    for (const cssVar of requiredVars) {
      assert.ok(varsCss.includes(cssVar), `variables.css missing CSS variable ${cssVar}`);
    }

    assert.match(
      varsCss,
      /img\s*,[\s\S]*?picture\s*,[\s\S]*?video\s*\{[^}]*mix-blend-mode:\s*normal\s*!important/,
      'variables.css must force mix-blend-mode: normal !important on img, picture, video'
    );
  });

  it('amazon.css protects search icon sprite, Deals/Gateway layouts, carousel controls, and blend modes', () => {
    const amazonCss = readRepoFile('src/themes/sites/amazon.css');
    assert.ok(amazonCss.includes('[data-testid="grid-deals-container"]'), 'amazon.css must style [data-testid="grid-deals-container"]');
    assert.ok(amazonCss.includes('#gw-content-grid'), 'amazon.css must style #gw-content-grid');
    assert.ok(amazonCss.includes('.feed-carousel-control'), 'amazon.css must style carousel arrow controls');
    assert.ok(amazonCss.includes('mix-blend-mode: normal !important'), 'amazon.css must enforce mix-blend-mode: normal !important');

    const submitTextBlockRe = /html\[data-darkext-active="true"\]\[data-darkext-site="amazon"\]\s+#nav-search-submit-text\s*\{([^}]*)\}/;
    const submitTextMatch = submitTextBlockRe.exec(amazonCss);
    assert.ok(submitTextMatch, 'amazon.css must define #nav-search-submit-text rule');
    assert.equal(
      /background-image\s*:\s*none/i.test(submitTextMatch[1]),
      false,
      'amazon.css #nav-search-submit-text must NOT hide Amazon magnifying glass sprite with background-image: none'
    );
  });

  it('popup.js and options.js parallelize init with Promise.all and options.js debounces search inputs', () => {
    const popupSrc = stripJsComments(readRepoFile('src/popup/popup.js'));
    const loadInitMatch = /async function loadInitialState\s*\([^)]*\)\s*\{([\s\S]*?)\r?\n  \}/.exec(popupSrc);
    assert.ok(loadInitMatch, 'popup.js must define loadInitialState');
    assert.ok(loadInitMatch[1].includes('Promise.all'), 'popup.js loadInitialState must use Promise.all');

    const presetSelectMatch = /async function handlePresetSelect\s*\([^)]*\)\s*\{([\s\S]*?)\r?\n  \}/.exec(popupSrc);
    assert.ok(presetSelectMatch, 'popup.js must define handlePresetSelect');
    const callsUnconditionalTabQuery =
      presetSelectMatch[1].includes('queryActiveTab') &&
      !/if\s*\(\s*!state\.tabStateLoaded\s*\)/.test(presetSelectMatch[1]);
    assert.equal(
      callsUnconditionalTabQuery,
      false,
      'popup.js handlePresetSelect must not unconditionally call queryActiveTab()'
    );

    const optionsSrc = stripJsComments(readRepoFile('src/options/options.js'));
    const loadAllMatch = /async function loadAllData\s*\([^)]*\)\s*\{([\s\S]*?)\r?\n  \}/.exec(optionsSrc);
    assert.ok(loadAllMatch, 'options.js must define loadAllData');
    assert.ok(loadAllMatch[1].includes('Promise.all'), 'options.js loadAllData must use Promise.all');

    function assertSearchInputDebounced(fieldName, targetRenderFn) {
      const idx = optionsSrc.search(new RegExp(`el\\.${fieldName}\\.addEventListener\\s*\\(\\s*['"]input['"]\\s*,`));
      assert.ok(idx !== -1, `options.js must bind input listener on el.${fieldName}`);
      const snippet = optionsSrc.slice(idx, idx + 450);
      const idMatch = new RegExp(`el\\.${fieldName}\\.addEventListener\\s*\\(\\s*['"]input['"]\\s*,\\s*([a-zA-Z0-9_$]+)\\s*\\)`).exec(snippet);
      if (idMatch) {
        const fnName = idMatch[1];
        assert.notEqual(fnName, targetRenderFn, `el.${fieldName} must not call ${targetRenderFn} synchronously without debounce`);
        const fnDefRe = new RegExp(`(?:function\\s+${fnName}|(?:const|let|var)\\s+${fnName}\\s*=)[\\s\\S]{0,450}`);
        const fnDefMatch = fnDefRe.exec(optionsSrc);
        assert.ok(
          fnDefMatch && /setTimeout|debounce/i.test(fnDefMatch[0]),
          `el.${fieldName} handler ${fnName} must debounce with setTimeout`
        );
        return;
      }
      assert.ok(
        /setTimeout|debounce/i.test(snippet),
        `el.${fieldName} inline input listener must debounce with setTimeout`
      );
    }

    assertSearchInputDebounced('themeSearch', 'renderThemesSection');
    assertSearchInputDebounced('rulesSearch', 'renderSiteRulesSection');
  });

  it('native-dark-enforcer.js and detector.js activate built-in website dark mode and avoid overriding native dark sites', () => {
    const enforcerCode = readRepoFile('src/content/native-dark-enforcer.js');
    const enforcerListeners = [];
    const enforcerWin = {
      matchMedia(query) {
        const isLight = /prefers-color-scheme\s*:\s*light/i.test(query);
        return {
          media: query,
          matches: isLight,
          addEventListener() {},
          removeEventListener() {},
        };
      },
      addEventListener(type, fn) {
        if (type === '__darkext_native_dark_pref') {
          enforcerListeners.push(fn);
        }
      },
    };
    const enforcerSandbox = {
      window: enforcerWin,
      globalThis: null,
    };
    enforcerSandbox.globalThis = enforcerSandbox;
    const enforcerCtx = vm.createContext(enforcerSandbox);
    vm.runInContext(enforcerCode, enforcerCtx, {
      filename: path.join(ROOT, 'src/content/native-dark-enforcer.js'),
    });

    const darkMql = enforcerWin.matchMedia('(prefers-color-scheme: dark)');
    const lightMql = enforcerWin.matchMedia('(prefers-color-scheme: light)');
    const widthMql = enforcerWin.matchMedia('(max-width: 600px)');
    assert.equal(darkMql.matches, true, 'Enforcer must report prefers-color-scheme: dark as true');
    assert.equal(lightMql.matches, false, 'Enforcer must report prefers-color-scheme: light as false');
    assert.equal(widthMql.matches, false, 'Unrelated media queries must pass through untouched');

    let darkChangeEvents = 0;
    darkMql.addEventListener('change', () => {
      darkChangeEvents += 1;
    });
    for (const fn of enforcerListeners) {
      fn({ detail: { enabled: false } });
    }
    assert.equal(darkMql.matches, false, 'Disabling enforcer must restore underlying OS light preference');
    assert.equal(lightMql.matches, true);
    assert.equal(darkChangeEvents, 1, 'Toggling enforcer must notify registered MediaQueryList listeners');

    // Detector built-in activation & detection tests
    const { ColorUtils } = loadFreshSharedModules();
    const dom = createMockDomHarness();
    const detectorSandbox = {
      console,
      document: dom.doc,
      window: dom.win,
      DarkExt: { ColorUtils },
      globalThis: null,
    };
    detectorSandbox.globalThis = detectorSandbox;
    const detectorCtx = vm.createContext(detectorSandbox);
    vm.runInContext(readRepoFile('src/content/detector.js'), detectorCtx, {
      filename: path.join(ROOT, 'src/content/detector.js'),
    });
    const Detector = detectorCtx.DarkExt.Detector;

    // 1. Plain light site (e.g. Amazon/eBay) has no built-in dark mode
    assert.equal(Detector.activateNativeDarkIfAvailable(dom.doc).activated, false);
    assert.equal(Detector.detectNativeDarkMode(dom.doc).isNativeDark, false);

    // 2. Wikipedia Vector 2022 skin-theme-clientpref-day -> skin-theme-clientpref-night
    dom.html.classList.add('skin-theme-clientpref-day');
    dom.body._computed.backgroundColor = 'rgb(16, 20, 24)';
    dom.body._computed.color = 'rgb(248, 249, 250)';
    const wikiAct = Detector.activateNativeDarkIfAvailable(dom.doc);
    assert.equal(wikiAct.activated, true);
    assert.equal(dom.html.classList.contains('skin-theme-clientpref-night'), true);
    assert.equal(Detector.detectNativeDarkMode(dom.doc).isNativeDark, true);
    Detector.restoreNativeDarkActivation(dom.doc);
    assert.equal(dom.html.classList.contains('skin-theme-clientpref-day'), true);
    assert.equal(dom.html.classList.contains('skin-theme-clientpref-night'), false);
    dom.html.classList.remove('skin-theme-clientpref-day');

    // 3. GitHub Primer data-color-mode="light" + data-dark-theme="dark"
    dom.html.setAttribute('data-color-mode', 'light');
    dom.html.setAttribute('data-dark-theme', 'dark');
    const ghAct = Detector.activateNativeDarkIfAvailable(dom.doc);
    assert.equal(ghAct.activated, true);
    assert.equal(dom.html.getAttribute('data-color-mode'), 'dark');
    assert.equal(Detector.detectNativeDarkMode(dom.doc).isNativeDark, true);
    Detector.restoreNativeDarkActivation(dom.doc);
    assert.equal(dom.html.getAttribute('data-color-mode'), 'light');
    dom.html.removeAttribute('data-color-mode');
    dom.html.removeAttribute('data-dark-theme');

    // 4. YouTube boolean dark attribute (<html dark="">)
    dom.html.setAttribute('dark', '');
    assert.equal(Detector.detectNativeDarkMode(dom.doc).isNativeDark, true);
    dom.html.removeAttribute('dark');

    // 5. Accessible CSS @media (prefers-color-scheme: dark) bridge when OS is light
    dom.doc.styleSheets = [
      {
        ownerNode: { id: 'site-sheet', hasAttribute: () => false },
        cssRules: [
          {
            type: 4,
            conditionText: '(prefers-color-scheme: dark)',
            cssRules: [{ cssText: 'body { background-color: rgb(18, 18, 18); color: rgb(240, 240, 240); }' }],
          },
        ],
      },
    ];
    const mediaAct = Detector.activateNativeDarkIfAvailable(dom.doc);
    assert.equal(mediaAct.activated, true);
    const bridgeEl = dom.doc.getElementById('darkext-native-media-bridge');
    assert.ok(bridgeEl, 'Detector must inject #darkext-native-media-bridge for @media (prefers-color-scheme: dark)');
    assert.ok(bridgeEl.textContent.includes('rgb(18, 18, 18)'));
    Detector.restoreNativeDarkActivation(dom.doc);
    assert.equal(dom.doc.getElementById('darkext-native-media-bridge'), null);
  });
});
