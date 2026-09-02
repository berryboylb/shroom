import { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { useAuth } from './hooks/useAuth';
import { useAuthStore } from './store/authStore';
import { roomsApi } from './api/rooms';
import { authApi } from './api/auth';

const Room = lazy(() => import('./components/Room').then(m => ({ default: m.Room })));
const PreJoinScreen = lazy(() => import('./components/PreJoinScreen').then(m => ({ default: m.PreJoinScreen })));
import { Loader2, Video, Link as LinkIcon, ArrowRight, AlertCircle, Sparkles } from 'lucide-react';
import { ShroomLogo } from './components/ShroomLogo';

const AdminDashboard = lazy(() => import('./components/AdminDashboard').then(m => ({ default: m.AdminDashboard })));

type RoomConnection = { id: string; url: string; token: string; e2eeKey?: string; canEnableE2EE?: boolean };

function getE2EEKeyFromUrl(): string | undefined {
  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('key') || undefined;
}

function supportsMediaE2EE(): boolean {
  return 'RTCRtpScriptTransform' in window || (
    typeof RTCRtpSender !== 'undefined' && 'createEncodedStreams' in RTCRtpSender.prototype
  );
}

function generateE2EEKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function getRoomFromLocation(currentPath: string): string {
  if (currentPath && currentPath !== 'index.html' && currentPath !== 'admin') return currentPath;
  return new URLSearchParams(window.location.search).get('room') || '';
}

function getSavedRoomForReconnect(urlRoom: string): RoomConnection | null {
  if (!urlRoom) return null;

  try {
    const saved = JSON.parse(sessionStorage.getItem('activeRoom') || 'null');
    if (
      saved &&
      saved.id === urlRoom &&
      typeof saved.url === 'string' &&
      typeof saved.token === 'string' &&
      (saved.e2eeKey === undefined || typeof saved.e2eeKey === 'string')
    ) {
      return saved;
    }
  } catch {
    // Invalid or stale session data must fall back to the privacy-safe pre-join flow.
  }

  return null;
}

export default function App() {
  const currentPath = window.location.pathname.replace(/^\/+/, '');
  if (currentPath === 'admin') {
    return (
      <Suspense fallback={<div className="min-h-[100dvh] bg-slate-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500 w-8 h-8" /></div>}>
        <AdminDashboard />
      </Suspense>
    );
  }

  return <MeetingApp currentPath={currentPath} />;
}

function MeetingApp({ currentPath }: { currentPath: string }) {
  const urlRoom = getRoomFromLocation(currentPath);

  const [joinCode, setJoinCode] = useState(urlRoom);
  const [mode, setMode] = useState<'start' | 'join'>(urlRoom ? 'join' : 'start');

  // A refresh may resume only when this tab already has an active session for
  // this exact room. A new/shared URL has no matching session and must pre-join.
  const [activeRoom, setActiveRoom] = useState<RoomConnection | null>(() =>
    getSavedRoomForReconnect(urlRoom)
  );

  const [pendingJoin, setPendingJoin] = useState<RoomConnection | null>(null);
  const [isAutoRejoining, setIsAutoRejoining] = useState(false);
  const autoRejoinAttempted = useRef<string | null>(null);
  const isPageUnloading = useRef(false);

  // Prepare a room from a shared/restored URL. This deliberately stops at the
  // pre-join screen; only its explicit Join action may activate the meeting.
  const isAuthenticated = !!useAuthStore(state => state.accessToken);
  const setAccessToken = useAuthStore(state => state.setAccessToken);
  const setStoredDisplayName = useAuthStore(state => state.setDisplayName);
  const savedDisplayName = useAuthStore(state => state.displayName);
  useEffect(() => {
    const markPageUnloading = () => { isPageUnloading.current = true; };
    window.addEventListener('pagehide', markPageUnloading);
    window.addEventListener('beforeunload', markPageUnloading);
    return () => {
      window.removeEventListener('pagehide', markPageUnloading);
      window.removeEventListener('beforeunload', markPageUnloading);
    };
  }, []);

  useEffect(() => {
    // A clean visitor has no session hint, so avoid an expected 401 request.
    // Returning visitors keep their display name in this tab and can refresh
    // the HttpOnly session without delaying the public landing page.
    if (isAuthenticated || !savedDisplayName) return;
    let cancelled = false;
    authApi.refresh().then(session => {
      if (!cancelled) {
        setAccessToken(session.access_token);
        setStoredDisplayName(session.display_name);
      }
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthenticated, savedDisplayName, setAccessToken, setStoredDisplayName]);

  useEffect(() => {
    if (urlRoom && isAuthenticated && !activeRoom && !pendingJoin && !isAutoRejoining && autoRejoinAttempted.current !== urlRoom) {
      autoRejoinAttempted.current = urlRoom;
      setIsAutoRejoining(true);
      roomsApi.joinRoom(urlRoom).then(joinData => {
        setPendingJoin({
          id: joinData.room_id,
          url: window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.host}`,
          token: joinData.livekit_token,
          e2eeKey: getE2EEKeyFromUrl(),
        });
      }).catch((err) => {
        console.error("Auto rejoin failed", err);
      }).finally(() => {
        setIsAutoRejoining(false);
      });
    }
  }, [urlRoom, isAuthenticated, activeRoom, pendingJoin, isAutoRejoining]);

  useEffect(() => {
    if (activeRoom) {
      sessionStorage.setItem('activeRoom', JSON.stringify(activeRoom));
      const fragment = activeRoom.e2eeKey ? `#key=${encodeURIComponent(activeRoom.e2eeKey)}` : '';
      window.history.replaceState({}, '', `/${activeRoom.id}${fragment}`);
    } else {
      sessionStorage.removeItem('activeRoom');
      // Intentionally DO NOT clear the URL here. 
      // If we clear the URL on an accidental disconnect, they lose the auto-rejoin state!
    }
  }, [activeRoom]);

  const [localError, setLocalError] = useState<string | null>(null);
  const [isJoining, setIsJoining] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  const { loginGuest, isLoggingIn, loginError } = useAuth();
  
  const [displayName, setDisplayName] = useState(savedDisplayName || '');

  const handleJoinLobby = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return;
    setLocalError(null);
    loginGuest(displayName);
  };

  const handleCreateRoom = async () => {
    setLocalError(null);
    setIsCreatingRoom(true);
    try {
      const room = await roomsApi.createRoom('Instant Room');
      const joinData = await roomsApi.joinRoom(room.ID);
      
      setPendingJoin({
        id: joinData.room_id,
        url: window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.host}`,
        token: joinData.livekit_token,
        canEnableE2EE: supportsMediaE2EE(),
      });
    } catch (err: any) {
      setLocalError(err.message || 'Failed to create room');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleJoinExistingRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!joinCode.trim()) return;
    setLocalError(null);
    setIsJoining(true);
    
    let extracted = joinCode.trim();
    let e2eeKey: string | undefined;
    try {
      const parsed = new URL(extracted, window.location.origin);
      e2eeKey = new URLSearchParams(parsed.hash.replace(/^#/, '')).get('key') || undefined;
    } catch {
      // Treat non-URL input as a room code.
    }
    if (extracted.includes('?room=')) {
      extracted = extracted.split('?room=')[1].split('&')[0];
    } else if (extracted.includes('/')) {
      extracted = extracted.split('/').filter(Boolean).pop() || extracted;
    }
    extracted = extracted.split('#')[0];
    const formattedCode = extracted.toLowerCase().replace(/\s+/g, '-');

    try {
      const joinData = await roomsApi.joinRoom(formattedCode);
      setPendingJoin({
        id: joinData.room_id,
        url: window.location.protocol === 'https:' ? `wss://${window.location.host}` : `ws://${window.location.host}`,
        token: joinData.livekit_token,
        e2eeKey,
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

  const displayError = localError || loginError?.message;

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
          e2eeKey={activeRoom.e2eeKey}
          onDisconnected={() => {
            if (isPageUnloading.current) return;
            // A transport drop is handled by LiveKit's reconnect loop. Keep
            // the room mounted so the reconnect overlay can reassure the user
            // instead of throwing them back to the lobby.
            if (typeof navigator !== 'undefined' && !navigator.onLine) return;
            // Give LiveKit a short recovery window before tearing down the
            // room UI. This prevents a transport blip from exposing pre-join
            // controls or losing the auto-rejoin context.
            window.setTimeout(() => {
              if (navigator.onLine) {
                setActiveRoom(null);
                window.history.replaceState({}, '', '/');
              }
            }, 10_000);
          }} 
        />
      </Suspense>
    );
  }

  if (pendingJoin) {
    return (
      <Suspense fallback={<div role="status" className="min-h-[100dvh] bg-slate-950 flex items-center justify-center text-slate-400"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /><span className="sr-only">Preparing device check</span></div>}>
        <PreJoinScreen 
          displayName={savedDisplayName || displayName || "Guest"} 
          roomId={pendingJoin.id}
          encrypted={Boolean(pendingJoin.e2eeKey)}
          encryptionSupported={supportsMediaE2EE()}
          encryptionAvailable={Boolean(pendingJoin.canEnableE2EE)}
          onJoin={(mic, cam, videoId, audioId, enableE2EE) => {
            if (videoId) sessionStorage.setItem('shroom_videoId', videoId);
            if (audioId) sessionStorage.setItem('shroom_audioId', audioId);
            sessionStorage.setItem('shroom_cam', cam.toString());
            sessionStorage.setItem('shroom_mic', mic.toString());
            setActiveRoom(enableE2EE ? { ...pendingJoin, e2eeKey: generateE2EEKey() } : pendingJoin);
            setPendingJoin(null);
          }}
          onCancel={() => {
            setPendingJoin(null);
            window.history.replaceState({}, '', '/');
          }}
        />
      </Suspense>
    );
  }

  if (isAutoRejoining) {
    return (
      <div className="min-h-[100dvh] bg-slate-950 flex flex-col items-center justify-center text-slate-400">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500 mb-4" />
        <p className="font-medium animate-pulse">Preparing your room...</p>
      </div>
    );
  }

  return (
    <main className="shroom-home min-h-[100dvh] overflow-hidden px-5 py-6 text-white sm:px-8 sm:py-8">
      <div className="shroom-noise" aria-hidden="true" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center">
        <div className="flex items-center gap-3">
          <div className="shroom-mark"><ShroomLogo className="h-5 w-5" /></div>
          <span className="shroom-wordmark text-lg">Shroom</span>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid min-h-[calc(100dvh-7rem)] w-full max-w-6xl items-center gap-14 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20 lg:py-16">
        <div className="shroom-home-content max-w-xl">
          <h1 className="shroom-home-title max-w-[12ch] text-[clamp(3.5rem,6vw,5.5rem)] font-semibold leading-[.98] tracking-[-0.04em] text-white">
            Meet without<br /><span className="text-shroom-primary">the friction.</span>
          </h1>
          <p className="shroom-home-copy mt-6 max-w-md text-base text-white/55 sm:text-lg">Start or join a room from any browser. No downloads, no complicated setup.</p>

          <div className="shroom-entry-shell mt-10 max-w-md">
            {!isAuthenticated ? (
              <form 
                onSubmit={handleJoinLobby} 
                className="shroom-entry-card shroom-name-card shroom-panel-enter space-y-5"
              >
                <div><label className="shroom-eyebrow" htmlFor="display-name">First, what should we call you?</label>
                  <input
                    id="display-name"
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="shroom-input"
                    placeholder="Your display name"
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn || !displayName.trim()}
                  className="shroom-primary-button w-full"
                >
                  {isLoggingIn ? <Loader2 className="w-6 h-6 animate-spin" /> : <>Continue <ArrowRight className="w-5 h-5" /></>}
                </button>
              </form>
            ) : (
              <div 
                className="shroom-entry-card shroom-lobby-card shroom-panel-enter"
              >
                <div className={`shroom-mode-switch is-${mode}`} role="group" aria-label="Choose how to enter a room">
                  <button
                    type="button"
                    onClick={() => setMode('start')}
                    aria-pressed={mode === 'start'}
                    className={`shroom-mode-option ${mode === 'start' ? 'is-active' : ''}`}
                  >
                    <span className="shroom-mode-label"><Video aria-hidden="true" size={14} strokeWidth={1.9} /> Start room</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('join')}
                    aria-pressed={mode === 'join'}
                    className={`shroom-mode-option ${mode === 'join' ? 'is-active' : ''}`}
                  >
                    <span className="shroom-mode-label"><LinkIcon aria-hidden="true" size={14} strokeWidth={1.9} /> Join with link</span>
                  </button>
                </div>

                  {mode === 'start' ? (
                    <div className="shroom-panel-enter">
                      <button
                        onClick={handleCreateRoom}
                        disabled={isCreatingRoom}
                        aria-label="Start Instant Call"
                        className="shroom-primary-button shroom-action-button w-full"
                      >
                        {isCreatingRoom ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Video aria-hidden="true" className="shroom-action-icon" size={15} strokeWidth={1.9} /> Start room</>}
                      </button>
                    </div>
                  ) : (
                    <form 
                      onSubmit={handleJoinExistingRoom}
                      className="shroom-join-form shroom-panel-enter"
                    >
                      <div className="shroom-room-field relative">
                        <div className="shroom-room-field-icon absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                          <LinkIcon aria-hidden="true" className="h-4 w-4 text-white/35" strokeWidth={1.8} />
                        </div>
                        <label htmlFor="room-code" className="sr-only">Room link or code</label>
                        <input
                          id="room-code"
                          type="text"
                          required
                          autoComplete="off"
                          spellCheck={false}
                          value={joinCode}
                          onChange={(e) => setJoinCode(e.target.value.toLowerCase())}
                          className="shroom-input shroom-room-input"
                          placeholder="Paste room link or code"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={isJoining || !joinCode.trim()}
                        aria-label="Join Call"
                        className="shroom-primary-button shroom-action-button w-full"
                      >
                        {isJoining ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Join room <ArrowRight aria-hidden="true" className="shroom-action-arrow" size={15} strokeWidth={1.9} /></>}
                      </button>
                    </form>
                  )}

              </div>
            )}
          </div>

          {displayError && (
            <div 
              id="error-toast" 
              className="shroom-error shroom-panel-enter mt-4"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>{displayError}</p>
            </div>
          )}

        </div>

        <div className="shroom-hero-wrap hidden justify-center lg:flex">
          <div className="shroom-hero-card">
            <div className="flex items-center justify-between text-xs text-white/45"><span className="inline-flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-shroom-primary" /> live room</span><Sparkles className="h-4 w-4 text-shroom-primary" /></div>
            <div className="shroom-hero-screen"><div className="shroom-avatar">S</div><span className="mt-3 text-lg font-medium">You, in focus.</span><span className="mt-1 text-xs text-white/35">No tabs. No noise. Just the room.</span></div>
            <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.06] p-2"><div className="flex gap-2"><span className="shroom-mini-control">◉</span><span className="shroom-mini-control">◌</span><span className="shroom-mini-control">✦</span></div><span className="rounded-xl bg-shroom-primary px-4 py-2 text-xs font-bold text-white">ready</span></div>
          </div>
        </div>
      </section>
    </main>
  );
}
