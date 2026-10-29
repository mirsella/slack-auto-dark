// ==UserScript==
// @name         Slack Auto Dark Mode (Follow System)
// @namespace    https://github.com/mirsella/slack-auto-dark
// @version      2.1.1
// @description  Automatically toggle Slack web (app.slack.com) dark/light mode based on device system theme (prefers-color-scheme).
// @author       you
// @match        https://app.slack.com/*
// @updateURL    https://raw.githubusercontent.com/mirsella/slack-auto-dark/main/slack-auto-dark-mode.user.js
// @downloadURL  https://raw.githubusercontent.com/mirsella/slack-auto-dark/main/slack-auto-dark-mode.user.js
// @icon         https://www.google.com/s2/favicons?sz=64&domain=slack.com
// @run-at       document-idle
// @noframes
// @grant        none
// @license      MIT
// @compatible   Tampermonkey, Violentmonkey
// ==/UserScript==

(function () {
  'use strict';

  const LOG = '[slack-auto-dark]';
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  // Slack's server-side theme, mirrored in localConfig_v2 (verified live 2026-09-22).
  // The legacy slack-client-theme key and sk-client-theme--dark class no longer exist,
  // and direct localStorage edits are overwritten on boot, so drive the real UI.
  function mode() {
    try {
      const j = JSON.parse(localStorage.getItem('localConfig_v2') || 'null');
      if (!j) return null;
      const teams = j.teams || {};
      const tid = teams[j.lastActiveTeamId] ? j.lastActiveTeamId : Object.keys(teams)[0];
      return teams[tid]?.iaTheming?.mode ?? null; // 'light' | 'dark'
    } catch (e) {
      console.warn(LOG, 'read mode failed:', e);
      return null;
    }
  }

  async function waitFor(fn, desc, timeout = 8000) {
    const t0 = Date.now();
    for (;;) {
      const el = fn();
      if (el) return el;
      if (Date.now() - t0 > timeout) throw new Error('timeout waiting for ' + desc);
      await sleep(120);
    }
  }

  function findMenuItem(text) {
    const menu = document.querySelector('[role="menu"]');
    if (!menu) return null;
    const want = norm(text);
    return Array.from(menu.querySelectorAll('[role="menuitem"]')).find((e) => norm(e.textContent) === want) ||
      Array.from(menu.querySelectorAll('*')).find((e) => e.clientWidth > 0 && norm(e.textContent) === want) ||
      null;
  }

  function hide() {
    const style = document.createElement('style');
    style.textContent = '[role="dialog"],[role="menu"]{opacity:0 !important;pointer-events:none !important;}';
    document.head.appendChild(style);
    return () => style.remove();
  }

  let busy = false;

  async function apply(dark) {
    const want = dark ? 'dark' : 'light';
    if (busy || mode() === want) return;
    busy = true;
    const unhide = hide();
    console.log(LOG, 'switching to ' + want);
    try {
      (await waitFor(() => document.querySelector('button[data-qa="user-button"]'), 'user menu')).click();
      (await waitFor(() => findMenuItem('Preferences'), 'Preferences item')).click();
      // The label can include badges such as "New"; the tab ID stays unchanged.
      (await waitFor(() => document.querySelector('.p-prefs_dialog button[data-qa="tabs_item"]#themes'), 'Appearance tab')).click();
      (await waitFor(() => document.querySelector(`input[name="color-mode"][value="${want}"]`), want + ' radio')).click();
      await waitFor(() => (mode() === want ? document.body : null), 'theme save');
      console.log(LOG, 'now ' + mode());
    } catch (e) {
      console.warn(LOG, 'toggle failed:', e?.message || e);
    } finally {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await waitFor(() => {
        // Ignore other mounted dialogs, and retry if a theme save re-renders Preferences.
        const dialog = document.querySelector('.p-prefs_dialog');
        if (!dialog) return true;
        dialog.querySelector('button[data-qa="sk_close_modal_button"]')?.click();
        return false;
      }, 'dialog close', 3000)
        .catch(() => console.warn(LOG, 'prefs dialog still open'));
      unhide();
      busy = false;
    }
  }

  const sync = () => apply(mq.matches);

  (async () => {
    try {
      await waitFor(() => document.querySelector('button[data-qa="user-button"]'), 'slack boot', 60000);
      await waitFor(() => (mode() ? document.body : null), 'prefs hydrate', 15000);
      sync();
    } catch (e) {
      console.warn(LOG, 'boot sync skipped:', e?.message || e);
    }
  })();

  mq.addEventListener('change', sync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  window.addEventListener('focus', sync);

  window.__slackAutoDark = {
    get current() { return mode(); },
    get systemDark() { return mq.matches; },
    sync,
  };
})();
