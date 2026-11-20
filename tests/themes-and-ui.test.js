'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function walkFiles(dir, predicate) {
  if (!fs.existsSync(dir)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, predicate));
    } else if (!predicate || predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Strip CSS comments while preserving quoted strings.
 */
function stripCssComments(css) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < css.length) {
    const ch = css[i];
    const next = css[i + 1];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < css.length) {
        out += next;
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      const end = css.indexOf('*/', i + 2);
      if (end === -1) {
        out += ' ';
        break;
      }
      out += ' ';
      i = end + 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function assertBalancedCssBraces(css, label) {
  const clean = stripCssComments(css);
  let depth = 0;
  let quote = null;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      assert.ok(depth >= 0, `Unmatched closing brace '}' at index ${i} in ${label}`);
    }
  }
  assert.equal(quote, null, `Unterminated string literal in ${label}`);
  assert.equal(depth, 0, `Unbalanced '{' / '}' braces (remaining depth=${depth}) in ${label}`);
}

/**
 * Split selector list by commas outside brackets/parens/quotes.
 */
function splitSelectors(header) {
  const selectors = [];
  let current = '';
  let parenDepth = 0;
  let bracketDepth = 0;
  let quote = null;
  for (let i = 0; i < header.length; i += 1) {
    const ch = header[i];
    if (quote) {
      current += ch;
      if (ch === '\\' && i + 1 < header.length) {
        current += header[i + 1];
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '(') parenDepth += 1;
    else if (ch === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === '[') bracketDepth += 1;
    else if (ch === ']') bracketDepth = Math.max(0, bracketDepth - 1);
    else if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
      if (current.trim()) selectors.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

/**
 * Extract all CSS rule selector headers (recursing into @media/@supports/@layer/@container).
 */
function extractRuleSelectors(cssFragment) {
  const found = [];
  let i = 0;
  let buffer = '';
  let quote = null;

  while (i < cssFragment.length) {
    const ch = cssFragment[i];
    if (quote) {
      buffer += ch;
      if (ch === '\\' && i + 1 < cssFragment.length) {
        buffer += cssFragment[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      buffer += ch;
      i += 1;
      continue;
    }
    if (ch === ';') {
      buffer = '';
      i += 1;
      continue;
    }
    if (ch === '{') {
      const header = buffer.trim();
      buffer = '';
      // Find matching '}'
      let depth = 1;
      let j = i + 1;
      let innerQuote = null;
      while (j < cssFragment.length && depth > 0) {
        const c = cssFragment[j];
        if (innerQuote) {
          if (c === '\\') {
            j += 2;
            continue;
          }
          if (c === innerQuote) innerQuote = null;
        } else if (c === '"' || c === "'") {
          innerQuote = c;
        } else if (c === '{') {
          depth += 1;
        } else if (c === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
        j += 1;
      }
      const body = cssFragment.slice(i + 1, j);
      if (header.startsWith('@')) {
        const lower = header.toLowerCase();
        if (
          lower.startsWith('@media') ||
          lower.startsWith('@supports') ||
          lower.startsWith('@layer') ||
          lower.startsWith('@container') ||
          lower.startsWith('@document')
        ) {
          found.push(...extractRuleSelectors(body));
        }
      } else if (header) {
        found.push(...splitSelectors(header));
      }
      i = j + 1;
      continue;
    }
    buffer += ch;
    i += 1;
  }
  return found;
}

/**
 * Strip JS comments and string/template text literals so static checks examine executable code.
 */
function stripJsCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const len = src.length;
  let lastToken = '';
  const regexPrevKeywords = new Set([
    'return', 'throw', 'case', 'typeof', 'void', 'delete',
    'in', 'of', 'instanceof', 'new', 'await', 'yield', 'else',
  ]);
  const regexPrevPunct = new Set(['', '(', '[', '{', ',', ';', ':', '=', '!', '&', '|', '?', '~', '+', '-', '*', '%', '^', '<', '>']);

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
    if (ch === '/' && (regexPrevPunct.has(lastToken) || regexPrevKeywords.has(lastToken))) {
      // Regex literal
      out += ' ';
      i += 1;
      let inClass = false;
      while (i < len) {
        const rc = src[i];
        if (rc === '\\') {
          i += 2;
          continue;
        }
        if (rc === '[') inClass = true;
        else if (rc === ']' && inClass) inClass = false;
        else if (rc === '/' && !inClass) {
          i += 1;
          while (i < len && /[a-z]/i.test(src[i])) i += 1;
          break;
        } else if (rc === '\n') {
          break;
        }
        i += 1;
      }
      lastToken = 'regex';
      continue;
    }
    if (ch === '"' || ch === "'") {
      const q = ch;
      out += `${q}${q}`;
      i += 1;
      while (i < len) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === q) {
          i += 1;
          break;
        }
        i += 1;
      }
      lastToken = 'string';
      continue;
    }
    if (ch === '`') {
      out += '""';
      i += 1;
      while (i < len) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          out += ' ';
          i += 2;
          let braceDepth = 1;
          const exprStart = i;
          while (i < len && braceDepth > 0) {
            if (src[i] === '"' || src[i] === "'") {
              const iq = src[i];
              i += 1;
              while (i < len) {
                if (src[i] === '\\') i += 2;
                else if (src[i] === iq) {
                  i += 1;
                  break;
                } else i += 1;
              }
              continue;
            }
            if (src[i] === '{') braceDepth += 1;
            else if (src[i] === '}') {
              braceDepth -= 1;
              if (braceDepth === 0) break;
            }
            i += 1;
          }
          out += stripJsCommentsAndStrings(src.slice(exprStart, i));
          i += 1;
          continue;
        }
        if (src[i] === '`') {
          i += 1;
          break;
        }
        i += 1;
      }
      lastToken = 'string';
      continue;
    }
    if (/[a-zA-Z0-9_$]/.test(ch)) {
      let end = i + 1;
      while (end < len && /[a-zA-Z0-9_$]/.test(src[end])) end += 1;
      const ident = src.slice(i, end);
      out += ident;
      lastToken = ident;
      i = end;
      continue;
    }
    if (!/\s/.test(ch)) {
      lastToken = ch;
    }
    out += ch;
    i += 1;
  }
  return out;
}

