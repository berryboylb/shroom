import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveCaptions } from '../LiveCaptions';

vi.mock('@livekit/components-react', () => ({
  useDataChannel: vi.fn(),
  useLocalParticipant: () => ({
    localParticipant: { identity: 'local-user', name: 'Local user', publishData: vi.fn() },
  }),
}));

let instance: FakeRecognition;

class FakeRecognition {
  static onCreate = vi.fn<(value: FakeRecognition) => void>();
  continuous = false;
  interimResults = false;
  lang = '';
  starts = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;

  constructor() { FakeRecognition.onCreate(this); }
  start() { this.starts += 1; this.onstart?.(); }
  stop() {}
}

describe('live captions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecognition.onCreate.mockReset();
    FakeRecognition.onCreate.mockImplementation(value => { instance = value; });
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: FakeRecognition,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as typeof window & { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  });

  it('keeps listening after a normal no-speech timeout', () => {
    render(<LiveCaptions />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn live captions on' }));

    expect(instance.starts).toBe(1);
    expect(screen.getByText('Listening…')).toBeInTheDocument();

    act(() => {
      instance.onerror?.({ error: 'no-speech' });
      instance.onend?.();
      vi.advanceTimersByTime(150);
    });

    expect(instance.starts).toBe(2);
    expect(screen.getByRole('button', { name: 'Turn live captions off' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('prefers an installed on-device dictation pack when the browser supports it', async () => {
    class LocalRecognition extends FakeRecognition {
      static available = vi.fn().mockResolvedValue('available');
      processLocally = false;
    }
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: LocalRecognition,
    });

    render(<LiveCaptions />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Turn live captions on' })));

    expect(LocalRecognition.available).toHaveBeenCalledWith({
      langs: [navigator.language || 'en-US'],
      processLocally: true,
      quality: 'dictation',
    });
    expect((instance as FakeRecognition & { processLocally?: boolean }).processLocally).toBe(true);
    expect(instance.starts).toBe(1);
  });
});
