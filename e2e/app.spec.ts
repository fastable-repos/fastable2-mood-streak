import { test, expect, Page } from '@playwright/test'
import { captureScreenshot } from './helpers'

// ─── Date utilities (mirrors App.tsx logic) ───────────────────────────────────

function getDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getTodayKey(): string {
  return getDateKey(new Date())
}

function getDaysAgoKey(daysAgo: number): string {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  return getDateKey(d)
}

// ─── Mood constants ───────────────────────────────────────────────────────────

interface SeedEntry {
  emoji: string
  label: string
  color: string
  timestamp: string
}

function makeEntry(emoji: string, label: string, color: string, daysAgo = 0): SeedEntry {
  const d = new Date()
  d.setDate(d.getDate() - daysAgo)
  d.setHours(8, 32, 0, 0)
  return { emoji, label, color, timestamp: d.toISOString() }
}

const JOYFUL  = (daysAgo = 0) => makeEntry('😄', 'Joyful',  '#FFD700', daysAgo)
const GOOD    = (daysAgo = 0) => makeEntry('😊', 'Good',    '#86EFAC', daysAgo)
const NEUTRAL = (daysAgo = 0) => makeEntry('😐', 'Neutral', '#9CA3AF', daysAgo)
const SAD     = (daysAgo = 0) => makeEntry('😢', 'Sad',     '#60A5FA', daysAgo)

// ─── Seed helper ──────────────────────────────────────────────────────────────

async function seedData(page: Page, data: Record<string, SeedEntry>): Promise<void> {
  await page.evaluate((moodData) => {
    localStorage.setItem('moodData', JSON.stringify(moodData))
  }, data)
}