describe('Site Themes Registry & CSS Audit', () => {
  it('registry.json is valid, has >= 17 unique entries including amazon and ebay, and all cssFiles exist', () => {
    const regPath = path.join(ROOT, 'src/themes/sites/registry.json');
    assert.ok(fs.existsSync(regPath), 'src/themes/sites/registry.json must exist');
    const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    assert.ok(Array.isArray(registry), 'registry.json must be a JSON array');
    assert.ok(registry.length >= 17, `Expected >= 17 site themes, got ${registry.length}`);

    const seenIds = new Set();
    for (const entry of registry) {
      assert.equal(typeof entry.id, 'string');
      assert.ok(entry.id.length > 0, 'Theme id must be non-empty');
      assert.equal(seenIds.has(entry.id), false, `Duplicate theme id: ${entry.id}`);
      seenIds.add(entry.id);

      assert.equal(typeof entry.name, 'string');
      assert.ok(entry.name.length > 0, `Missing name for theme ${entry.id}`);
      assert.equal(typeof entry.category, 'string');
      assert.ok(entry.category.length > 0, `Missing category for theme ${entry.id}`);
      assert.equal(typeof entry.description, 'string');
      assert.ok(entry.description.length > 0, `Missing description for theme ${entry.id}`);

      assert.ok(Array.isArray(entry.domains) && entry.domains.length > 0, `Empty domains for ${entry.id}`);
      for (const dom of entry.domains) {
        assert.equal(typeof dom, 'string');
        assert.ok(dom.trim().length > 0, `Empty domain string in ${entry.id}`);
      }

      assert.equal(typeof entry.cssFile, 'string');
      assert.ok(entry.cssFile.startsWith('src/themes/sites/'), `Unexpected cssFile path: ${entry.cssFile}`);
      const cssAbs = path.join(ROOT, entry.cssFile);
      assert.ok(fs.existsSync(cssAbs), `Missing CSS file for theme ${entry.id}: ${entry.cssFile}`);
      const cssContent = fs.readFileSync(cssAbs, 'utf8').trim();
      assert.ok(cssContent.length > 0, `CSS file is empty: ${entry.cssFile}`);
    }

    assert.ok(seenIds.has('amazon'), 'registry.json must include amazon');
    assert.ok(seenIds.has('ebay'), 'registry.json must include ebay');
  });

  it('base CSS files exist, have balanced braces, and variables.css covers all 5 presets and CSS variables', () => {
    const baseDir = path.join(ROOT, 'src/themes/base');
    const requiredBase = ['variables.css', 'universal-dynamic.css', 'universal-filter.css'];
    for (const name of requiredBase) {
      const p = path.join(baseDir, name);
      assert.ok(fs.existsSync(p), `Missing base CSS file: src/themes/base/${name}`);
      const css = fs.readFileSync(p, 'utf8');
      assert.ok(css.trim().length > 0, `Empty base CSS file: ${name}`);
      assertBalancedCssBraces(css, `src/themes/base/${name}`);
    }

    const varsCss = fs.readFileSync(path.join(baseDir, 'variables.css'), 'utf8');
    for (const preset of ['midnight', 'oled', 'warm', 'slate', 'nord']) {
      assert.ok(
        varsCss.includes(preset),
        `variables.css must define preset "${preset}"`
      );
    }

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
      '--de-scrollbar-track',
      '--de-scrollbar-thumb',
      '--de-image-brightness',
      '--de-filter-brightness',
      '--de-filter-contrast',
      '--de-filter-sepia',
      '--de-filter-grayscale',
    ];
    for (const cssVar of requiredVars) {
      assert.ok(varsCss.includes(cssVar), `variables.css missing CSS custom property ${cssVar}`);
    }
  });

  it('every site CSS file has balanced braces and every selector is scoped under html[data-darkext-active="true"][data-darkext-site="<id>"]', () => {
    const regPath = path.join(ROOT, 'src/themes/sites/registry.json');
    const registry = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    const byFile = new Map(registry.map((e) => [path.resolve(ROOT, e.cssFile), e.id]));

    const siteCssFiles = walkFiles(path.join(ROOT, 'src/themes/sites'), (f) => f.endsWith('.css'));
    assert.ok(siteCssFiles.length >= 17, `Expected >= 17 CSS files in src/themes/sites, got ${siteCssFiles.length}`);

    for (const cssPath of siteCssFiles) {
      const rel = path.relative(ROOT, cssPath);
      const css = fs.readFileSync(cssPath, 'utf8');
      assertBalancedCssBraces(css, rel);

      const expectedId = byFile.get(path.resolve(cssPath)) || path.basename(cssPath, '.css');
      const prefixA = `html[data-darkext-active="true"][data-darkext-site="${expectedId}"]`;
      const prefixB = `html[data-darkext-site="${expectedId}"][data-darkext-active="true"]`;

      const clean = stripCssComments(css);
      const selectors = extractRuleSelectors(clean);
      assert.ok(selectors.length > 0, `No CSS selectors found in ${rel}`);

      for (const sel of selectors) {
        const scoped =
          sel.startsWith(prefixA) ||
          sel.startsWith(prefixB);
        assert.ok(
          scoped,
          `Unscoped selector in ${rel}: "${sel}" must start with "${prefixA}"`
        );
      }
    }

    // Verify thorough coverage for flagship Amazon and eBay themes
    const amazonCss = fs.readFileSync(path.join(ROOT, 'src/themes/sites/amazon.css'), 'utf8');
    for (const token of ['#navbar', '#dp', '.s-result-item', '#navFooter']) {
      assert.ok(amazonCss.includes(token), `amazon.css should style ${token}`);
    }
    const ebayCss = fs.readFileSync(path.join(ROOT, 'src/themes/sites/ebay.css'), 'utf8');
    for (const token of ['#gh', '.srp-results', '.s-item', '#glbfooter']) {
      assert.ok(ebayCss.includes(token), `ebay.css should style ${token}`);
    }
  });
});

