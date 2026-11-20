'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'manifest.json');
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readManifest() {
  assert.ok(fs.existsSync(MANIFEST_PATH), 'manifest.json must exist at project root');
  const raw = fs.readFileSync(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw);
}

function resolveResourcePattern(pattern) {
  if (!pattern.includes('*')) {
    const abs = path.join(ROOT, pattern);
    return fs.existsSync(abs) ? [abs] : [];
  }
  const dirPart = path.dirname(pattern);
  const filePattern = path.basename(pattern);
  assert.ok(!dirPart.includes('*'), `Unsupported directory wildcard in resource pattern: ${pattern}`);
  const absDir = path.join(ROOT, dirPart);
  if (!fs.existsSync(absDir)) return [];
  const escaped = filePattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}$`);
  return fs
    .readdirSync(absDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && re.test(entry.name))
    .map((entry) => path.join(absDir, entry.name));
}

function assertValidPng(filePath, expectedSize) {
  assert.ok(fs.existsSync(filePath), `Icon file does not exist: ${path.relative(ROOT, filePath)}`);
  const buf = fs.readFileSync(filePath);
  assert.ok(buf.length >= 24, `PNG file too small (${buf.length} bytes): ${filePath}`);
  assert.deepEqual(
    buf.subarray(0, 8),
    PNG_MAGIC,
    `Invalid PNG magic bytes in ${path.relative(ROOT, filePath)}`
  );
  const chunkType = buf.subarray(12, 16).toString('ascii');
  assert.equal(chunkType, 'IHDR', `First PNG chunk must be IHDR in ${path.relative(ROOT, filePath)}`);
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  assert.equal(
    width,
    expectedSize,
    `Expected width ${expectedSize}px for ${path.relative(ROOT, filePath)}, got ${width}px`
  );
  assert.equal(
    height,
    expectedSize,
    `Expected height ${expectedSize}px for ${path.relative(ROOT, filePath)}, got ${height}px`
  );
}

describe('Manifest V3 Compliance & Assets', () => {
  it('manifest.json parses cleanly and specifies Manifest V3 with no V2 keys', () => {
    const manifest = readManifest();
    assert.equal(manifest.manifest_version, 3);
    assert.equal(manifest.name, 'DarkExtension');
    assert.equal(typeof manifest.version, 'string');
    assert.ok(manifest.version.length > 0);

    // Forbidden V2 keys
    assert.equal('browser_action' in manifest, false, 'MV2 key browser_action must not exist');
    assert.equal('page_action' in manifest, false, 'MV2 key page_action must not exist');
    assert.equal('app' in manifest, false, 'MV2 key app must not exist');
    assert.ok(manifest.background && typeof manifest.background === 'object');
    assert.equal(manifest.background.scripts, undefined, 'MV2 background.scripts must not exist');
    assert.equal(manifest.background.page, undefined, 'MV2 background.page must not exist');
    assert.equal(manifest.background.persistent, undefined, 'MV2 background.persistent must not exist');
    assert.equal(typeof manifest.background.service_worker, 'string');

    if ('content_security_policy' in manifest) {
      assert.equal(
        typeof manifest.content_security_policy,
        'object',
        'MV3 content_security_policy must be an object, not a string'
      );
    }

    assert.ok(Array.isArray(manifest.web_accessible_resources));
    for (const entry of manifest.web_accessible_resources) {
      assert.equal(
        typeof entry,
        'object',
        'MV3 web_accessible_resources items must be objects, not MV2 strings'
      );
      assert.ok(entry !== null && Array.isArray(entry.resources) && Array.isArray(entry.matches));
    }
  });

  it('declares all required permissions, host_permissions, and keyboard commands', () => {
    const manifest = readManifest();
    const requiredPerms = ['storage', 'tabs', 'scripting', 'contextMenus', 'alarms', 'sidePanel'];
    assert.ok(Array.isArray(manifest.permissions));
    for (const perm of requiredPerms) {
      assert.ok(manifest.permissions.includes(perm), `Missing required permission: ${perm}`);
    }

    assert.ok(Array.isArray(manifest.host_permissions));
    assert.ok(manifest.host_permissions.includes('http://*/*'), 'Missing http://*/* host_permission');
    assert.ok(manifest.host_permissions.includes('https://*/*'), 'Missing https://*/* host_permission');

    assert.ok(manifest.commands && typeof manifest.commands === 'object');
    assert.ok(manifest.commands['toggle-site'], 'Missing command toggle-site');
    assert.ok(manifest.commands['toggle-global'], 'Missing command toggle-global');
  });

  it('every icon in manifest.icons and action.default_icon is a valid PNG matching declared dimensions', () => {
    const manifest = readManifest();
    const requiredSizes = ['16', '32', '48', '128'];

    assert.ok(manifest.icons && typeof manifest.icons === 'object', 'Missing manifest.icons');
    assert.ok(
      manifest.action && manifest.action.default_icon && typeof manifest.action.default_icon === 'object',
      'Missing manifest.action.default_icon'
    );

    for (const sizeKey of requiredSizes) {
      assert.ok(manifest.icons[sizeKey], `Missing manifest.icons["${sizeKey}"]`);
      assert.ok(manifest.action.default_icon[sizeKey], `Missing action.default_icon["${sizeKey}"]`);
    }

    for (const [sizeKey, relPath] of Object.entries(manifest.icons)) {
      const expectedPx = Number(sizeKey);
      assert.ok(Number.isInteger(expectedPx) && expectedPx > 0);
      assertValidPng(path.join(ROOT, relPath), expectedPx);
    }

    for (const [sizeKey, relPath] of Object.entries(manifest.action.default_icon)) {
      const expectedPx = Number(sizeKey);
      assert.ok(Number.isInteger(expectedPx) && expectedPx > 0);
      assertValidPng(path.join(ROOT, relPath), expectedPx);
    }
  });

  it('every JS, HTML, and web_accessible_resources file referenced in manifest.json exists on disk', () => {
    const manifest = readManifest();

    const swPath = path.join(ROOT, manifest.background.service_worker);
    assert.ok(fs.existsSync(swPath), `Missing service_worker: ${manifest.background.service_worker}`);

    const popupPath = path.join(ROOT, manifest.action.default_popup);
    assert.ok(fs.existsSync(popupPath), `Missing default_popup: ${manifest.action.default_popup}`);

    const optionsRel = manifest.options_page || manifest.options_ui?.page;
    assert.ok(typeof optionsRel === 'string' && optionsRel.length > 0, 'Missing options_page');
    assert.ok(fs.existsSync(path.join(ROOT, optionsRel)), `Missing options_page: ${optionsRel}`);

    assert.ok(
      manifest.side_panel && typeof manifest.side_panel.default_path === 'string' && manifest.side_panel.default_path.length > 0,
      'Missing side_panel.default_path'
    );
    assert.ok(
      fs.existsSync(path.join(ROOT, manifest.side_panel.default_path)),
      `Missing side_panel.default_path: ${manifest.side_panel.default_path}`
    );

    assert.ok(Array.isArray(manifest.content_scripts) && manifest.content_scripts.length >= 1);
    const primaryCs = manifest.content_scripts[0];
    assert.equal(primaryCs.run_at, 'document_start');
    assert.ok(primaryCs.matches.includes('http://*/*'));
    assert.ok(primaryCs.matches.includes('https://*/*'));

    for (const cs of manifest.content_scripts) {
      for (const jsFile of cs.js || []) {
        assert.ok(fs.existsSync(path.join(ROOT, jsFile)), `Missing content_script js: ${jsFile}`);
      }
      for (const cssFile of cs.css || []) {
        assert.ok(fs.existsSync(path.join(ROOT, cssFile)), `Missing content_script css: ${cssFile}`);
      }
    }

    for (const entry of manifest.web_accessible_resources) {
      for (const resPattern of entry.resources) {
        const matched = resolveResourcePattern(resPattern);
        assert.ok(matched.length > 0, `web_accessible_resources pattern matched no files: ${resPattern}`);
      }
    }
  });
});
