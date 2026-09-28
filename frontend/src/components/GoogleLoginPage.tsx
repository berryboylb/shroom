import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { authApi } from '../api/auth';
import { useAuth } from '../hooks/useAuth';
import { safeReturnTo } from '../lib/authRedirect';
import { useAuthStore } from '../store/authStore';
import { ShroomLogo } from './ShroomLogo';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
            nonce: string;
            ux_mode: 'popup';
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string | number>) => void;
        };
      };
    };
  }
}

function loadGoogleScript(): Promise<void> {
  if (window.google?.accounts.id) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-shroom-google]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Sign-In could not load.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.shroomGoogle = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Google Sign-In could not load.'));
    document.head.appendChild(script);
  });
}

export function GoogleLoginPage() {
  const buttonRef = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const [setupError, setSetupError] = useState('');
  const [isPreparing, setIsPreparing] = useState(true);
  const [googleButtonWidth, setGoogleButtonWidth] = useState<number | null>(null);
  const { loginGoogle, isLoggingIn, loginError } = useAuth();
  const setSession = useAuthStore(state => state.setSession);
  const returnTo = safeReturnTo(new URLSearchParams(window.location.search).get('returnTo'));

  useEffect(() => {
    let cancelled = false;

    const prepare = async () => {
      if (localStorage.getItem('shroom-account-session') === '1') {
        try {
          const session = await authApi.refresh();
          if (!cancelled && !session.is_guest) {
            setSession(session);
            window.location.assign(returnTo);
            return;
          }
        } catch {
          localStorage.removeItem('shroom-account-session');
        }
      }

      try {
        const config = await authApi.getConfig();
        if (!config.google_enabled || !config.google_client_id) {
          throw new Error('Google Sign-In has not been configured yet.');
        }
        const [{ nonce }] = await Promise.all([authApi.getGoogleNonce(), loadGoogleScript()]);
        if (cancelled || initialized.current || !buttonRef.current || !window.google) return;
        initialized.current = true;
        const renderButton = (loginNonce: string): void => {
          if (cancelled || !buttonRef.current || !window.google) return;
          buttonRef.current.replaceChildren();
          window.google.accounts.id.initialize({
            client_id: config.google_client_id,
            nonce: loginNonce,
            ux_mode: 'popup',
            callback: async ({ credential }) => {
              if (!credential) {
                setSetupError('Google did not return a sign-in credential.');
                return;
              }
              try {
                await loginGoogle(credential);
                window.location.assign(returnTo);
              } catch {
                // The nonce is single-use. Prepare a fresh one so the user can retry.
                try {
                  const next = await authApi.getGoogleNonce();
                  buttonRef.current?.replaceChildren();
                  renderButton(next.nonce);
                } catch {
                  setSetupError('Sign-in could not be restarted. Reload this page and try again.');
                }
              }
            },
          });
          const availableWidth = buttonRef.current.parentElement?.clientWidth ?? 320;
          const mobileWidth = Math.max(200, Math.min(availableWidth, window.innerWidth - 80));
          window.google.accounts.id.renderButton(buttonRef.current, {
            type: 'standard',
            theme: 'outline',
            size: 'large',
            shape: 'pill',
            text: 'continue_with',
            logo_alignment: 'center',
            width: Math.floor(window.innerWidth <= 420 ? mobileWidth : availableWidth),
          });
          requestAnimationFrame(() => {
            const rendered = buttonRef.current?.querySelector<HTMLElement>('iframe, [role="button"]');
            const width = rendered?.getBoundingClientRect().width;
            if (width && Number.isFinite(width)) setGoogleButtonWidth(Math.round(width));
          });
        };
        renderButton(nonce);
      } catch (error) {
        if (!cancelled) setSetupError(error instanceof Error ? error.message : 'Unable to prepare Google Sign-In.');
      } finally {
        if (!cancelled) setIsPreparing(false);
      }
    };

    void prepare();
    return () => { cancelled = true; };
  }, [loginGoogle, returnTo, setSession]);

  return (
    <main className="shroom-home min-h-[100dvh] px-5 py-6 text-white sm:px-8 sm:py-8">
      <div className="shroom-noise" aria-hidden="true" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between">
        <a href="/" className="flex items-center gap-3" aria-label="Shroom home">
          <div className="shroom-mark"><ShroomLogo className="h-5 w-5" /></div>
          <span className="shroom-wordmark text-lg">Shroom</span>
        </a>
        <a href={returnTo} className="shroom-header-button inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm">
          <ArrowLeft className="h-4 w-4" /> Back
        </a>
      </header>

      <section className="relative z-10 mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-md items-center justify-center py-12">
        <div className="shroom-login-card w-full rounded-3xl p-6 text-center sm:p-8">
          <div className="shroom-mark shroom-login-mark mx-auto mb-5">
            <ShroomLogo className="h-7 w-7" />
          </div>
          <h1 className="font-display text-base font-semibold leading-tight sm:text-2xl">Log in to Shroom</h1>
          <p className="mt-2 text-[11px] leading-4 text-white/55 sm:text-sm sm:leading-6">Use your Google account once, then come back without entering your name again.</p>

          <div className="mt-7 flex min-h-11 items-center justify-center" aria-live="polite">
            <div ref={buttonRef} className="shroom-google-button" />
            {(isPreparing || isLoggingIn) && <Loader2 className="h-6 w-6 animate-spin text-blue-400" aria-label="Preparing Google Sign-In" />}
          </div>

          {(setupError || loginError) && (
            <div role="alert" className="shroom-error mt-5 text-left">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>{setupError || loginError?.message}</p>
            </div>
          )}

          <a
            href={returnTo}
            style={googleButtonWidth ? { width: `${googleButtonWidth}px` } : undefined}
            className="shroom-secondary-button shroom-login-action mt-6 min-h-11 text-sm"
          >
            Continue as guest
          </a>
          <p className="mt-3 text-xs leading-5 text-white/40">No account is required to join a meeting.</p>
        </div>
      </section>
    </main>
  );
}
