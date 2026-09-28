import { beforeEach, describe, expect, it } from 'vitest';
import { safeReturnTo } from '../lib/authRedirect';

describe('safeReturnTo', () => {
  beforeEach(() => window.history.replaceState({}, '', '/login'));

  it('keeps a local room path and private URL fragment', () => {
    expect(safeReturnTo('/abc-defg-hij#key=private')).toBe('/abc-defg-hij#key=private');
  });

  it('rejects external and protocol-relative redirects', () => {
    expect(safeReturnTo('https://example.com')).toBe('/');
    expect(safeReturnTo('//example.com/path')).toBe('/');
  });

  it('does not redirect back into the login page', () => {
    expect(safeReturnTo('/login?returnTo=%2Flogin')).toBe('/');
  });
});
