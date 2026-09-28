import { createContext, useContext, useEffect, useState } from 'react';
import { Chat, ControlBar, DisconnectButton, GridLayout, ParticipantTile, useLocalParticipant, useTrackRefContext, useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { Hand, LogOut, MessageSquare, MonitorUp, X } from 'lucide-react';
import { LinkifiedMessage } from './chat/LinkifiedMessage';

type HandState = { participantId: string; displayName: string };
const HandsContext = createContext<HandState[]>([]);

function CallTile() {
  const track = useTrackRefContext();
  const hands = useContext(HandsContext);
  const position = hands.findIndex(hand => hand.participantId === track.participant.identity);
  return <div className={`shroom-tile-wrap ${position >= 0 ? 'has-raised-hand' : ''}`}>
    <ParticipantTile />
    {position >= 0 && <span className="shroom-tile-hand" aria-label={`${track.participant.name || 'Participant'} raised a hand, position ${position + 1}`}><Hand aria-hidden="true" size={17} /> {position + 1}</span>}
  </div>;
}

export function MeetingConference() {
  const [hands, setHands] = useState<HandState[]>([]);
  const [showChat, setShowChat] = useState(false);
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const allTracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);
  const tracks = allTracks.filter(track => !(track.source === Track.Source.ScreenShare && track.participant.isLocal));

  useEffect(() => {
    const update = (event: Event) => setHands((event as CustomEvent<HandState[]>).detail);
    window.addEventListener('shroom-hands-updated', update);
    return () => window.removeEventListener('shroom-hands-updated', update);
  }, []);

  return <div className={`lk-video-conference shroom-conference ${showChat ? 'is-chat-open' : ''}`}>
    <div className="shroom-conference-main">
      <HandsContext.Provider value={hands}>
        <div className="shroom-conference-grid"><GridLayout tracks={tracks}><CallTile /></GridLayout></div>
      </HandsContext.Provider>
      <Chat style={{ display: showChat ? 'grid' : 'none' }} messageFormatter={message => <LinkifiedMessage message={message} />} />
      {showChat && <button type="button" className="shroom-chat-close" onClick={() => setShowChat(false)} aria-label="Close chat"><X size={19} /></button>}
    </div>
    <div className="shroom-controls">
      <ControlBar controls={{ chat: false, screenShare: false, leave: false }} />
      <button type="button" className="lk-button shroom-share-button" aria-label={isScreenShareEnabled ? 'Stop sharing screen' : 'Share screen'} aria-pressed={isScreenShareEnabled} onClick={() => { void localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { selfBrowserSurface: 'exclude' }).catch(() => {}); }}><MonitorUp size={19} /> <span>{isScreenShareEnabled ? 'Stop share' : 'Share'}</span></button>
      <button type="button" className="lk-button shroom-chat-open" onClick={() => setShowChat(value => !value)} aria-label={showChat ? 'Close chat' : 'Open chat'} aria-pressed={showChat} aria-expanded={showChat}><MessageSquare size={20} /><span>Chat</span></button>
      <DisconnectButton className="lk-disconnect-button"><LogOut size={19} /><span>Leave</span></DisconnectButton>
    </div>
  </div>;
}
