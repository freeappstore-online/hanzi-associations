import { test, expect, type Page } from '@playwright/test'
import { navigate } from './helpers'
async function speechMock(page: Page, mode = 'normal') {
  await page.addInitScript(mode => {
    const state = { spoken: [] as {text: string; voice: string}[], cancels: 0, ready: mode !== 'delayed', current: null as any }
    ;(window as any).speechTest = state
    const synth = new EventTarget()
    Object.assign(synth, {
      getVoices: () => state.ready && mode !== 'missing' ? [{ lang: 'zh-CN', name: 'Remote', localService: false }, { lang: 'zh-HK', name: 'Cantonese', localService: true }, { lang: 'zh-TW', name: 'Local Mandarin', localService: true }] : [],
      speak: (u: any) => { state.current = u; state.spoken.push({ text: u.text, voice: u.voice.name }); u.onstart?.(); if (mode === 'error') u.onerror?.() },
      cancel: () => { state.cancels++; state.current?.onerror?.({ error: 'canceled' }) },
    })
    Object.defineProperty(window, 'speechSynthesis', { value: mode === 'unsupported' ? undefined : synth, configurable: true })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { value: class { text: string; constructor(text: string) { this.text = text } }, configurable: true })
  }, mode)
}
test('word taps speak Chinese with local Mandarin, cancel on navigation and editor close', async ({ page }) => {
  await speechMock(page)
  const calls: string[] = []
  await page.route('https://mcp.proagentstore.online/**', route => { calls.push(route.request().url()); return route.abort() })
  await page.goto('/lookup')
  await page.getByRole('button', { name: 'Pronounce 椅子', exact: true }).click()
  await page.getByRole('button', { name: 'Pronounce yǐ zi', exact: true }).click()
  expect(await page.evaluate(() => (window as any).speechTest.spoken)).toEqual([{ text: '椅子', voice: 'Local Mandarin' }, { text: '椅子', voice: 'Local Mandarin' }])
  await navigate(page, 'Association library')
  expect(await page.evaluate(() => (window as any).speechTest.cancels)).toBe(2)
  await page.getByRole('button', { name: 'Copy to local drafts' }).first().click()
  await page.getByRole('dialog').locator('.word-hanzi').click()
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  expect(await page.evaluate(() => (window as any).speechTest.cancels)).toBe(3)
  expect(calls).toEqual([])
})
for (const mode of ['delayed', 'missing', 'unsupported', 'error']) test(`speech ${mode}`, async ({ page }) => {
  await speechMock(page, mode)
  await page.goto('/lookup')
  await page.getByRole('button', { name: 'Pronounce 椅子', exact: true }).click()
  if (mode === 'delayed') {
    await page.evaluate(() => { (window as any).speechTest.ready = true; speechSynthesis.dispatchEvent(new Event('voiceschanged')) })
    await expect.poll(() => page.evaluate(() => (window as any).speechTest.spoken.length)).toBe(1)
  } else await expect(page.getByRole('alert')).toContainText(mode === 'missing' ? 'No Mandarin voice' : mode === 'unsupported' ? 'unavailable in this browser' : 'could not play')
})
test('independent sizes persist, reset, and max sizes wrap at 320px across screens', async ({ page }, info) => {
  await speechMock(page)
  await page.goto('/profile')
  const settings = page.getByLabel('Reading preview')
  await expect(settings.locator('.word-hanzi')).toHaveCSS('font-size', '40px')
  for (const label of ['Hanzi', 'Pinyin', 'Translation']) { await page.getByRole('slider', { name: `${label} size` }).focus(); await page.keyboard.press('End') }
  await expect(settings.locator('.word-hanzi')).toHaveCSS('font-size', '72px')
  await expect(settings.locator('.word-pinyin')).toHaveCSS('font-size', '40px')
  await expect(settings.locator('.word-translation')).toHaveCSS('font-size', '36px')
  await page.reload()
  await expect(settings.locator('.word-hanzi')).toHaveCSS('font-size', '72px')
  await page.setViewportSize({ width: 320, height: 740 })
  for (const path of ['/profile', '/', '/lookup']) {
    await page.goto(path)
    await expect(page.locator('.word').first()).toBeVisible()
    await expect(page.locator('.word-hanzi').first()).toHaveCSS('font-size', '72px')
    expect(await page.evaluate(() => [...document.querySelectorAll('.word, .word > *, .word button')].every(e => e.scrollWidth <= e.clientWidth + 1))).toBeTruthy()
    await page.screenshot({ path: `artifacts/issue5-${info.project.name}-${path.replaceAll('/', '') || 'library'}-320.png`, fullPage: true })
  }
  await page.getByRole('button', { name: 'chair', exact: true }).click()
  const results = page.getByRole('region', { name: 'Dictionary results' })
  await expect(results.locator('.word-hanzi').first()).toHaveCSS('font-size', '72px')
  expect(await results.locator('button button').count()).toBe(0)
  expect(await results.evaluate(e => e.scrollWidth <= e.clientWidth)).toBeTruthy()
  await page.screenshot({ path: `artifacts/issue5-${info.project.name}-results-320.png`, fullPage: true })
  await results.getByRole('button', { name: /Create association 椅子/ }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.getByRole('dialog').evaluate(e => e.scrollWidth <= e.clientWidth)).toBeTruthy()
  await page.screenshot({ path: `artifacts/issue5-${info.project.name}-editor-320.png`, fullPage: true })
  await page.getByRole('button', { name: 'Save draft', exact: true }).click()
  await page.goto('/profile')
  await page.getByRole('button', { name: 'Reset reading sizes' }).click()
  await expect(settings.locator('.word-hanzi')).toHaveCSS('font-size', '40px')
})
test('reading preference storage failure is visible while preview updates', async ({ page }) => {
  await page.addInitScript(() => { const set = Storage.prototype.setItem; Storage.prototype.setItem = function(k, v) { if (k === 'yi.reading.v1') throw Error('quota'); return set.call(this, k, v) } })
  await page.goto('/profile')
  await page.getByRole('slider', { name: 'Pinyin size' }).focus(); await page.keyboard.press('End')
  await expect(page.getByRole('alert')).toContainText('could not be saved')
  await expect(page.getByLabel('Reading preview').locator('.word-pinyin')).toHaveCSS('font-size', '40px')
})