describe('UI HTML/CSS & MV3 JavaScript Compliance', () => {
  it('popup.html and options.html contain zero inline scripts, zero on*= attributes, and valid asset links', () => {
    const htmlFiles = [
      path.join(ROOT, 'src/popup/popup.html'),
      path.join(ROOT, 'src/options/options.html'),
    ];

    for (const htmlPath of htmlFiles) {
      const rel = path.relative(ROOT, htmlPath);
      assert.ok(fs.existsSync(htmlPath), `Missing HTML file: ${rel}`);
      const html = fs.readFileSync(htmlPath, 'utf8');
      assert.ok(html.trim().length > 0, `Empty HTML file: ${rel}`);

      // Check all <script> tags
      const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
      let match;
      let scriptCount = 0;
      while ((match = scriptRe.exec(html)) !== null) {
        scriptCount += 1;
        const attrs = match[1];
        const body = match[2];
        assert.equal(
          body.trim(),
          '',
          `MV3 CSP violation: inline <script> body found in ${rel}`
        );
        const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
        assert.ok(srcMatch, `<script> tag without src= attribute in ${rel}`);
        const srcPath = path.resolve(path.dirname(htmlPath), srcMatch[1]);
        assert.ok(
          fs.existsSync(srcPath),
          `Script referenced in ${rel} does not exist: ${srcMatch[1]}`
        );
      }
      assert.ok(scriptCount >= 5, `Expected shared + page scripts in ${rel}`);

      // Check <link> tags
      const linkRe = /<link\b([^>]*)>/gi;
      while ((match = linkRe.exec(html)) !== null) {
        const attrs = match[1];
        const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs);
        if (hrefMatch && !hrefMatch[1].startsWith('http')) {
          const hrefPath = path.resolve(path.dirname(htmlPath), hrefMatch[1]);
          assert.ok(
            fs.existsSync(hrefPath),
            `Stylesheet/asset referenced in ${rel} does not exist: ${hrefMatch[1]}`
          );
        }
      }

      // Check zero inline on*= event attributes inside any tag
      const tagRe = /<[a-zA-Z][^>]*>/g;
      while ((match = tagRe.exec(html)) !== null) {
        // Strip quoted attribute values before inspecting attribute names
        const tagWithoutValues = match[0].replace(/(=\s*)(?:"[^"]*"|'[^']*')/g, '$1""');
        assert.equal(
          /\s+on[a-z]+\s*=/i.test(tagWithoutValues),
          false,
          `MV3 CSP violation: inline event attribute found in ${rel}: ${match[0]}`
        );
      }
    }

    // Check popup.css and options.css balanced braces
    for (const cssRel of ['src/popup/popup.css', 'src/options/options.css']) {
      const cssAbs = path.join(ROOT, cssRel);
      assert.ok(fs.existsSync(cssAbs), `Missing UI CSS file: ${cssRel}`);
      assertBalancedCssBraces(fs.readFileSync(cssAbs, 'utf8'), cssRel);
    }
  });

  it('all JS/MJS files in src/ and scripts/ pass syntax check and MV3 security/async rules', () => {
    const jsFiles = [
      ...walkFiles(path.join(ROOT, 'src'), (f) => f.endsWith('.js')),
      ...walkFiles(path.join(ROOT, 'scripts'), (f) => f.endsWith('.js') || f.endsWith('.mjs')),
    ];
    assert.ok(jsFiles.length >= 12, `Expected >= 12 JS/MJS files, found ${jsFiles.length}`);

    for (const file of jsFiles) {
      const rel = path.relative(ROOT, file);
      // Syntax check with node --check
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });

      const raw = fs.readFileSync(file, 'utf8');
      const code = stripJsCommentsAndStrings(raw);

      assert.equal(
        /\beval\s*\(/.test(code),
        false,
        `Forbidden eval() call in ${rel}`
      );
      assert.equal(
        /\bnew\s+Function\s*\(/.test(code),
        false,
        `Forbidden new Function() call in ${rel}`
      );
      assert.equal(
        /\.then\s*\(/.test(code),
        false,
        `Forbidden .then() promise chain (must use pure async/await) in ${rel}`
      );
    }

    // Service worker specific rules
    const swPath = path.join(ROOT, 'src/background/service-worker.js');
    const swRaw = fs.readFileSync(swPath, 'utf8');
    const swCode = stripJsCommentsAndStrings(swRaw);
    assert.equal(/\bsetTimeout\s*\(/.test(swCode), false, 'Service worker must not use setTimeout');
    assert.equal(/\bsetInterval\s*\(/.test(swCode), false, 'Service worker must not use setInterval');
    assert.ok(
      swCode.includes('onMessage.addListener'),
      'Service worker must register chrome.runtime.onMessage.addListener'
    );
    assert.ok(
      /\breturn\s+true\b/.test(swCode),
      'Service worker onMessage listener must return true synchronously'
    );
    assert.ok(swCode.includes('chrome.alarms'), 'Service worker must use chrome.alarms');

    // UI non-blocking rules
    for (const uiRel of ['src/popup/popup.js', 'src/options/options.js']) {
      const uiCode = stripJsCommentsAndStrings(fs.readFileSync(path.join(ROOT, uiRel), 'utf8'));
      assert.equal(/\balert\s*\(/.test(uiCode), false, `${uiRel} must not use blocking alert()`);
      assert.equal(/\bconfirm\s*\(/.test(uiCode), false, `${uiRel} must not use blocking confirm()`);
      assert.equal(/\bprompt\s*\(/.test(uiCode), false, `${uiRel} must not use blocking prompt()`);
    }
  });

  it('message type constants and string literals match across constants.js, service-worker.js, content.js, popup.js, options.js', () => {
    const constants = require(path.join(ROOT, 'src/shared/constants.js'));
    const MESSAGE_TYPES = constants.MESSAGE_TYPES || globalThis.DarkExt?.Constants?.MESSAGE_TYPES;
    assert.ok(MESSAGE_TYPES && typeof MESSAGE_TYPES === 'object', 'MESSAGE_TYPES must be exported');

    const expectedTypes = [
      'GET_SETTINGS',
      'UPDATE_SETTINGS',
      'SET_SITE_RULE',
      'DELETE_SITE_RULE',
      'TOGGLE_GLOBAL',
      'TOGGLE_SITE',
      'GET_CUSTOM_CSS',
      'SET_CUSTOM_CSS',
      'GET_ALL_CUSTOM_CSS',
      'GET_TAB_STATUS',
      'INJECT_CSS_FILES',
      'REMOVE_CSS_FILES',
      'REPORT_TAB_STATE',
      'SETTINGS_UPDATED',
      'SHOW_TOAST',
      'RESET_SETTINGS',
    ];
    for (const msgType of expectedTypes) {
      assert.equal(
        MESSAGE_TYPES[msgType],
        msgType,
        `MESSAGE_TYPES.${msgType} must equal "${msgType}"`
      );
    }

    const validValues = new Set(Object.values(MESSAGE_TYPES));
    const filesToAudit = [
      'src/background/service-worker.js',
      'src/content/content.js',
      'src/popup/popup.js',
      'src/options/options.js',
    ];

    for (const rel of filesToAudit) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');

      // Verify every MESSAGE_TYPES.<KEY> reference exists
      const refRe = /\bMESSAGE_TYPES\.([A-Z0-9_]+)\b/g;
      let m;
      while ((m = refRe.exec(src)) !== null) {
        assert.ok(
          Object.prototype.hasOwnProperty.call(MESSAGE_TYPES, m[1]),
          `Unknown MESSAGE_TYPES.${m[1]} referenced in ${rel}`
        );
      }

      // Verify any hardcoded UPPER_SNAKE_CASE message type strings in type: '...' / case '...' / .type === '...'
      const litRe = /(?:\btype\s*:\s*|\bcase\s+|\.type\s*===?\s*)['"]([A-Z][A-Z0-9_]{2,})['"]/g;
      while ((m = litRe.exec(src)) !== null) {
        assert.ok(
          validValues.has(m[1]),
          `Unknown message type string "${m[1]}" in ${rel}`
        );
      }
    }

    // Verify service-worker.js references/handles all SW-bound message types
    const swSrc = fs.readFileSync(path.join(ROOT, 'src/background/service-worker.js'), 'utf8');
    const swHandled = [
      'GET_SETTINGS',
      'UPDATE_SETTINGS',
      'SET_SITE_RULE',
      'DELETE_SITE_RULE',
      'TOGGLE_GLOBAL',
      'TOGGLE_SITE',
      'GET_CUSTOM_CSS',
      'SET_CUSTOM_CSS',
      'GET_ALL_CUSTOM_CSS',
      'INJECT_CSS_FILES',
      'REMOVE_CSS_FILES',
      'REPORT_TAB_STATE',
      'RESET_SETTINGS',
    ];
    for (const t of swHandled) {
      assert.ok(swSrc.includes(t), `service-worker.js must handle message type ${t}`);
    }

    // Verify content.js handles content-bound message types
    const contentSrc = fs.readFileSync(path.join(ROOT, 'src/content/content.js'), 'utf8');
    for (const t of ['SETTINGS_UPDATED', 'GET_TAB_STATUS', 'SHOW_TOAST']) {
      assert.ok(contentSrc.includes(t), `content.js must handle message type ${t}`);
    }
  });
});
