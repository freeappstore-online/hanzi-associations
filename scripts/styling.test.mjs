import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('../web/src/index.css', import.meta.url), 'utf8');
const assets = new URL('../web/dist/assets/', import.meta.url);
const built = readdirSync(assets).filter(name => name.endsWith('.css'))
  .map(name => readFileSync(new URL(name, assets), 'utf8')).join('\n');

test('Tailwind compiles app tokens and SDK-only menu utilities', () => {
  // The app never uses these drawer classes: losing @source must fail this test.
  for (const selector of [['bg', 'panel'], ['text', 'ink'], ['bg', 'popover'], ['w', '72']].map(parts => '.' + parts.join('-') + '{')) {
    assert.ok(built.includes(selector), 'Missing compiled utility: ' + selector);
  }
  assert.ok(built.includes('animation:var(--animate-' + 'sdk-drawer)'));
  assert.match(built, /background-color:var\(--panel\)/);
  assert.match(built, /background-color:var\(--popover\)/);
});

test('elevated and floating surfaces remain opaque in both themes', () => {
  const light = source.match(/:root\s*\{([^}]+)\}/)[1];
  const dark = source.match(/:root\[data-theme='dark'\]\s*\{([^}]+)\}/)[1];
  for (const theme of [light, dark]) {
    for (const token of ['paper', 'panel']) {
      assert.match(theme, new RegExp('--' + token + ':\\s*#[0-9a-f]{6};', 'i'));
    }
    assert.match(theme, /--panel-glass:\s*rgba\(/);
  }
  assert.match(light, /--popover:\s*var\(--paper\);/);
  assert.doesNotMatch(dark, /--popover:/); // Inherits the live --paper alias.
});
