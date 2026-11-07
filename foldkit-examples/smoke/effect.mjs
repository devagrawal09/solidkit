import { chromium } from 'playwright-core'

const url = process.argv[2]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
const logs = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()) })
page.on('pageerror', e => logs.push('pageerror: ' + e.message))
const logLines = () => page.$$eval('.log-panel li', lis => lis.map(li => li.className.replace('log-', '') + ' ' + li.querySelector('.log-msg').textContent))
const out = {}

await page.goto(url)
await page.waitForSelector('.app-header h1')
out.title = await page.title()
out.emptyLog = await page.textContent('.log-panel .empty')

const search = page.locator('input[type=search]')
await search.pressSequentially('solid', { delay: 40 })
await page.waitForTimeout(150)
out.whileTyping = await page.$$eval('.panel > p.loading, .panel .results', els => els.map(e => e.className))
await page.waitForFunction(() => document.querySelector('.panel .results:not(.stale)') || document.querySelector('.panel .error-box'), null, { timeout: 8000 })
out.searchOutcome = await page.$$eval('.panel .results li .pkg-name, .panel .error-box p', els => els.map(e => e.textContent))
out.logAfterSearch = (await logLines()).slice(0, 14)

// stale-while-revalidate: extend the query and look for the stale class right away
await search.press('End')
await search.type('-')
await page.waitForTimeout(30)
out.staleWhileRevalidating = await page.$$eval('.panel .results', els => els.map(e => e.className))
await page.waitForTimeout(6000)

await page.click('nav.tabs button:has-text("Checkout")')
out.ordersLoading = await page.locator('p.loading').count()
await page.waitForSelector('text=No orders yet.')

await page.click('.log-panel header button')
await page.click('button.primary')
await page.waitForTimeout(100)
out.inFlight = { cancel: await page.locator('button.danger').count(), active: await page.textContent('ol.steps li.active'), plusDisabled: await page.locator('.qty button').last().isDisabled() }
await page.waitForTimeout(1200)
out.chargingActive = await page.textContent('ol.steps li.active')
await page.click('button.danger')
await page.waitForSelector('p.notice', { timeout: 5000 })
out.cancelNotice = await page.textContent('p.notice')
out.cancelLog = (await logLines()).reverse()

await page.click('.log-panel header button')
await page.check('.decline-toggle input')
await page.click('button.primary')
await page.waitForSelector('p.notice.error', { timeout: 8000 })
out.declineNotice = await page.textContent('p.notice')
out.declineLog = (await logLines()).reverse()

await page.click('.log-panel header button')
await page.uncheck('.decline-toggle input')
await page.click('button.primary')
await page.waitForSelector('p.notice.success', { timeout: 8000 })
out.successNotice = await page.textContent('p.notice')
await page.waitForTimeout(600)
out.orders = await page.$$eval('ul.orders li', lis => lis.map(li => li.textContent))
out.successLog = (await logLines()).reverse()
out.logs = logs
console.log(JSON.stringify(out, null, 1))
await browser.close()
