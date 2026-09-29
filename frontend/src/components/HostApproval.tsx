import { useEffect, useRef, useState } from 'react';
import { roomsApi } from '../api/rooms';
import { playHostRequestChime } from '../utils/audio';

type Request = { participant_id: string; display_name: string; requested_at: string };

export function HostApproval({ roomId }: { roomId: string }) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [requestSound, setRequestSound] = useState(() => localStorage.getItem('shroom-request-sound') !== 'off');
  const seenRequests = useRef(new Set<string>());

  useEffect(() => {
    let alive = true;
    const refresh = () => void roomsApi.pendingRequests(roomId).then(items => {
      if (!alive) return;
      const incoming = items.filter(item => !seenRequests.current.has(item.participant_id));
      for (const item of items) seenRequests.current.add(item.participant_id);
      setRequests(items);
      if (incoming.length > 0) {
        setNotice(incoming.length === 1 ? `${incoming[0].display_name} wants to join.` : `${incoming.length} people want to join.`);
        playHostRequestChime();
      }
    }).catch(() => { if (alive) setError('Could not load join requests.'); });
    refresh();
    const timer = window.setInterval(refresh, 2500);
    return () => { alive = false; window.clearInterval(timer); };
  }, [roomId]);

  const decide = async (participantId: string, approve: boolean) => {
    try {
      await roomsApi.decideRequest(roomId, participantId, approve);
      setRequests(current => current.filter(item => item.participant_id !== participantId));
      setError('');
    } catch {
      setError('Could not update this request. Try again.');
    }
  };

  return <div className="shroom-host-approval">
    <button type="button" className="shroom-host-approval-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      Join requests {requests.length > 0 && <span className="shroom-host-approval-count">{requests.length}</span>}
    </button>
    {notice && <div className="shroom-host-approval-notice" role="status" aria-live="polite"><span>{notice}</span><button type="button" onClick={() => { setOpen(true); setNotice(''); }}>Review</button><button type="button" aria-label="Dismiss join notice" onClick={() => setNotice('')}>×</button></div>}
    {open && <section className="shroom-host-approval-panel" aria-label="Join requests">
      <h2 className="mb-3 font-semibold">Waiting to join</h2>
      <label className="shroom-host-request-sound"><input type="checkbox" checked={requestSound} onChange={event => { setRequestSound(event.target.checked); localStorage.setItem('shroom-request-sound', event.target.checked ? 'on' : 'off'); }} /> Play request sound</label>
      {requests.length === 0 && <p className="text-sm text-white/60">No pending requests.</p>}
      {requests.map(request => <div className="mb-3 rounded-xl bg-white/10 p-3" key={request.participant_id}>
        <p className="mb-2 truncate">{request.display_name}</p>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg bg-emerald-600 px-3 py-2 text-sm" onClick={() => void decide(request.participant_id, true)}>Admit</button>
          <button type="button" className="rounded-lg bg-white/10 px-3 py-2 text-sm" onClick={() => void decide(request.participant_id, false)}>Deny</button>
        </div>
      </div>)}
      {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
    </section>}
  </div>;
}
