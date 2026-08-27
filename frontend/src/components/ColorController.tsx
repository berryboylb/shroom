import { useEffect } from 'react';
import { useRemoteParticipants, useLocalParticipant } from '@livekit/components-react';
import { stringToColor } from '../utils/colors';

export function ColorController() {
  const participants = useRemoteParticipants();
  const { localParticipant } = useLocalParticipant();

  useEffect(() => {
    const applyColors = () => {
      const tiles = document.querySelectorAll('.lk-participant-tile');
      tiles.forEach(tile => {
        const nameEl = tile.querySelector('.lk-participant-name');
        if (!nameEl || !nameEl.textContent) return;
        
        const name = nameEl.textContent;
        const initial = name.charAt(0).toUpperCase();
        const color = stringToColor(name);
        
        const placeholder = tile.querySelector('.lk-participant-placeholder');
        if (placeholder) {
          // Check if we already injected our custom avatar
          let customAvatar = placeholder.querySelector('.shroom-custom-avatar');
          
          if (!customAvatar) {
            // Hide the default LiveKit SVG icon
            const defaultSvg = placeholder.querySelector('svg');
            if (defaultSvg) {
              (defaultSvg as HTMLElement).style.display = 'none';
            }
            
            // Create a colorful circular avatar with their initial
            customAvatar = document.createElement('div');
            customAvatar.className = 'shroom-custom-avatar';
            customAvatar.textContent = initial;
            Object.assign((customAvatar as HTMLElement).style, {
              width: '100px',
              height: '100px',
              borderRadius: '50%',
              backgroundColor: color,
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '40px',
              fontWeight: 'bold',
              boxShadow: '0 8px 16px rgba(0,0,0,0.2)',
              textShadow: '0 2px 4px rgba(0,0,0,0.2)',
              margin: 'auto'
            });
            
            placeholder.appendChild(customAvatar);
          }
        }
      });
    };

    applyColors();
    const observer = new MutationObserver((mutations) => {
      let shouldApply = false;
      for (const m of mutations) {
        if ((m.target as HTMLElement).classList?.contains('lk-participant-tile') || m.addedNodes.length > 0) {
          shouldApply = true;
        }
      }
      if (shouldApply) setTimeout(applyColors, 50); // slight debounce
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [participants, localParticipant]);

  return null;
}
