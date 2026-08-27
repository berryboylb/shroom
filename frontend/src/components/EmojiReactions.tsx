import { useState, useCallback } from 'react';
import { useDataChannel, useLocalParticipant } from '@livekit/components-react';
import { motion, AnimatePresence } from 'framer-motion';

interface Reaction {
  id: string;
  emoji: string;
  x: number;
}

const EMOJIS = ['🔥', '❤️', '👍', '🎉', '😂', '👀'];

export function EmojiReactions() {
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const { localParticipant } = useLocalParticipant();

  // Handle incoming data channel messages
  useDataChannel((msg) => {
    try {
      const data = JSON.parse(new TextDecoder().decode(msg.payload));
      if (data.type === 'reaction') {
        spawnReaction(data.emoji);
      }
    } catch (e) {
      // ignore
    }
  });

  const spawnReaction = useCallback((emoji: string) => {
    const id = Math.random().toString(36).substr(2, 9);
    // Random horizontal position near center-bottom
    const x = Math.random() * 100 - 50; 
    setReactions(prev => [...prev, { id, emoji, x }]);
    
    // Cleanup after animation
    setTimeout(() => {
      setReactions(prev => prev.filter(r => r.id !== id));
    }, 2000);
  }, []);

  const sendReaction = useCallback((emoji: string) => {
    if (!localParticipant) return;
    
    const payload = new TextEncoder().encode(JSON.stringify({ type: 'reaction', emoji }));
    // 0 = RELIABLE, 1 = LOSSY
    localParticipant.publishData(payload, { reliable: false });
    
    // Spawn locally instantly for responsiveness
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

      <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 flex gap-1 sm:gap-2 max-w-[95vw] overflow-x-auto bg-slate-900/80 backdrop-blur-xl p-2 rounded-full border border-slate-700/50 shadow-2xl">
        {EMOJIS.map(emoji => (
          <button
            key={emoji}
            onClick={() => sendReaction(emoji)}
            className="w-8 h-8 sm:w-10 sm:h-10 rounded-full hover:bg-slate-700/80 active:scale-90 transition-all text-lg sm:text-xl flex items-center justify-center focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
}
