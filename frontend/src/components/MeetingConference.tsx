import { createContext, useContext, useEffect, useState } from 'react';
import { Chat, ControlBar, GridLayout, ParticipantTile, useChat, useLocalParticipant, useTrackRefContext, useTracks } from '@livekit/components-react';
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

export function MeetingConference({ onLeave }: { onLeave: () => void }) {
  const [hands, setHands] = useState<HandState[]>([]);
  const [showChat, setShowChat] = useState(false);
  const [lastReadAt, setLastReadAt] = useState(() => Date.now());
  const { localParticipant, isScreenShareEnabled } = useLocalParticipant();
  const { chatMessages } = useChat();
  const unreadMessages = showChat ? 0 : chatMessages.filter(message => message.timestamp > lastReadAt && message.from?.identity !== localParticipant.identity).length;
  const toggleChat = () => { setLastReadAt(chatMessages.reduce((latest, message) => Math.max(latest, message.timestamp), Date.now())); setShowChat(value => !value); };
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
      {showChat && <button type="button" className="shroom-chat-close" onClick={toggleChat} aria-label="Close chat"><X size={19} /></button>}
    </div>
    <div className="shroom-controls">
      <ControlBar controls={{ chat: false, screenShare: false, leave: false }} />
      <button type="button" className="lk-button shroom-share-button" aria-label={isScreenShareEnabled ? 'Stop sharing screen' : 'Share screen'} aria-pressed={isScreenShareEnabled} onClick={() => { void localParticipant.setScreenShareEnabled(!isScreenShareEnabled, { selfBrowserSurface: 'exclude' }).catch(() => {}); }}><MonitorUp size={19} /> <span>{isScreenShareEnabled ? 'Stop share' : 'Share'}</span></button>
      <button type="button" className="lk-button shroom-chat-open" onClick={toggleChat} aria-label={showChat ? 'Close chat' : unreadMessages ? `Open chat, ${unreadMessages} unread messages` : 'Open chat'} aria-pressed={showChat} aria-expanded={showChat}><MessageSquare size={20} /><span>Chat</span>{unreadMessages > 0 && <span className="shroom-chat-unread" aria-hidden="true">{unreadMessages > 99 ? '99+' : unreadMessages}</span>}</button>
      <button type="button" className="lk-button lk-disconnect-button" onClick={onLeave}><LogOut size={19} /><span>Leave</span></button>
    </div>
  </div>;
}
