'use strict';

(function initEarlyInject(global) {
  const DarkExt = (global.DarkExt = global.DarkExt || {});

  const SHIELD_STYLE_ID = 'darkext-early-shield';
  const SHIELD_STORAGE_KEY = '__darkext_shield';
  const SHIELD_BG_KEY = '__darkext_shield_bg';
  const DEFAULT_SHIELD_BG = '#121418';
  const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

  let fallbackTimer = null;

  function removeEarlyShield() {
    if (fallbackTimer !== null) {
      clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
    if (typeof document === 'undefined') {
      return;
    }
    const existing = document.getElementById(SHIELD_STYLE_ID);
    if (existing && existing.parentNode) {
      existing.parentNode.removeChild(existing);
    }
  }

  function injectEarlyShield() {
    if (typeof document === 'undefined') {
      return false;
    }

    let shieldFlag = null;
    let shieldBg = DEFAULT_SHIELD_BG;

    try {
      if (typeof sessionStorage !== 'undefined' && sessionStorage) {
        shieldFlag = sessionStorage.getItem(SHIELD_STORAGE_KEY);
        const savedBg = sessionStorage.getItem(SHIELD_BG_KEY);
        if (savedBg && HEX_COLOR_RE.test(savedBg)) {
          shieldBg = savedBg;
        }
      }
    } catch (_) {
      return false;
    }

    if (shieldFlag !== '1') {
      return false;
    }

    if (document.getElementById(SHIELD_STYLE_ID)) {
      return true;
    }

    const parent = document.head || document.documentElement;
    if (!parent) {
      return false;
    }

    const styleEl = document.createElement('style');
    styleEl.id = SHIELD_STYLE_ID;
    styleEl.textContent = [
      'html, body {',
      `  background-color: ${shieldBg} !important;`,
      '  color: #f4f6fa !important;',
      '  color-scheme: dark !important;',
      '}'
    ].join('\n');

    parent.appendChild(styleEl);

    // Failsafe auto-removal if content initialization is delayed or aborted
    if (typeof setTimeout === 'function') {
      if (fallbackTimer !== null) {
        clearTimeout(fallbackTimer);
      }
      fallbackTimer = setTimeout(removeEarlyShield, 3000);
    }

    return true;
  }

  DarkExt.removeEarlyShield = removeEarlyShield;
  DarkExt.injectEarlyShield = injectEarlyShield;

  // Run synchronously at document_start to eliminate white FOUC on navigation
  injectEarlyShield();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      removeEarlyShield,
      injectEarlyShield
    };
  }
})(globalThis);