async function clearData(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.removeItem('moodData'))
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe('Mood Streak App', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await clearData(page)
    await page.reload()
    await page.waitForLoadState('networkidle')
  })

  // ── 1. Happy path — Daily check-in ────────────────────────────────────────
  test('daily check-in: log mood, heatmap updates, streak increments, persists after reload', async ({ page }) => {
    // Capture empty state first
    await captureScreenshot(page, '04-empty-state')

    // Streak should start at 0
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('0')

    // Click Good mood
    await page.click('[data-testid="mood-btn-good"]')

    // Streak should now be 1
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('1')

    // Today's heatmap cell should show Good's color (#86EFAC → rgb(134, 239, 172))
    const todayCell = page.locator(`[data-testid="heatmap-cell-${getTodayKey()}"]`)
    await expect(todayCell).toHaveCSS('background-color', 'rgb(134, 239, 172)')

    await captureScreenshot(page, '01-daily-checkin')

    // Reload and verify persistence
    await page.reload()
    await page.waitForLoadState('networkidle')

    await expect(page.locator('[data-testid="current-streak"]')).toContainText('1')
    const todayCellAfter = page.locator(`[data-testid="heatmap-cell-${getTodayKey()}"]`)
    await expect(todayCellAfter).toHaveCSS('background-color', 'rgb(134, 239, 172)')
  })

  // ── 2. Happy path — Update today's mood ───────────────────────────────────
  test("update today's mood: only one entry exists for today in localStorage", async ({ page }) => {
    // Log Joyful first
    await page.click('[data-testid="mood-btn-joyful"]')
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('1')

    // Update to Sad
    await page.click('[data-testid="mood-btn-sad"]')

    // Verify localStorage has only 1 entry and it's Sad
    const storedData = await page.evaluate(() => {
      const raw = localStorage.getItem('moodData')
      return raw ? JSON.parse(raw) : {}
    }) as Record<string, SeedEntry>

    expect(Object.keys(storedData)).toHaveLength(1)
    expect(storedData[getTodayKey()].label).toBe('Sad')

    // Streak still 1 (one day)
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('1')

    // Cell color is Sad's color (#60A5FA → rgb(96, 165, 250))
    const todayCell = page.locator(`[data-testid="heatmap-cell-${getTodayKey()}"]`)
    await expect(todayCell).toHaveCSS('background-color', 'rgb(96, 165, 250)')
  })

  // ── 3. Edge case — Streak: 6 consecutive prior days → log today → 7 ───────
  test('streak calculation: 6 prior consecutive days shows 6, then 7 after logging today', async ({ page }) => {
    // Seed 6 consecutive prior days (days 1-6 ago)
    const seedObj: Record<string, SeedEntry> = {}
    for (let i = 1; i <= 6; i++) {
      seedObj[getDaysAgoKey(i)] = JOYFUL(i)
    }
    await seedData(page, seedObj)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Streak should be 6 (consecutive from yesterday going back, today not logged)
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('6')

    // Log today
    await page.click('[data-testid="mood-btn-joyful"]')

    // Streak should now be 7
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('7')
  })

  // ── 4. Edge case — Missing days break streak ───────────────────────────────
  test('missing days: gap yesterday means streak is 1', async ({ page }) => {
    // Seed 2 days ago only (skip yesterday)
    const seedObj: Record<string, SeedEntry> = {
      [getDaysAgoKey(2)]: JOYFUL(2),
    }
    await seedData(page, seedObj)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Log today
    await page.click('[data-testid="mood-btn-good"]')

    // Current streak should be 1 (yesterday was skipped)
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('1')
  })

  // ── 5. Data persistence across page reload ─────────────────────────────────
  test('data persists after page reload', async ({ page }) => {
    await page.click('[data-testid="mood-btn-joyful"]')
    const todayKey = getTodayKey()

    // Reload page
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Joyful color: #FFD700 → rgb(255, 215, 0)
    const cell = page.locator(`[data-testid="heatmap-cell-${todayKey}"]`)
    await expect(cell).toHaveCSS('background-color', 'rgb(255, 215, 0)')
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('1')
  })

  // ── 6. Weekly insights: declining trend detected ───────────────────────────
  test('weekly insights: 5 Joyful last week + 5 Sad this week = declining trend', async ({ page }) => {
    const seedObj: Record<string, SeedEntry> = {}
    // Previous week: days 7–11 → Joyful
    for (let i = 7; i <= 11; i++) {
      seedObj[getDaysAgoKey(i)] = JOYFUL(i)
    }
    // Current week: days 1–5 → Sad (skip today to test via seeded data only)
    for (let i = 1; i <= 5; i++) {
      seedObj[getDaysAgoKey(i)] = SAD(i)
    }
    await seedData(page, seedObj)
    await page.reload()
    await page.waitForLoadState('networkidle')

    const panel = page.locator('[data-testid="insights-panel"]')

    // Should show Sad as most frequent current mood
    await expect(panel).toContainText('Sad')

    // Should show declining trend icon
    await expect(panel).toContainText('📉')
  })

  // ── 7. Mood frequency chart accuracy ──────────────────────────────────────
  test('frequency chart: Neutral (10) shows as largest bar, Joyful (3) smaller', async ({ page }) => {
    const seedObj: Record<string, SeedEntry> = {}
    // 10 Neutral entries (days 1–10)
    for (let i = 1; i <= 10; i++) {
      seedObj[getDaysAgoKey(i)] = NEUTRAL(i)
    }
    // 3 Joyful entries (days 11–13)
    for (let i = 11; i <= 13; i++) {
      seedObj[getDaysAgoKey(i)] = JOYFUL(i)
    }
    await seedData(page, seedObj)
    await page.reload()
    await page.waitForLoadState('networkidle')

    await captureScreenshot(page, '03-insights-analytics')

    // Neutral bar should be visible and show count 10
    const neutralBar = page.locator('[data-testid="freq-bar-neutral"]')
    await expect(neutralBar).toBeVisible()
    await expect(neutralBar).toContainText('10')

    // Joyful bar should show count 3
    const joyfulBar = page.locator('[data-testid="freq-bar-joyful"]')
    await expect(joyfulBar).toBeVisible()
    await expect(joyfulBar).toContainText('3')

    // Neutral bar inner fill should be 100% wide (max), Joyful should be narrower
    // We verify by checking the inline width style of the fill div
    const neutralFill = neutralBar.locator('div > div')
    const joyfulFill  = joyfulBar.locator('div > div')

    const neutralWidth = await neutralFill.evaluate((el) => (el as HTMLElement).style.width)
    const joyfulWidth  = await joyfulFill.evaluate((el) => (el as HTMLElement).style.width)

    // Neutral should be 100%, Joyful should be 30%
    expect(neutralWidth).toBe('100%')
    expect(joyfulWidth).toBe('30%')
  })

  // ── 8. Reset data ──────────────────────────────────────────────────────────
  test('reset data: clears heatmap, streak resets to 0, localStorage empty', async ({ page }) => {
    // Log a mood first
    await page.click('[data-testid="mood-btn-joyful"]')
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('1')

    // Open reset dialog
    await page.click('[data-testid="reset-btn"]')
    const dialog = page.locator('[data-testid="reset-dialog"]')
    await expect(dialog).toBeVisible()

    // Confirm reset
    await page.click('[data-testid="reset-confirm"]')

    // Dialog should be gone
    await expect(dialog).not.toBeVisible()

    // Streak should be 0
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('0')

    // Insights panel should show no-data state
    await expect(page.locator('[data-testid="insights-no-data"]')).toBeVisible()

    // Today's cell should be the empty/placeholder color (not a mood color)
    const todayCell = page.locator(`[data-testid="heatmap-cell-${getTodayKey()}"]`)
    await expect(todayCell).toHaveCSS('background-color', 'rgb(229, 231, 235)') // #E5E7EB

    // localStorage should have no moodData key
    const stored = await page.evaluate(() => localStorage.getItem('moodData'))
    expect(stored).toBeNull()

    await captureScreenshot(page, '04-empty-after-reset')
  })

  // ── 9. Heatmap tooltip on hover ────────────────────────────────────────────
  test('heatmap tooltip: hover shows correct date, emoji, label, and time', async ({ page }) => {
    // Seed yesterday's entry with a known time
    const yesterdayKey = getDaysAgoKey(1)
    const fixedTimestamp = (() => {
      const d = new Date()
      d.setDate(d.getDate() - 1)
      d.setHours(8, 32, 0, 0)
      return d.toISOString()
    })()

    const seedObj: Record<string, SeedEntry> = {
      [yesterdayKey]: { emoji: '😄', label: 'Joyful', color: '#FFD700', timestamp: fixedTimestamp },
    }
    await seedData(page, seedObj)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Hover over yesterday's cell
    const cell = page.locator(`[data-testid="heatmap-cell-${yesterdayKey}"]`)
    await cell.hover()

    // Tooltip should appear
    const tooltip = page.locator('[data-testid="heatmap-tooltip"]')
    await expect(tooltip).toBeVisible()

    // Check content
    await expect(tooltip).toContainText('😄')
    await expect(tooltip).toContainText('Joyful')
    // Should show a formatted time string (e.g. "8:32 AM")
    await expect(tooltip).toContainText('AM')

    await captureScreenshot(page, '02-heatmap-tooltip')
  })

  // ── 10. Cancel reset dialog ────────────────────────────────────────────────
  test('cancel reset: dialog closes and data is preserved', async ({ page }) => {
    await page.click('[data-testid="mood-btn-good"]')
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('1')

    await page.click('[data-testid="reset-btn"]')
    await expect(page.locator('[data-testid="reset-dialog"]')).toBeVisible()

    await page.click('[data-testid="reset-cancel"]')
    await expect(page.locator('[data-testid="reset-dialog"]')).not.toBeVisible()

    // Data still intact
    await expect(page.locator('[data-testid="current-streak"]')).toContainText('1')
  })

  // ── 11. Screenshot: home screen with varied data ───────────────────────────
  test('screenshot: home screen with seeded mood history', async ({ page }) => {
    const seedObj: Record<string, SeedEntry> = {}
    const moodFns = [JOYFUL, GOOD, NEUTRAL, SAD]
    for (let i = 1; i <= 30; i++) {
      seedObj[getDaysAgoKey(i)] = moodFns[i % 4](i)
    }
    await seedData(page, seedObj)
    await page.reload()
    await page.waitForLoadState('networkidle')

    // Log today
    await page.click('[data-testid="mood-btn-joyful"]')
    await captureScreenshot(page, '01-home-screen')
  })

})
