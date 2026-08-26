import { test, expect } from '@playwright/test';

test.describe('Phase 4: WebRTC Media & Room Flow', () => {
  test('User can login, create a room, and publish local media', async ({ page }) => {
    // 1. Intercept console logs to debug client-side
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.goto('/');

    await expect(page.locator('h1')).toContainText('Shroom');
    await page.getByPlaceholder('Enter your name').fill('Playwright Tester');
    await page.getByRole('button', { name: 'Enter Lobby' }).click();

    await expect(page.locator('h2')).toContainText('Lobby');
    await page.getByRole('button', { name: 'Create New Room' }).click();

    const videoElement = page.locator('video').first();
    await expect(videoElement).toBeVisible({ timeout: 15000 });
  });
});
