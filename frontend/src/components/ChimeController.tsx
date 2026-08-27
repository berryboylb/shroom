import { useEffect } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';
import { playJoinChime, playLeaveChime } from '../utils/audio';

export function ChimeController() {
  const room = useRoomContext();

  useEffect(() => {
    const handleJoin = () => playJoinChime();
    const handleLeave = () => playLeaveChime();

    // These events ONLY fire for people who join/leave AFTER we are already connected.
    // They intentionally ignore people who were already in the room before we got here.
    room.on(RoomEvent.ParticipantConnected, handleJoin);
    room.on(RoomEvent.ParticipantDisconnected, handleLeave);

    return () => {
      room.off(RoomEvent.ParticipantConnected, handleJoin);
      room.off(RoomEvent.ParticipantDisconnected, handleLeave);
    };
  }, [room]);

  // Play the join chime exactly once for the local user themselves when they enter
  useEffect(() => {
    playJoinChime();
  }, []);

  return null;
}
