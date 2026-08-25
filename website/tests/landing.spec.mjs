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

test('Quick Start exposes every setup command with icon copy controls', async ({ page }) => {
  await page.goto('/memory_plugin/');
  const copyButtons = page.locator('.hero-terminal [data-copy]');
  await expect(copyButtons).toHaveCount(9);
  await expect(page.locator('#install [data-copy]')).toHaveCount(0);
  await expect(page.locator('[data-copy="npm install -g @lotargo/memory_plugin"]')).toBeVisible();
  await expect(page.locator('[data-copy="npx @lotargo/memory_plugin setup"]')).toBeVisible();
  await expect(page.locator('[data-copy="memory_plugin setup --opencode"]')).toBeVisible();
  await expect(page.locator('[data-copy="memory_plugin setup --codex"]')).toBeVisible();
  await expect(page.locator('[data-copy="memory_plugin setup --claude"]')).toBeVisible();
  await expect(page.locator('[data-copy="memory_plugin setup --antigravity"]')).toBeVisible();
  await expect(page.locator('[data-copy="memory_plugin setup --antigravity --local"]')).toBeVisible();
  await expect(page.locator('[data-copy="memory_plugin setup --gemini"]')).toBeVisible();
  await expect(copyButtons.first().locator('.copy-icon-stack')).toBeVisible();
});

test('brand assets are wired into the page shell', async ({ page }) => {
  await page.goto('/memory_plugin/');
  await expect(page.locator('.brand-mark-v3')).toBeVisible();
  await expect(page.locator('.footer-brand-mark')).toBeVisible();
  await expect(page.locator('link[rel="icon"][type="image/svg+xml"]')).toHaveAttribute('href', /favicon\.svg$/);
  await expect(page.getByRole('link', { name: /GitHub/i }).first().locator('svg')).toBeVisible();
  await expect(page.getByRole('link', { name: /^npm/i }).first().locator('svg')).toBeVisible();
});
