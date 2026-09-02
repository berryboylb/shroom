import { useState, useCallback } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { motion, AnimatePresence } from 'framer-motion';
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
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 0, x: r.x, scale: 0.5 }}
              animate={{ opacity: [0, 1, 1, 0], y: -200, scale: [0.5, 1.5, 1.5, 1] }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2, ease: "easeOut" }}
              className="absolute text-5xl"
              style={{ filter: 'drop-shadow(0px 4px 10px rgba(0,0,0,0.3))' }}
            >
              {r.emoji}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <div className="shroom-reaction-dock">
        <AnimatePresence mode="wait">
          {!isExpanded ? (
            <motion.button
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              onClick={() => setIsExpanded(true)}
              aria-label="Open reactions"
              aria-expanded={isExpanded}
              className="shroom-call-tool-button"
            >
              <SmilePlus className="w-6 h-6" />
            </motion.button>
          ) : (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0, opacity: 0 }}
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
