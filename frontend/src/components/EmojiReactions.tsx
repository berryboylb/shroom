import { useState, useCallback, type CSSProperties } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { SmilePlus, X } from 'lucide-react';

interface Reaction {
  id: string;
  emoji: string;
  x: number;
}

const EMOJIS = ['🔥', '❤️', '👍', '🎉', '😂', '👀'];

export function EmojiReactions() {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const { localParticipant } = useLocalParticipant();

  const spawnReaction = useCallback((emoji: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    const x = Math.random() * 100 - 50; 
    setReactions(prev => [...prev, { id, emoji, x }]);
    
    setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
    }, 2000);
  }, []);

  useDataChannel((msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload));
      if (data.type === 'reaction') {
        spawnReaction(data.emoji);
      }
    } catch {}
  });

  const sendReaction = useCallback((emoji: string) => {
    if (!localParticipant) return;
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'reaction', emoji }));
    localParticipant.publishData(payload, { reliable: false });
    spawnReaction(emoji);
  }, [localParticipant, spawnReaction]);

  return (
    <>
      <div className="absolute inset-0 pointer-events-none z-40 overflow-hidden flex justify-center items-end pb-32">
          {reactions.map((r) => (
            <div
              key={r.id}
              className="shroom-floating-reaction absolute text-5xl"
              style={{ '--reaction-x': `${r.x}px` } as CSSProperties}
            >
              {r.emoji}
            </div>
          ))}
      </div>

      <div className="shroom-reaction-dock">
          {!isExpanded ? (
            <button
              onClick={() => setIsExpanded(true)}
              aria-label="Open reactions"
              aria-expanded={isExpanded}
              className="shroom-call-tool-button"
            >
              <SmilePlus className="w-6 h-6" />
            </button>
          ) : (
            <div
              className="shroom-reaction-menu"
            >
              {EMOJIS.map(emoji => (
                <button
                  key={emoji}
                  onClick={() => sendReaction(emoji)}
                  aria-label={`Send ${emoji} reaction`}
                  className="w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-slate-700/80 active:scale-90 transition-all text-lg sm:text-xl flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {emoji}
                </button>
              ))}
              <div className="w-px h-6 bg-slate-700/50 mx-1"></div>
              <button 
                onClick={() => setIsExpanded(false)}
                aria-label="Close reactions"
                className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/80 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          )}
      </div>
    </>
  );
}
