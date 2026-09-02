import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceNotes } from '../VoiceNotes';

const sendFile = vi.fn().mockResolvedValue({ id: 'stream-id' });
const registerByteStreamHandler = vi.fn();
const unregisterByteStreamHandler = vi.fn();
const microphoneTrack = { stop: vi.fn() };
const microphoneStream = { getTracks: () => [microphoneTrack] };
const getUserMedia = vi.fn().mockResolvedValue(microphoneStream);

vi.mock('@livekit/components-react', () => ({
  useRoomContext: () => ({
    registerByteStreamHandler,
    unregisterByteStreamHandler,
    getParticipantByIdentity: vi.fn(),
  }),
  useLocalParticipant: () => ({
    localParticipant: { identity: 'local-user', name: 'Local user', sendFile },
  }),
}));

class FakeMediaRecorder {
  static isTypeSupported() { return true; }
  state = 'inactive';
  mimeType = 'audio/webm';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;

  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['voice'], { type: this.mimeType }) });
    this.onstop?.();
  }
}

describe('voice notes', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul class="lk-chat-messages"></ul><form class="lk-chat-form"></form>';
    sendFile.mockClear();
    registerByteStreamHandler.mockClear();
    unregisterByteStreamHandler.mockClear();
    microphoneTrack.stop.mockClear();
    getUserMedia.mockClear();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:voice-note'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('records one finalized mic blob and sends it through LiveKit file streaming', async () => {
    render(<VoiceNotes />);
    const record = await screen.findByRole('button', { name: 'Record voice note' });

    await act(async () => fireEvent.click(record));

    expect(getUserMedia).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Stop and send voice note' })).toBeInTheDocument();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop and send voice note' })));

    await waitFor(() => expect(microphoneTrack.stop).toHaveBeenCalledOnce());
    expect(await screen.findByLabelText('Voice note from Local user')).toBeInTheDocument();
    await waitFor(() => expect(sendFile).toHaveBeenCalledOnce());
    expect(sendFile).toHaveBeenCalledWith(expect.any(File), {
      topic: 'shroom-voice-note',
      mimeType: 'audio/webm',
      compress: false,
    });
  });
});
