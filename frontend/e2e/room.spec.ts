import { test, expect } from '@playwright/test';

test.describe('Phase 4: WebRTC Media & Room Flow', () => {
  test('User can login, create a room, and publish local media', async ({ page }) => {
    // 1. Intercept console logs to debug client-side
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));

    await page.goto('/');

    await expect(page.locator('h1')).toContainText('Shroom');
    await page.getByPlaceholder('e.g. Chill Gamer 99').fill('Playwright Tester');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('button', { name: /Start Instant Call/i })).toBeVisible();
    await page.getByRole('button', { name: /Start Instant Call/i }).click();

    await expect(page.getByRole('heading', { name: 'Ready to join?' })).toBeVisible();
    await page.getByRole('button', { name: /^Join / }).click();

    const videoElement = page.locator('video').first();
    await expect(videoElement).toBeVisible({ timeout: 15000 });
  });

  test('A shared link always stops at device selection', async ({ page }) => {
    await page.route('**/api/rooms/abc-defg-hij/join', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ room_id: 'abc-defg-hij', livekit_token: 'test-token' }),
    }));
    await page.goto('/abc-defg-hij');
    await page.getByPlaceholder('e.g. Chill Gamer 99').fill('Privacy Tester');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('heading', { name: 'Ready to join?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn microphone off' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn camera off' })).toBeVisible();
  });

  test('A network outage reconnects without returning to pre-join', async ({ page, context }) => {
    await page.goto('/');
    await page.getByPlaceholder('e.g. Chill Gamer 99').fill('Recovery Tester');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: /Start Instant Call/i }).click();
    await page.getByRole('button', { name: /^Join / }).click();
    await expect(page.locator('video').first()).toBeVisible({ timeout: 15_000 });

    await context.setOffline(true);
    await expect(page.getByRole('alert')).toContainText('Reconnecting', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Ready to join?' })).not.toBeVisible();

    await context.setOffline(false);
    await expect(page.getByRole('alert')).not.toBeVisible({ timeout: 20_000 });
    await expect(page.locator('video').first()).toBeVisible();
  });
});
