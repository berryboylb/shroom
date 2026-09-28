import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { LinkifiedMessage } from './LinkifiedMessage';

vi.mock('../../lib/apiClient', () => ({ apiClient: vi.fn(() => Promise.reject(new Error('offline'))) }));

it('links web URLs while rendering surrounding text safely', () => {
  render(<LinkifiedMessage message={'See https://example.com/page. <script>alert(1)</script>'} />);
  expect(screen.getByRole('link', { name: 'https://example.com/page' })).toHaveAttribute('href', 'https://example.com/page');
  expect(screen.getByText(/<script>alert\(1\)<\/script>/)).toBeInTheDocument();
  expect(document.querySelector('script')).toBeNull();
});
