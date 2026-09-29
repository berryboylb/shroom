import { useState } from 'react';
import { ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { roomsApi } from '../api/rooms';

const issues = ['Audio', 'Video', 'Joining', 'Chat', 'Controls', 'Connection', 'Other'] as const;

export function PostCallFeedback({ roomId, onDismiss }: { roomId: string; onDismiss: () => void }) {
  const [hasProblem, setHasProblem] = useState(false);
  const [issue, setIssue] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const submit = async (rating: 'good' | 'problem') => {
    if (sending || (rating === 'problem' && !issue)) return;
    setSending(true);
    setError('');
    try {
      await roomsApi.sendFeedback(roomId, rating, rating === 'problem' ? issue : '', note.trim());
      onDismiss();
    } catch {
      setError('Could not send feedback. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return <section className="shroom-feedback-card" aria-labelledby="shroom-feedback-title">
    <button type="button" className="shroom-feedback-close" aria-label="Dismiss feedback" onClick={onDismiss}><X size={17} /></button>
    <h2 id="shroom-feedback-title">How was your call?</h2>
    <p>A quick answer helps us improve Shroom.</p>
    {!hasProblem ? <div className="shroom-feedback-actions">
      <button type="button" disabled={sending} onClick={() => void submit('good')}><ThumbsUp size={16} /> Good</button>
      <button type="button" disabled={sending} onClick={() => setHasProblem(true)}><ThumbsDown size={16} /> Had a problem</button>
    </div> : <>
      <div className="shroom-feedback-issues" role="group" aria-label="What went wrong?">
        {issues.map(item => <button type="button" key={item} className={issue === item.toLowerCase() ? 'is-selected' : ''} aria-pressed={issue === item.toLowerCase()} onClick={() => setIssue(item.toLowerCase())}>{item}</button>)}
      </div>
      <label className="shroom-feedback-note-label" htmlFor="shroom-feedback-note">Anything else? (optional)</label>
      <textarea id="shroom-feedback-note" maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Tell us what happened" />
      <button type="button" className="shroom-primary-button shroom-feedback-submit" disabled={!issue || sending} onClick={() => void submit('problem')}>{sending ? 'Sending…' : 'Send feedback'}</button>
    </>}
    {error && <p role="alert" className="shroom-feedback-error">{error}</p>}
  </section>;
}
