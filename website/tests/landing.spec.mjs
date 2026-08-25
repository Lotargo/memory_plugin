import { test, expect } from '@playwright/test';

test('landing page renders the complete product story', async ({ page }) => {
  await page.goto('/memory_plugin/');
  await expect(page.getByRole('heading', { name: /Memory for agents/i })).toBeVisible();
  await expect(page.getByText('HOT MEMORY').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /Find the memory/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Change the agent/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Your memory belongs to you/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Give your agent/i })).toBeVisible();
});

test('desktop and mobile have no horizontal overflow', async ({ page }) => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/memory_plugin/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  }
});

test('primary navigation reaches page sections', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/memory_plugin/');
  await page.getByRole('link', { name: 'Architecture' }).click();
  await expect(page.locator('#architecture')).toBeInViewport();
  await page.getByRole('link', { name: 'Clients' }).click();
  await expect(page.locator('#clients')).toBeInViewport();
});

test('mobile explore CTA reaches features', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/memory_plugin/');
  await page.getByRole('link', { name: /Explore/ }).click();
  await expect(page.locator('#features')).toBeInViewport();
});
