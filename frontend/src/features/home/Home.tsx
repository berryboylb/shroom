import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useRooms } from '../../hooks/useRooms';
import { roomsApi } from '../../api/rooms';
import { Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

interface HomeProps {
  onJoin: (room: { id: string; url: string; token: string }) => void;
}

export function Home({ onJoin }: HomeProps) {
  const [input, setInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { loginGuest, isLoggingIn } = useAuth();
  const { createRoom } = useRooms();
  const token = useAuthStore(state => state.accessToken);
  const isAuthenticated = !!token;

  // Derive intent based on input format
  const isJoinCode = input.trim().startsWith('RM_');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    
    setError(null);
    setIsProcessing(true);

    try {
      if (!isAuthenticated) {
        await loginGuest(input.trim()); // First-time users just enter their name here if unauthenticated
        return; // The parent App component will re-render and show the next step
      }

      // If authenticated, process the room
      if (isJoinCode) {
        const joinData = await roomsApi.joinRoom(input.trim());
        onJoin({ id: joinData.room_id, url: 'ws://localhost:7880', token: joinData.livekit_token });
      } else {
        const roomDetails = await createRoom(`${input.trim()}'s Room`);
        const joinData = await roomsApi.joinRoom(roomDetails.ID);
        onJoin({ id: roomDetails.ID, url: 'ws://localhost:7880', token: joinData.livekit_token });
      }
    } catch (err: any) {
      setError(err.message || 'Something went sideways.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center w-full px-6">
      <div className="w-full max-w-lg space-y-8">
        
        <div className="space-y-2">
          <h1 className="text-4xl font-semibold tracking-tight text-pitch dark:text-paper">
            {!isAuthenticated ? "What should we call you?" : "Good evening."}
          </h1>
          <p className="text-pitch/60 dark:text-paper/60 text-lg">
            {!isAuthenticated ? "Enter a display name to continue." : "Name a room or paste a code."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="relative group">
          <input
            type="text"
            required
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={!isAuthenticated ? "Display name" : "e.g. Design Sync"}
            className="w-full bg-surface-light dark:bg-surface-dark border border-border-light dark:border-border-dark text-pitch dark:text-paper text-2xl py-6 px-6 rounded-card focus:outline-none focus:ring-2 focus:ring-pitch dark:focus:ring-paper transition-shadow shadow-sm"
          />
          
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <button
              type="submit"
              disabled={isProcessing || isLoggingIn || !input.trim()}
              className="bg-acid text-pitch font-semibold px-6 py-3 rounded-[12px] hover:scale-95 active:scale-90 transition-transform disabled:opacity-50 disabled:hover:scale-100 flex items-center justify-center min-w-[100px]"
            >
              {isProcessing || isLoggingIn ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                !isAuthenticated ? "Next" : (isJoinCode ? "Join" : "Start")
              )}
            </button>
          </div>
        </form>

        {error && (
          <p className="text-destructive font-medium">{error}</p>
        )}

      </div>
    </div>
  );
}
