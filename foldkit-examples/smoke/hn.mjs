import { chromium } from 'playwright-core'

const base = process.argv[2]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
const logs = []
const requests = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text().slice(0, 200)) })
page.on('pageerror', e => logs.push('pageerror: ' + e.message))
page.on('request', r => { const u = r.url(); if (u.includes('hnapi') || u.includes('firebaseio') || u.includes('story-3018')) requests.push(u.replace(/^https?:\/\/[^/]+/, '')) })
const out = {}
process.on('exit', () => console.log(JSON.stringify(out, null, 1)))
const t0 = Date.now()
await page.goto(base + '/')
out.initialLoading = await page.locator('.news-list-nav', { hasText: 'Loading...' }).count()
await page.waitForSelector('.news-item', { timeout: 20000 })
out.firstPaintMs = Date.now() - t0
out.items = await page.locator('.news-item').count()
out.nav = await page.textContent('.news-list-nav')
out.firstItem = (await page.textContent('.news-item')).replace(/\s+/g, ' ').slice(0, 140)

// hover "more >" -> preload page 2, then click
requests.length = 0
await page.hover('a[aria-label="Next Page"]')
await page.waitForTimeout(1500)
out.requestsAfterHover = [...requests]
await page.click('a[aria-label="Next Page"]')
await page.waitForTimeout(50)
out.afterClickUrl = page.url().replace(base, '')
out.afterClickNav = await page.textContent('.news-list-nav')

// navigate to a feed that was not preloaded: the old page must stay up
requests.length = 0
await page.evaluate(() => document.querySelector('a[href="/show"]').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
await page.waitForTimeout(30)
out.duringNavigation = { url: page.url().replace(base, ''), nav: await page.textContent('.news-list-nav'), loadingShown: await page.locator('.news-list-nav', { hasText: 'Loading...' }).count() }
await page.waitForFunction(() => document.querySelector('.news-list-nav span:nth-child(2)')?.textContent === 'page 1', null, { timeout: 20000 })
out.showFirst = (await page.textContent('.news-item .title')).slice(0, 80)

// open a story with comments
const commentsLink = page.locator('.news-item .meta a', { hasText: 'comments' }).first()
const storyHref = await commentsLink.getAttribute('href')
await commentsLink.hover()
await page.waitForTimeout(800)
await commentsLink.click()
await page.waitForSelector('.item-view', { timeout: 20000 })
out.story = { href: storyHref, title: await page.textContent('.item-view h1'), header: await page.textContent('.item-view-comments-header'), topLevel: await page.locator('.item-view-comments > ul > li.comment').count() }
const toggles = page.locator('details.toggle > summary')
out.togglesCount = await toggles.count()
if (out.togglesCount > 0) {
  await toggles.first().click()
  await page.waitForTimeout(50)
  out.afterCollapse = await page.evaluate(() => document.querySelector('details.toggle').open)
  await toggles.first().click()
  await page.waitForTimeout(50)
  out.afterExpand = await page.evaluate(() => document.querySelector('details.toggle').open)
}

// user page from the story header
const userLink = page.locator('.item-view .meta a').first()
const userName = await userLink.textContent()
await userLink.click()
await page.waitForSelector('.user-view', { timeout: 20000 })
out.user = (await page.textContent('.user-view')).replace(/\s+/g, ' ').slice(0, 160)
out.userRequested = requests.some(r => r.includes('/user/' + userName))

// back button returns to the story without a refetch
requests.length = 0
await page.goBack()
await page.waitForSelector('.item-view', { timeout: 20000 })
out.backUrl = page.url().replace(base, '')
out.refetchOnBack = [...requests]

// the captured 1,406-comment thread
const t1 = Date.now()
await page.goto(base + '/stories/30186326')
await page.waitForSelector('.item-view-comments li.comment', { timeout: 30000 })
out.bigThread = { ms: Date.now() - t1, header: await page.textContent('.item-view-comments-header'), renderedComments: await page.locator('li.comment').count() }
const t2 = Date.now()
await page.locator('details.toggle > summary').first().click()
await page.waitForFunction(() => !document.querySelector('details.toggle').open)
out.bigThreadToggleMs = Date.now() - t2
out.logs = logs.slice(0, 8)
await browser.close()
