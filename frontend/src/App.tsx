import { useState, useEffect, lazy, Suspense } from 'react';
import { useAuth } from './hooks/useAuth';
import { useRooms } from './hooks/useRooms';
import { AlertCircle, Loader2, Video, ArrowRight, Link as LinkIcon } from 'lucide-react';
import { useAuthStore } from './store/authStore';
import { roomsApi } from './api/rooms';
import { motion, AnimatePresence } from 'framer-motion';
import { ShroomLogo } from './components/ShroomLogo';
import { PreJoinScreen } from './components/PreJoinScreen';

const Room = lazy(() => import('./components/Room').then(m => ({ default: m.Room })));
const AdminDashboard = lazy(() => import('./components/AdminDashboard').then(m => ({ default: m.AdminDashboard })));

export default function App() {
  const { loginGuest, isLoggingIn, loginError } = useAuth();
  const { createRoom, isCreatingRoom, createRoomError } = useRooms();
  const token = useAuthStore(state => state.accessToken);
  const isAuthenticated = !!token;

  const [displayName, setDisplayName] = useState('');
  
  const currentPath = window.location.pathname.replace(/^\/+/, '');
  
  // Intercept the /admin route globally
  if (currentPath === 'admin') {
    return (
      <Suspense fallback={<div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>}>
        <AdminDashboard />
      </Suspense>
    );
  }

  const getRoomFromUrl = () => {
    if (currentPath && currentPath !== 'index.html' && currentPath !== 'admin') return currentPath;
    return new URLSearchParams(window.location.search).get('room') || '';
  };

  const [joinCode, setJoinCode] = useState(getRoomFromUrl());
  const [mode, setMode] = useState<'start' | 'join'>(getRoomFromUrl() ? 'join' : 'start');

  const [activeRoom, setActiveRoom] = useState<{ id: string; url: string; token: string } | null>(() => {
    try {
      const saved = sessionStorage.getItem('activeRoom');
      if (!saved) return null;
      const parsed = JSON.parse(saved);
      const urlRoom = getRoomFromUrl();
      if (urlRoom && urlRoom !== parsed.id) return null;
      return parsed;
    } catch {
      return null;
    }
  });

  const [pendingJoin, setPendingJoin] = useState<{ id: string; token: string; url: string } | null>(null);

  useEffect(() => {
    if (activeRoom) {
      sessionStorage.setItem('activeRoom', JSON.stringify(activeRoom));
      window.history.replaceState({}, '', `/${activeRoom.id}`); 
    } else {
      sessionStorage.removeItem('activeRoom');
      if (getRoomFromUrl()) {
        window.history.replaceState({}, '', '/');
      }
    }
  }, [activeRoom]);

  const [localError, setLocalError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setLocalError(null);
    loginGuest(displayName);
  };

  const handleCreateRoom = async () => {
    setLocalError(null);
    try {
      const roomDetails = await createRoom(`${displayName}'s Room`);
      const joinData = await roomsApi.joinRoom(roomDetails.ID);
      
      setPendingJoin({
        id: roomDetails.ID,
        url: window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.host}`,
        token: joinData.livekit_token,
      });
    } catch (err: any) {
      setLocalError(err.message || 'Network error occurred while creating room');
    }
  };

  const handleJoinExistingRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setLocalError(null);
    setIsJoining(true);
    
    let extracted = joinCode.trim();
    if (extracted.includes('?room=')) {
      extracted = extracted.split('?room=')[1].split('&')[0];
    } else if (extracted.includes('/')) {
      extracted = extracted.split('/').filter(Boolean).pop() || extracted;
    }
    const formattedCode = extracted.toLowerCase().replace(/\s+/g, '-');

    try {
      const joinData = await roomsApi.joinRoom(formattedCode);
      setPendingJoin({
        id: joinData.room_id,
        url: window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.host}`,
        token: joinData.livekit_token,
      });
    } catch (err: any) {
      if (err.message && err.message.includes('not found')) {
         setLocalError('Room not found. Check the code and try again.');
      } else {
         setLocalError(err.message || 'Failed to join room. Invalid code?');
      }
    } finally {
      setIsJoining(false);
    }
  };

  const displayError = localError || (createRoomError ? createRoomError.message : null) || (loginError ? loginError.message : null);

  if (activeRoom) {
    return (
      <Suspense fallback={
        <div className="min-h-[100dvh] bg-slate-950 flex flex-col items-center justify-center text-slate-400">
          <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
          <p className="font-medium animate-pulse">Connecting to secure room...</p>
        </div>
      }>
        <Room 
          roomId={activeRoom.id}
          token={activeRoom.token} 
          serverUrl={activeRoom.url} 
          onDisconnected={() => setActiveRoom(null)} 
        />
      </Suspense>
    );
  }

  if (pendingJoin) {
    return (
      <PreJoinScreen displayName={displayName || "Guest"} 
        roomId={pendingJoin.id}
        onJoin={(mic, cam, videoId, audioId) => {
          sessionStorage.setItem('shroom_mic', String(mic));
          sessionStorage.setItem('shroom_cam', String(cam));
          if (videoId) sessionStorage.setItem('shroom_videoId', videoId);
          if (audioId) sessionStorage.setItem('shroom_audioId', audioId);
          setActiveRoom(pendingJoin);
          setPendingJoin(null);
        }}
        onCancel={() => setPendingJoin(null)}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center font-sans relative overflow-hidden transition-colors duration-500">
      
      <div className="absolute top-6 right-6 z-50">
        <button 
          onClick={() => document.documentElement.classList.toggle('dark')}
          className="p-3 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full shadow-sm border border-slate-200 dark:border-slate-800 transition-all text-xl"
          aria-label="Toggle Dark Mode"
        >
          🌓
        </button>
      </div>

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-[420px] px-6 relative z-10"
      >
        <div className="text-center mb-10">
          <motion.div 
            whileHover={{ scale: 1.05, rotate: -5 }}
            className="w-20 h-20 bg-blue-600 text-white rounded-3xl mx-auto mb-6 flex items-center justify-center shadow-xl shadow-blue-500/20"
          >
            <ShroomLogo className="w-10 h-10" />
          </motion.div>
          <h1 className="text-5xl font-black tracking-tighter text-slate-900 dark:text-white mb-3">
            Shroom
          </h1>
          <p className="text-lg text-slate-500 dark:text-slate-400 font-medium">
            Jump in. Zero friction. 🚀
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-[2rem] p-8 shadow-2xl shadow-slate-200/50 dark:shadow-black/50 border border-slate-100 dark:border-slate-800 relative overflow-hidden">
          
          <AnimatePresence mode="wait">
            {!isAuthenticated ? (
              <motion.form 
                key="login"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                onSubmit={handleJoinLobby} 
                className="space-y-6"
              >
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-3 ml-1 uppercase tracking-wide">
                    What's your name?
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-lg font-medium focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none placeholder:text-slate-400 shadow-sm"
                    placeholder="e.g. Chill Gamer 99"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn || !displayName.trim()}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-4 px-6 rounded-2xl shadow-xl hover:shadow-2xl hover:-translate-y-0.5 active:translate-y-0 transition-all flex justify-center items-center gap-3 disabled:opacity-50"
                >
                  {isLoggingIn ? <Loader2 className="w-6 h-6 animate-spin" /> : <>Continue <ArrowRight className="w-5 h-5" /></>}
                </button>
              </motion.form>
            ) : (
              <motion.div 
                key="lobby"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="flex bg-slate-100 dark:bg-slate-950 p-1.5 rounded-2xl mb-8 border border-slate-200 dark:border-slate-800">
                  <button
                    onClick={() => setMode('start')}
                    className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all ${mode === 'start' ? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                  >
                    Start Room
                  </button>
                  <button
                    onClick={() => setMode('join')}
                    className={`flex-1 py-2.5 px-4 rounded-xl text-sm font-bold transition-all ${mode === 'join' ? 'bg-white dark:bg-slate-800 shadow-sm text-blue-600 dark:text-blue-400' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                  >
                    Join with Link
                  </button>
                </div>

                <AnimatePresence mode="wait">
                  {mode === 'start' ? (
                    <motion.div 
                      key="start"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                    >
                      <button
                        onClick={handleCreateRoom}
                        disabled={isCreatingRoom}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-5 px-6 rounded-2xl shadow-xl shadow-blue-500/20 hover:-translate-y-0.5 active:translate-y-0 transition-all flex justify-center items-center gap-3 disabled:opacity-50"
                      >
                        {isCreatingRoom ? <Loader2 className="w-6 h-6 animate-spin" /> : <>Start Instant Call <Video className="w-5 h-5" /></>}
                      </button>
                    </motion.div>
                  ) : (
                    <motion.form 
                      key="join"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.2 }}
                      onSubmit={handleJoinExistingRoom}
                      className="flex flex-col gap-3"
                    >
                      <div className="relative">
                        <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <LinkIcon className="h-5 w-5 text-slate-400" />
                        </div>
                        <input
                          type="text"
                          required
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value.toLowerCase())}
                          className="w-full pl-11 pr-4 py-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white text-lg font-bold font-mono focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all outline-none placeholder:text-slate-400 shadow-sm placeholder:font-sans placeholder:font-medium tracking-wide"
                          placeholder="abc-defg-hij"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isJoining || !joinCode.trim()}
                        className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold py-4 px-6 rounded-2xl shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all flex justify-center items-center gap-3 disabled:opacity-50"
                      >
                        {isJoining ? <Loader2 className="w-6 h-6 animate-spin" /> : <>Join Call <ArrowRight className="w-5 h-5" /></>}
                      </button>
                    </motion.form>
                  )}
                </AnimatePresence>

              </motion.div>
            )}
          </AnimatePresence>

          {displayError && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              id="error-toast" 
              className="mt-6 p-4 bg-red-50/80 dark:bg-red-900/20 text-red-600 dark:text-red-400 text-sm font-semibold rounded-2xl flex items-center gap-3 border border-red-100 dark:border-red-900/30 backdrop-blur-md"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>{displayError}</p>
            </motion.div>
          )}

        </div>
      </motion.div>
    </div>
  );
}
