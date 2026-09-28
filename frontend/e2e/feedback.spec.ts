import { expect, test } from '@playwright/test';

const roomId = 'secure-room';

async function signInAsGuest(page: import('@playwright/test').Page, path = '/') {
  await page.route('**/api/auth/guest', async route => {
    const body = route.request().postDataJSON() as { display_name: string };
    await route.fulfill({ json: {
      access_token: 'browser-test-token',
      display_name: body.display_name,
      is_guest: true,
    } });
  });
  await page.goto(path);
  await page.getByPlaceholder('Your display name').fill('Playwright Guest');
  await page.getByRole('button', { name: 'Continue' }).click();
}

test('host can create an approval-required room', async ({ page }) => {
  let approvalRequired: boolean | undefined;
  await page.route('**/api/rooms', async route => {
    const body = route.request().postDataJSON() as { approval_required: boolean };
    approvalRequired = body.approval_required;
    await route.fulfill({ json: { ID: roomId, Title: 'Instant Room', ApprovalRequired: true } });
  });
  await page.route(`**/api/rooms/${roomId}/join`, route => route.fulfill({
    json: { room_id: roomId, livekit_token: 'host-token', is_host: true, approval_required: true },
  }));

  await signInAsGuest(page);
  await page.getByRole('checkbox', { name: 'Require host approval' }).check();
  await page.getByRole('button', { name: 'Start Instant Call' }).click();

  await expect(page.getByRole('heading', { name: 'Ready when you are?' })).toBeVisible();
  expect(approvalRequired).toBe(true);
});

test('guest waits without a meeting token until approved', async ({ page }) => {
  let approved = false;
  let joinAttempts = 0;
  await page.route(`**/api/rooms/${roomId}/join`, async route => {
    joinAttempts++;
    await route.fulfill({
      status: approved ? 200 : 202,
      json: approved
        ? { room_id: roomId, livekit_token: 'approved-token', is_host: false, approval_required: true }
        : { room_id: roomId, status: 'pending' },
    });
  });

  await signInAsGuest(page, `/${roomId}`);
  await expect(page.getByRole('heading', { name: 'Waiting for the host' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Ready when you are?' })).toHaveCount(0);
  await expect(page.locator('video')).toHaveCount(0);

  approved = true;
  await expect(page.getByRole('heading', { name: 'Ready when you are?' })).toBeVisible({ timeout: 10_000 });
  expect(joinAttempts).toBeGreaterThan(1);
});

test('guest can cancel an approval request', async ({ page }) => {
  let cancelled = false;
  await page.route(`**/api/rooms/${roomId}/join`, route => route.fulfill({
    status: 202, json: { room_id: roomId, status: 'pending' },
  }));
  await page.route(`**/api/rooms/${roomId}/requests/cancel`, async route => {
    cancelled = true;
    await route.fulfill({ status: 204 });
  });

  await signInAsGuest(page, `/${roomId}`);
  await expect(page.getByRole('heading', { name: 'Waiting for the host' })).toBeVisible();
  await page.getByRole('button', { name: 'Cancel request' }).click();
  await expect(page.getByRole('heading', { name: 'Waiting for the host' })).toHaveCount(0);
  await expect.poll(() => cancelled).toBe(true);
  await expect(page).toHaveURL('/');
});

test.describe('mobile device check', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } });

  test('shows camera flip and keeps microphone and camera controls usable', async ({ page }) => {
    await page.route(`**/api/rooms/${roomId}/join`, route => route.fulfill({
      json: { room_id: roomId, livekit_token: 'guest-token' },
    }));

    await signInAsGuest(page, `/${roomId}`);
    await expect(page.getByRole('heading', { name: 'Ready when you are?' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Flip camera' })).toBeVisible();
    await page.getByRole('button', { name: 'Flip camera' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);

    await page.getByRole('button', { name: 'Turn microphone off' }).click();
    await expect(page.getByRole('button', { name: 'Turn microphone on' })).toBeVisible();
    await page.getByRole('button', { name: 'Turn camera off' }).click();
    await expect(page.getByText('Camera is off')).toBeVisible();
  });
});
