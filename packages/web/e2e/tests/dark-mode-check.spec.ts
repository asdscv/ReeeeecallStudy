import { test, expect } from '../fixtures/test-helpers';

const PAGES = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'decks', path: '/decks' },
  { name: 'settings', path: '/settings' },
  { name: 'marketplace', path: '/marketplace' },
  { name: 'achievements', path: '/achievements' },
  { name: 'history', path: '/history' },
];

test.describe('Dark Mode Visual Check', () => {
  for (const { name, path } of PAGES) {
    test(`dark: ${name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'dark' });
      await page.evaluate(() => localStorage.setItem('reeeeecall-theme', 'system'));
      await page.goto(path);
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `e2e/screenshots/dark-${name}.png`, fullPage: true });
    });

    test(`light: ${name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.evaluate(() => localStorage.setItem('reeeeecall-theme', 'system'));
      await page.goto(path);
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `e2e/screenshots/light-${name}.png`, fullPage: true });
    });
  }
});
