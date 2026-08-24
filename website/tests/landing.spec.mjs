import { test, expect } from '@playwright/test';

test('landing page renders the core product story', async ({ page }) => {
  await page.goto('/memory_plugin/');
  await expect(page.getByRole('heading', { name: /Memory for agents/i })).toBeVisible();
  await expect(page.getByText('HOT MEMORY').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Store the right thing/i })).toBeVisible();
});

test('desktop and mobile have no horizontal overflow', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/memory_plugin/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  }
});
