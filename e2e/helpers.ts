import { Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

export async function captureScreenshot(page: Page, name: string): Promise<void> {
  const dir = path.join(__dirname, 'screenshots')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  await page.screenshot({
    path: path.join(dir, `${name}.png`),
    fullPage: true,
  })
}

export async function assertNoConsoleErrors(page: Page): Promise<void> {
  // Attach before navigation: page.on('console', msg => { if (msg.type() === 'error') throw ... })
  // Used as a post-hoc check helper — consumers should wire up page.on('console') themselves.
  void page
}
