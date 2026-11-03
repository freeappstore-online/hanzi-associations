import { test, expect, type Page } from '@playwright/test'
import { mockPags, navigate } from './helpers'
import { response } from '../pags-fixture'
import { failedSnapshot } from '../timeline-fixture'

async function fasAccount(page: Page) {
  await page.addInitScript(() => {
    if (!localStorage.getItem('fas-test-initialized')) {
      localStorage.setItem('fas-test-initialized', 'yes')
      localStorage.setItem('fas:session', JSON.stringify({ token: 'synthetic-fas-token', user: { id: 'synthetic-fas-owner', login: 'FAS Test User', provider: 'github' } }))
    }
  })
  await page.route('https://api.freeappstore.online/**', route => route.fulfill({ json: { friends: [], incoming: [], outgoing: [], roles: ['member'] } }))
}

test('signed-out Profile consolidates connections; About contains only story and credits', async ({ page }, info) => {
  const calls: string[] = []
  await page.route('https://mcp.proagentstore.online/**', route => { calls.push(route.request().url()); return route.abort() })
  await page.goto('/')
  await navigate(page, 'Profile')
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in to FreeAppStore' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect PAGS', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'GitHub publishing connection' })).toBeVisible()
  await expect(page.getByRole('link', { name: /PAGS settings/ })).toHaveAttribute('href', 'https://proagentstore.online/console/preferences')
  await expect(page.getByText(/does not check that connection’s live status/)).toBeVisible()
  await expect(page.getByText(/cannot repair that machine’s access/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Export drafts' })).toBeVisible()
  await expect(page.locator('header')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: `artifacts/${info.project.name}-profile-signed-out.png`, fullPage: true })
  await navigate(page, 'About')
  await expect(page.getByText('CC BY-SA 4.0', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Connect PAGS/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Recent activity on this device' })).toHaveCount(0)
  expect(calls).toEqual([])
  await page.goto('/connection')
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
})

test('SDK avatar opens Profile; account controls remain and sign-outs are independent', async ({ page }, info) => {
  await fasAccount(page)
  const mock = await mockPags(page, { pending: true })
  await page.goto('/')
  // This is the real SDK avatar link, not the navigation item or a DOM patch.
  await page.locator('header a[aria-label="Profile"]').click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('fas-identity')).toContainText('FAS Test User')
  await expect(page.getByTestId('owner-identity')).toContainText('Test Owner · Google')
  await expect(page.getByRole('button', { name: 'Manage Friends' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Manage API Keys' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Delete account', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Light', exact: true }).click()
  await page.getByRole('button', { name: 'Large', exact: true }).click()
  await page.getByRole('button', { name: 'Default', exact: true }).click()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.getByRole('heading', { name: 'Profile', exact: true }).click()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `artifacts/${info.project.name}-profile-signed-in.png`, fullPage: true })
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click()
  await expect(page.getByTestId('owner-identity')).toHaveCount(0)
  await expect(page.getByTestId('fas-identity')).toBeVisible()
  await page.evaluate(() => sessionStorage.setItem('yi.oauth.session.v1', JSON.stringify({ accessToken: 'synthetic-reconnected', clientId: 'synthetic-client', expiresAt: Date.now() + 3600000 })))
  await page.reload()
  await expect(page.getByTestId('owner-identity')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out', exact: true }).click()
  await expect(page.getByTestId('fas-identity')).toHaveCount(0)
  await expect(page.getByTestId('owner-identity')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Recent activity on this device' })).toBeVisible()
  const state = await page.evaluate(() => ({ draft: !!localStorage.getItem('yi.drafts.v1'), pending: !!localStorage.getItem('yi.publish.pending.v1'), pags: !!sessionStorage.getItem('yi.oauth.session.v1') }))
  expect(state).toEqual({ draft: true, pending: true, pags: true })
  expect(mock.calls).not.toContain('coding_session_message')
  await expect(page.locator('body')).not.toContainText('synthetic-fas-token')
  await expect(page.locator('body')).not.toContainText('synthetic-oauth-token')
})

test('legacy advanced cursor recovers timestamped failure through real Profile navigation and reload', async ({ page }) => {
  const mock = await mockPags(page, { yellow: true })
  mock.setHandler((name, args) => {
    if (name === 'coding_timeline') {
      expect(args).not.toHaveProperty('since_seq')
      return { ...response(name) as object, nextSeq: 63729, hasMore: true, oldestSeq: 63719, events: [failedSnapshot] }
    }
    if (name === 'coding_session_capture') return { ...response(name) as object, runState: 'thinking' }
    return response(name)
  })
  await page.goto('/')
  await navigate(page, 'Profile')
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible()
  await expect(page.locator('body')).not.toContainText('push=false')
  await page.reload()
  await expect(page.getByText('Failed', { exact: true }).first()).toBeVisible()
  await navigate(page, 'Association library')
  await page.getByRole('button', { name: 'Local drafts', exact: true }).click()
  await expect(page.getByTestId('draft-progress')).toContainText('Failed')
  expect(mock.calls).not.toContain('coding_session_message')
})

test('PAGS connect from Profile retains registered /connection callback and returns verified there', async ({ page }) => {
  const mock = await mockPags(page, { expired: true })
  const issuer = 'https://mcp.proagentstore.online'
  await page.route(`${issuer}/.well-known/oauth-authorization-server`, route => route.fulfill({ json: { issuer, authorization_endpoint: `${issuer}/authorize`, token_endpoint: `${issuer}/token`, registration_endpoint: `${issuer}/register`, code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] } }))
  await page.route(`${issuer}/register`, async route => {
    expect(route.request().postDataJSON().redirect_uris).toEqual(['http://127.0.0.1:4173/connection'])
    await route.fulfill({ json: { client_id: 'synthetic-client', token_endpoint_auth_method: 'none' } })
  })
  await page.route(`${issuer}/authorize?*`, async route => {
    const url = new URL(route.request().url())
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:4173/connection')
    await route.fulfill({ status: 302, headers: { location: `http://127.0.0.1:4173/connection?code=synthetic-code&state=${url.searchParams.get('state')}` } })
  })
  await page.route(`${issuer}/token`, async route => {
    expect(new URLSearchParams(route.request().postData()!).get('redirect_uri')).toBe('http://127.0.0.1:4173/connection')
    await route.fulfill({ json: { access_token: 'synthetic-callback-token', token_type: 'Bearer', expires_in: 3600, scope: 'read runtime' } })
  })
  await page.goto('/')
  await navigate(page, 'Profile')
  await page.getByRole('button', { name: 'Connect PAGS', exact: true }).click()
  await expect(page).toHaveURL(/\/connection$/)
  await expect(page.getByRole('heading', { name: 'Profile', exact: true })).toBeVisible()
  await expect(page.getByTestId('owner-identity')).toBeVisible()
  await navigate(page, 'About'); await navigate(page, 'Profile')
  await expect(page.getByTestId('owner-identity')).toBeVisible()
  expect(mock.calls).not.toContain('coding_session_message')
})
