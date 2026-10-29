const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { setImmediate } = require('node:timers/promises');
const { test } = require('node:test');
const { runInNewContext } = require('node:vm');

const source = readFileSync(`${__dirname}/../slack-auto-dark-mode.user.js`, 'utf8');

// Model only the Slack controls used by the script, including the observed badge
// and the notification dialog that stays mounted after Preferences closes.
async function slack({ rerenderOnClose = false, missingAppearance = false, stuckDialog = false } = {}) {
  const state = { mode: 'light', menu: false, prefs: false, appearance: false, hidden: false, closes: 0 };
  const warnings = [];
  let clock = 0;
  const media = {
    matches: true,
    addEventListener(event, listener) {
      assert.equal(event, 'change');
      this.change = listener;
    },
  };
  const close = {
    click() {
      state.closes++;
      if (stuckDialog) return;
      state.prefs = false;
      if (rerenderOnClose && state.closes === 1) {
        queueMicrotask(() => { state.prefs = true; });
      }
    },
  };
  const prefs = {
    querySelector(selector) {
      return selector === 'button[data-qa="sk_close_modal_button"]' ? close : null;
    },
  };
  const appearance = { textContent: 'AppearanceNew', click() { state.appearance = true; } };
  const menu = {
    querySelectorAll() {
      return [{
        textContent: 'Preferences',
        click() { state.menu = false; state.prefs = true; state.appearance = false; },
      }];
    },
  };
  const document = {
    body: {},
    head: { appendChild() { state.hidden = true; } },
    hidden: false,
    addEventListener() {},
    dispatchEvent() {},
    createElement() { return { remove() { state.hidden = false; } }; },
    querySelectorAll() { return state.prefs ? [appearance] : []; },
    querySelector(selector) {
      switch (selector) {
        case 'button[data-qa="user-button"]':
          return { click() { state.menu = true; } };
        case '[role="menu"]': return state.menu ? menu : null;
        case '.p-prefs_dialog': return state.prefs ? prefs : null;
        case '.p-prefs_dialog button[data-qa="tabs_item"]#themes':
          return state.prefs && !missingAppearance ? appearance : null;
        case 'button[data-qa="sk_close_modal_button"]': return state.prefs ? close : null;
        case '[role="dialog"]': return { notificationBanner: true };
        default: {
          const mode = /^input\[name="color-mode"\]\[value="(dark|light)"\]$/.exec(selector)?.[1];
          assert.ok(mode, `unexpected selector: ${selector}`);
          return state.prefs && state.appearance ? { click() { state.mode = mode; } } : null;
        }
      }
    },
  };
  const window = { matchMedia: () => media, addEventListener() {} };
  runInNewContext(source, {
    window,
    document,
    localStorage: {
      getItem() {
        return JSON.stringify({ lastActiveTeamId: 'team', teams: { team: { iaTheming: { mode: state.mode } } } });
      },
    },
    console: { log() {}, warn: (...args) => warnings.push(args.join(' ')) },
    Date: { now: () => clock },
    setTimeout(callback, delay) { clock += delay; queueMicrotask(callback); },
    KeyboardEvent: class {},
  });
  await setImmediate();
  return {
    state,
    warnings,
    async systemDark(dark) {
      media.matches = dark;
      media.change();
      await setImmediate();
    },
  };
}

test('the Appearance New badge and unrelated mounted dialog do not block boot sync', async () => {
  const { state, warnings } = await slack();
  assert.equal(state.mode, 'dark');
  assert.equal(state.prefs, false);
  assert.equal(state.hidden, false);
  assert.deepEqual(warnings, []);
});

test('system changes sync both directions and release the busy flag', async () => {
  const app = await slack();
  for (const dark of [false, true, false, true]) {
    await app.systemDark(dark);
    assert.equal(app.state.mode, dark ? 'dark' : 'light');
    assert.equal(app.state.prefs, false);
    assert.equal(app.state.hidden, false);
  }
  assert.deepEqual(app.warnings, []);
});

test('Preferences is closed again if a theme save re-renders it', async () => {
  const { state, warnings } = await slack({ rerenderOnClose: true });
  assert.equal(state.mode, 'dark');
  assert.equal(state.closes, 2);
  assert.equal(state.prefs, false);
  assert.equal(state.hidden, false);
  assert.deepEqual(warnings, []);
});

test('a missing Appearance tab logs the failure and restores the UI', async () => {
  const { state, warnings } = await slack({ missingAppearance: true });
  assert.equal(state.mode, 'light');
  assert.equal(state.prefs, false);
  assert.equal(state.hidden, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /toggle failed: timeout waiting for Appearance tab/);
});

test('a stuck Preferences dialog times out visibly without leaving the UI hidden', async () => {
  const { state, warnings } = await slack({ stuckDialog: true });
  assert.equal(state.mode, 'dark');
  assert.equal(state.prefs, true);
  assert.equal(state.hidden, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /prefs dialog still open/);
});
