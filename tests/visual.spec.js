import { test, expect } from '@playwright/test'

const headers = { 'access-control-allow-origin': '*' }

// Fill and submit the create-campaign modal (lands on the Campaign Page).
async function createCampaign(page, { name, theme, books = 3 }) {
  await page.getByRole('button', { name: 'Add campaign' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create campaign' })
  await dialog.getByLabel('Give your campaign a name.').fill(name)
  await dialog.getByLabel(/Theme\?/).fill(theme)
  await dialog.getByLabel('How many books should I create?').fill(String(books))
  await dialog.getByRole('button', { name: 'Create my campaign' }).click()
}

// Scroll lazy thumbnails into view and wait until every image has loaded.
async function waitForImages(page) {
  await page.locator('.cp-gallery').scrollIntoViewIfNeeded()
  for (const img of await page.locator('img').all()) {
    // Lazy thumbnails off-screen in the horizontal carousel load on scroll
    await img.scrollIntoViewIfNeeded()
    await expect(img).toHaveJSProperty('complete', true)
  }
  await page.locator('.cp-gallery__grid').evaluateAll((els) => els.forEach((el) => (el.scrollLeft = 0)))
  await page.evaluate(() => window.scrollTo(0, 0))
}

// Value of an `eq.` filter in a PostgREST URL.
const eqParam = (url, key) =>
  new URL(url).searchParams.get(key)?.replace('eq.', '')

// In-memory stand-in for the Supabase tables so visual tests never touch the
// real database (which would queue paid AI generation jobs).
// `db.campaignStatus` overrides the status of created campaigns.
async function mockApi(page, db) {
  const rows = []
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const req = route.request()
    db.requests.push({ action: new URL(req.url()).pathname.split('/').pop(), args: req.postDataJSON() })
    if (db.requestGate) await db.requestGate
    return route.fulfill({
      status: db.requestError ? 400 : 200,
      headers,
      json: db.requestError ? { message: db.requestError, code: 'P0001' } : 'mock-job-id',
    })
  })
  await page.route('**/rest/v1/campaigns**', async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      const row = {
        ...req.postDataJSON(),
        id: `test-${rows.length + 1}`,
        status: 'queued',
        created_at: new Date().toISOString(),
      }
      rows.push(row)
      return route.fulfill({ status: 201, headers, json: row })
    }
    if (req.method() === 'DELETE') {
      const id = eqParam(req.url(), 'id')
      rows.splice(rows.findIndex((r) => r.id === id), 1)
      return route.fulfill({ status: 204, headers })
    }
    // .single() lookup of one campaign's status
    if (req.headers()['accept']?.includes('vnd.pgrst.object')) {
      const row = rows.find((r) => r.id === eqParam(req.url(), 'id'))
      return route.fulfill({
        status: 200,
        headers,
        json: { ...row, status: db.campaignStatus || row.status },
      })
    }
    return route.fulfill({ status: 200, headers, json: rows })
  })

  // books / pages: GET by parent id, PATCH records the edit
  const table = (name, parentKey) =>
    page.route(`**/rest/v1/${name}**`, async (route) => {
      const req = route.request()
      if (req.method() === 'PATCH') {
        db.patches.push({ table: name, id: eqParam(req.url(), 'id'), ...req.postDataJSON() })
        return route.fulfill({ status: 204, headers })
      }
      const parent = eqParam(req.url(), parentKey)
      return route.fulfill({
        status: 200,
        headers,
        json: db[name].filter((r) => r[parentKey] === parent),
      })
    })
  await table('books', 'campaign_id')
  await table('pages', 'book_id')

  // Storage images (compressed thumbnails and full-res originals) ->
  // simple generated A4 SVG illustration, coloured by the object path
  const fakeImage = (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^.*\/public\//, '')
    const hue = [...path].reduce((h, c) => (h + c.charCodeAt(0) * 7) % 360, 0)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="424" viewBox="0 0 300 424">
      <rect width="300" height="424" fill="hsl(${hue},45%,82%)"/>
      <circle cx="150" cy="180" r="80" fill="hsl(${(hue + 120) % 360},40%,62%)"/>
      <rect x="40" y="300" width="220" height="60" rx="12" fill="hsl(${(hue + 240) % 360},35%,55%)"/>
    </svg>`
    return route.fulfill({ status: 200, headers, contentType: 'image/svg+xml', body: svg })
  }
  await page.route('**/storage/v1/render/image/**', fakeImage)
  await page.route('**/storage/v1/object/public/**', fakeImage)

  // Realtime: accept the socket but never push events
  await page.routeWebSocket(/realtime/, () => {})
}

// Fixture builders
const book = (n, extra = {}) => ({
  id: `book-${n}`,
  campaign_id: 'test-1',
  book_number: n,
  title: ['The Sleepy Fox', 'Owl Learns to Fly', 'Badger Bakes a Cake'][n - 1],
  description: [
    'A little fox looks for the coziest spot in the forest to nap.',
    'A young owl practices every night until she can soar.',
    'Badger and friends bake a surprise cake for the hedgehog.',
  ][n - 1],
  status: 'processing',
  cover_image_path: null,
  ...extra,
})

const pagesFor = (bookId, count, statusOf = () => 'queued', withImage = () => false) =>
  Array.from({ length: count }, (_, i) => ({
    id: `${bookId}-p${i + 1}`,
    book_id: bookId,
    page_number: i + 1,
    title: `Page ${i + 1} scene`,
    description: `Fox wanders past the ${['river', 'old oak', 'meadow', 'berry bush'][i % 4]} looking for a place to sleep.`,
    status: statusOf(i),
    image_path: withImage(i) ? `${bookId}/page-${i + 1}.png` : null,
  }))

let db
test.beforeEach(async ({ page }) => {
  db = { books: [], pages: [], patches: [], requests: [], campaignStatus: null }
  await mockApi(page, db)
  await page.goto('/')
})

test('home - empty', async ({ page }) => {
  await expect(page).toHaveScreenshot('home-empty.png', { fullPage: true })
})

test('create campaign modal', async ({ page }) => {
  await page.getByRole('button', { name: 'Add campaign' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page).toHaveScreenshot('create-modal.png', { fullPage: true })
})

test('home - with campaigns', async ({ page }) => {
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  await page.getByRole('button', { name: 'Back' }).click()
  await createCampaign(page, { name: 'Space Trucks', theme: 'big rockets', books: 5 })
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page).toHaveScreenshot('home-with-campaigns.png', { fullPage: true })
})

test('delete confirmation', async ({ page }) => {
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByRole('button', { name: 'Delete Forest Friends' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page).toHaveScreenshot('delete-confirm.png', { fullPage: true })
})

// No books yet: concepts are still being generated.
test('campaign page', async ({ page }) => {
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  await expect(page.getByText('Generating book concepts...')).toBeVisible()
  await expect(page).toHaveScreenshot('campaign-page.png', { fullPage: true })
})

test('campaign page - concepts failed', async ({ page }) => {
  db.campaignStatus = 'failed'
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  await expect(page.getByText('Could not generate book concepts.')).toBeVisible()
  await expect(page).toHaveScreenshot('campaign-page-concepts-failed.png', { fullPage: true })
})

// Books exist, pages are still being written.
test('campaign page - writing pages', async ({ page }) => {
  db.books = [book(1), book(2), book(3, { status: 'queued' })]
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  await expect(page.getByText('Writing pages...')).toBeVisible()
  await expect(page).toHaveScreenshot('campaign-page-writing-pages.png', { fullPage: true })
})

test('campaign page - book mode', async ({ page }) => {
  db.books = [book(1), book(2), book(3)]
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  await page.getByRole('button', { name: 'Switch to Book' }).click()
  await expect(page.getByPlaceholder('Book Title', { exact: true })).toHaveValue('The Sleepy Fox')
  await expect(page).toHaveScreenshot('campaign-page-book-mode.png', { fullPage: true })
})

// Pages written, some illustrations done, the rest generating.
test('campaign page - illustrations generating', async ({ page }) => {
  db.books = [book(1, { cover_image_path: 'book-1/cover.png' }), book(2), book(3)]
  db.pages = pagesFor(
    'book-1',
    12,
    (i) => (i < 3 ? 'succeeded' : i < 6 ? 'processing' : 'queued'),
    (i) => i < 3,
  )
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  await expect(page.getByRole('button', { name: 'Go to page 12' })).toBeVisible()
  await page.getByRole('button', { name: 'Go to page 5' }).click()
  await expect(page.getByText('Generating illustration...')).toBeVisible()
  await waitForImages(page)
  await expect(page).toHaveScreenshot('campaign-page-illustrations-generating.png', {
    fullPage: true,
  })
})

// Finished book with a page selected; a failed page shows its state.
test('campaign page - book ready, page selected', async ({ page }) => {
  db.books = [
    book(1, { status: 'succeeded', cover_image_path: 'book-1/cover.png' }),
    book(2, { status: 'failed' }),
    book(3),
  ]
  db.pages = pagesFor(
    'book-1',
    10,
    (i) => (i === 7 ? 'failed' : 'succeeded'),
    (i) => i !== 7,
  )
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  await page.getByRole('button', { name: 'Go to page 2' }).click()
  await expect(page.getByPlaceholder('Page Title')).toHaveValue('Page 2 scene')
  await expect(page.locator('.cp-gallery img')).toHaveCount(10)
  await waitForImages(page)
  await expect(page).toHaveScreenshot('campaign-page-book-ready.png', { fullPage: true })
})

// Clicking another book resets to its cover; a failed book shows its message.
test('campaign page - failed book selected', async ({ page }) => {
  db.books = [
    book(1, { status: 'succeeded', cover_image_path: 'book-1/cover.png' }),
    book(2, { status: 'failed' }),
  ]
  db.pages = pagesFor('book-1', 4, () => 'succeeded', () => true)
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  await page.getByRole('button', { name: /Owl Learns to Fly/ }).click()
  await expect(page.getByText('Page generation failed.')).toBeVisible()
  await waitForImages(page)
  await expect(page).toHaveScreenshot('campaign-page-failed-book.png', { fullPage: true })
})

for (const [label, action, args] of [
  ['Revise Whole Book', 'request_revise_book', { p_book_id: 'book-1' }],
  ['Revise Page Only', 'request_revise_page', { p_page_id: 'book-1-p1' }],
  ['Add more Books', 'request_add_books', { p_campaign_id: 'test-1', p_count: 2 }],
]) {
  test(`campaign page - ${action} guarded request`, async ({ page }) => {
    db.campaignStatus = 'succeeded'
    db.books = [book(1, { status: 'succeeded' }), book(2, { status: 'succeeded' })]
    db.pages = pagesFor('book-1', 2, () => 'succeeded')
    let release
    db.requestGate = new Promise((resolve) => { release = resolve })
    await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
    await expect(page.getByRole('button', { name: 'Revise Page Only' })).toBeDisabled()
    await page.getByRole('button', { name: 'Go to page 1', exact: true }).click()
    await page.getByLabel('Number of books to add').fill('2.9')
    await expect(page.getByLabel('Number of books to add')).toHaveValue('2')
    await page.getByRole('button', { name: label, exact: true }).click()
    const busy = page.getByRole('button', { name: action === 'request_add_books' ? 'Requesting books...' : 'Requesting revision...' })
    await expect(busy).toBeDisabled()
    await expect(busy).toHaveAttribute('aria-busy', 'true')
    await busy.evaluate((button) => { button.click(); button.click() })
    await expect.poll(() => db.requests).toEqual([{ action, args }])
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(page).toHaveScreenshot(`${action}-submitting.png`, { fullPage: true })
    release()
    await expect(busy).toHaveCount(0)
    await expect(page.getByRole('button', { name: action === 'request_add_books' ? 'Campaign busy...' : label, exact: true })).toBeDisabled()
    await expect.poll(() => db.requests.length).toBe(1)
    await expect(page.getByRole('heading', { name: 'Owl Learns to Fly' })).toBeVisible()
    await expect(page).toHaveScreenshot(`${action}-queued.png`, { fullPage: true })
  })

  test(`campaign page - ${action} error allows retry`, async ({ page }) => {
    db.campaignStatus = 'succeeded'
    db.books = [book(1, { status: 'succeeded' })]
    db.pages = pagesFor('book-1', 1, () => 'succeeded')
    db.requestError = 'Campaign is busy'
    await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
    await page.getByRole('button', { name: 'Go to page 1', exact: true }).click()
    const messages = []
    page.on('dialog', async (dialog) => { messages.push(dialog.message()); await dialog.accept() })
    const button = page.getByRole('button', { name: label, exact: true })
    await button.click()
    await expect.poll(() => messages).toEqual(['Could not request generation: Campaign is busy'])
    await expect(button).toBeEnabled()
    db.requestError = null
    await button.click()
    await expect(page.getByRole('button', { name: action === 'request_add_books' ? 'Campaign busy...' : label, exact: true })).toBeDisabled()
    await expect.poll(() => db.requests.length).toBe(2)
  })
}

// Editing the book title saves only the changed field on blur.
test('campaign page - title edit saves to DB', async ({ page }) => {
  db.books = [book(1)]
  await createCampaign(page, { name: 'Forest Friends', theme: 'cute forest animals' })
  const title = page.getByRole('textbox', { name: 'Book title', exact: true })
  await expect(title).toHaveValue('The Sleepy Fox')
  await title.fill('The Very Sleepy Fox')
  await title.blur()
  await expect.poll(() => db.patches).toEqual([
    { table: 'books', id: 'book-1', title: 'The Very Sleepy Fox' },
  ])
  await expect(page.getByRole('heading', { name: 'The Very Sleepy Fox' })).toBeVisible()
})
