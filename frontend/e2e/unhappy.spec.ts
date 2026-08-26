import { test, expect } from '@playwright/test';

test.describe('Phase 8: Unhappy Paths & Resilience', () => {

  test('Form validation prevents empty names', async ({ page }) => {
    await page.goto('/');
    
    // Attempt to enter lobby without filling display name
    await page.getByRole('button', { name: 'Enter Lobby' }).click({ force: true });
    
    // The button should be disabled when empty
    const btn = page.getByRole('button', { name: 'Enter Lobby' });
    await expect(btn).toBeDisabled();
  });

  test('Clearing authentication token drops user back to login', async ({ page }) => {
    await page.goto('/');
    
    await page.getByPlaceholder('Enter your name').fill('Auth Tester');
    await page.getByRole('button', { name: 'Enter Lobby' }).click();
    await expect(page.locator('h2')).toContainText('Lobby');

    // Simulate clearing auth storage (e.g. token expired/removed)
    await page.evaluate(() => localStorage.clear());
    
    // Reload the page
    await page.reload();
    
    // Should be back at the login screen
    await expect(page.getByRole('button', { name: 'Enter Lobby' })).toBeVisible();
  });
});
