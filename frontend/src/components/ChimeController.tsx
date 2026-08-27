import { useEffect, useRef } from 'react';
import { useRemoteParticipants } from '@livekit/components-react';
import { playJoinChime, playLeaveChime } from '../utils/audio';

export function ChimeController() {
  const participants = useRemoteParticipants();
  const prevCountRef = useRef(participants.length);

  useEffect(() => {
    const currentCount = participants.length;
    const prevCount = prevCountRef.current;
    
    if (currentCount > prevCount) {
      playJoinChime();
    } else if (currentCount < prevCount) {
      playLeaveChime();
    }
    
    prevCountRef.current = currentCount;
  }, [participants]);

  // Play the join chime exactly once for the local user when this mounts (they enter the room)
  useEffect(() => {
    playJoinChime();
  }, []);

  return null;
}
