import { chromium } from 'playwright-core'

const url = process.argv[2]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
const logs = []
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.type() + ': ' + m.text()) })
page.on('pageerror', e => logs.push('pageerror: ' + e.message))

await page.goto(url)
await page.evaluate(() => localStorage.removeItem('TODOS'))
await page.reload()
const sawLoading = await page.locator('p.loading').count()
await page.waitForSelector('section.todoapp header.header input.new-todo')
await page.waitForFunction(() => !document.querySelector('p.loading'), null, { timeout: 5000 })
const out = { sawLoading }

const input = page.locator('input.new-todo')
for (const title of ['Buy milk', 'Walk dog', 'Write port']) {
  await input.fill(title)
  await input.press('Enter')
}
await page.waitForTimeout(100)
out.afterAdd = await page.$$eval('ul.todo-list li', lis => lis.map(li => li.className + ' | ' + li.querySelector('label').textContent))
out.inputCleared = (await input.inputValue()) === ''
await page.waitForTimeout(1500)
out.settled = await page.$$eval('ul.todo-list li', lis => lis.map(li => li.className + ' | ' + li.querySelector('label').textContent + ' | retry=' + (li.querySelector('button.retry')?.title ?? '-')))
out.count = await page.textContent('.todo-count')

// retry any failed adds until all three are saved (33% failure rate)
for (let i = 0; i < 8; i++) {
  const retries = page.locator('button.retry')
  if (await retries.count() === 0) break
  await retries.first().click()
  await page.waitForTimeout(1000)
}
out.afterRetries = await page.$$eval('ul.todo-list li', lis => lis.map(li => li.className + ' | ' + li.querySelector('label').textContent))

await page.locator('input.toggle').first().check()
await page.waitForTimeout(50)
out.toggledOptimistic = await page.$eval('ul.todo-list li', li => li.className)
await page.waitForTimeout(1200)
out.toggledSettled = await page.$eval('ul.todo-list li', li => li.className + ' retry=' + (li.querySelector('button.retry')?.title ?? '-'))

await page.click('a[href="#/active"]')
await page.waitForTimeout(100)
out.activeHash = await page.evaluate(() => location.hash)
out.activeSelected = await page.textContent('a.selected')
out.activeItems = await page.$$eval('ul.todo-list li label', ls => ls.map(l => l.textContent))
await page.goBack()
await page.waitForTimeout(100)
out.backHash = await page.evaluate(() => location.hash)
out.backSelected = await page.textContent('a.selected')

await page.click('#toggle-all')
await page.waitForTimeout(50)
out.toggleAllOptimistic = await page.$$eval('ul.todo-list li', lis => lis.map(li => li.className))
await page.waitForTimeout(1200)
out.toggleAllSettled = await page.$$eval('ul.todo-list li', lis => lis.map(li => li.className + ' retry=' + (li.querySelector('button.retry')?.title ?? '-')))
out.persisted = await page.evaluate(() => localStorage.getItem('TODOS'))
out.devtools = await page.evaluate(() => document.querySelectorAll('[class*="foldkit"], foldkit-devtools, [id*="devtools"]').length)
out.logs = logs
console.log(JSON.stringify(out, null, 1))
await browser.close()
