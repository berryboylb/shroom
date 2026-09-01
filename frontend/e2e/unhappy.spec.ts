import { test, expect } from '@playwright/test';

test.describe('Phase 8: Unhappy Paths & Resilience', () => {

  test('Form validation prevents empty names', async ({ page }) => {
    await page.goto('/');
    
    // Attempt to enter lobby without filling display name
    await page.getByRole('button', { name: 'Continue' }).click({ force: true });
    
    // The button should be disabled when empty
    const btn = page.getByRole('button', { name: 'Continue' });
    await expect(btn).toBeDisabled();
  });

  test('Primary controls have accessible names and touch-sized targets', async ({ page }) => {
    await page.goto('/');
    const controls = page.locator('button, input, select');
    const violations = await controls.evaluateAll(elements => elements.flatMap(element => {
      const node = element as HTMLElement;
      const rect = node.getBoundingClientRect();
      const name = node.getAttribute('aria-label') || node.getAttribute('title') ||
        node.textContent?.trim() || (node as HTMLInputElement).placeholder;
      const problems: string[] = [];
      if (!name) problems.push(`${node.tagName} has no accessible name`);
      if (node.tagName === 'BUTTON' && (rect.width < 44 || rect.height < 44)) {
        problems.push(`${name || 'button'} is smaller than 44px`);
      }
      return problems;
    }));
    expect(violations).toEqual([]);
  });

  test('A cleared access token is restored from the secure refresh session', async ({ page }) => {
    await page.goto('/');
    
    await page.getByPlaceholder('e.g. Chill Gamer 99').fill('Auth Tester');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: /Start Instant Call/i })).toBeVisible();

    // Simulate clearing auth storage (e.g. token expired/removed)
    await page.evaluate(() => sessionStorage.clear());
    
    // Reload the page
    await page.reload();
    
    // The HttpOnly refresh cookie restores the session without another name prompt.
    await expect(page.getByRole('button', { name: /Start Instant Call/i })).toBeVisible();
  });

  test('Explicit logout clears the refresh session', async ({ page }) => {
    await page.goto('/');
    await page.getByPlaceholder('e.g. Chill Gamer 99').fill('Logout Tester');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('button', { name: /Start Instant Call/i })).toBeVisible();

    await page.request.post('/api/auth/logout');
    await page.evaluate(() => sessionStorage.clear());
    await page.reload();

    await expect(page.getByRole('button', { name: 'Continue' })).toBeVisible();
  });
});
