/* "Continue with Google" and the other sign-in windows. */
import React, { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Auth } from '@firebase/auth';
import { openSocialSignIn, prepareSocialSignIn, type FirebaseSocialConfig, type FirebaseSocialProvider } from './services/firebaseSocialAuth';

function GoogleLogo() {
  return <svg className="google-logo" viewBox="0 0 48 48" width="18" height="18" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
  </svg>;
}

function explain(error: unknown): string {
  switch ((error as { code?: string })?.code) {
    case 'auth/popup-blocked': return 'Your browser blocked the sign-in window. Allow pop-ups for this site, then try again.';
    case 'auth/operation-not-allowed': return 'This sign-in option is not switched on yet.';
    case 'auth/unauthorized-domain': return 'Sign-in is not allowed on this address yet.';
    case 'auth/account-exists-with-different-credential': return 'This email is already registered with another sign-in method. Use that method instead.';
    case 'auth/user-cancelled': case 'auth/popup-closed-by-user': case 'auth/cancelled-popup-request': return 'Sign-in was cancelled.';
    case 'auth/network-request-failed': case 'auth/internal-error': return 'Could not reach the sign-in service. Check your internet connection or content blocker.';
    default: return error instanceof Error ? error.message : 'Sign-in could not be completed. Try again.';
  }
}

export function FirebaseSocialButtons({ config, githubEnabled, facebookEnabled, onCredential, verb = 'continue', bare = false }: {
  config: FirebaseSocialConfig; githubEnabled: boolean; facebookEnabled: boolean;
  onCredential: (credential: string) => Promise<void>; verb?: 'continue' | 'signup'; bare?: boolean;
}) {
  const auth = useRef<Auth | null>(null);
  const [stage, setStage] = useState<'preparing' | 'ready' | 'failed'>('preparing');
  const [busy, setBusy] = useState<FirebaseSocialProvider | null>(null);
  // Firebase notices a closed window only after several seconds, so a new click replaces the old attempt.
  const attempt = useRef(0);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const { apiKey, projectId, appId } = config;

  const prepare = React.useCallback(() => {
    setStage('preparing');
    return prepareSocialSignIn({ apiKey, projectId, appId }).then(value => { auth.current = value; setStage('ready'); }, error => { setStage('failed'); throw error; });
  }, [apiKey, projectId, appId]);
  useEffect(() => { prepare().catch(() => undefined); }, [prepare]);

  const connect = (provider: FirebaseSocialProvider) => {
    if (!auth.current) {
      prepare().then(() => setMessage('Sign-in is ready now. Choose the button once more.'), error => setMessage(explain(error)));
      return;
    }
    const opened = openSocialSignIn(auth.current, provider);
    const current = ++attempt.current;
    const latest = () => attempt.current === current;
    setBusy(provider); setMessage('');
    opened.then(async result => {
      if (!latest()) return;
      setChecking(true);
      if (result.verificationSent) setMessage('Check your email and confirm the address. Then come back and choose the same sign-in option again.');
      else if (result.token) await onCredential(result.token);
    }).catch(error => { if (latest()) setMessage(explain(error)); }).finally(() => { if (latest()) { setBusy(null); setChecking(false); } });
  };

  const button = (provider: FirebaseSocialProvider, name: string, mark: React.ReactNode) => <button type="button" className="social-auth-button" disabled={checking || stage === 'preparing'} onClick={() => connect(provider)}>
    {busy === provider || (stage === 'preparing' && provider === 'google') ? <LoaderCircle size={15} className="spin"/> : mark} {verb === 'signup' ? `Sign up with ${name}` : `Continue with ${name}`}
  </button>;

  return <div className="social-auth-panel">
    {!bare && <div className="auth-divider"><span>continue with a free account</span></div>}
    <div className="social-auth-buttons">
      {button('google', 'Google', <GoogleLogo/>)}
      {githubEnabled && button('github', 'GitHub', <span className="social-provider-mark github-mark" aria-hidden="true">GH</span>)}
      {facebookEnabled && button('facebook', 'Facebook', <span className="social-provider-mark facebook-mark" aria-hidden="true">f</span>)}
    </div>
    {message && <p className="email-auth-message" role="status">{message}</p>}
    {(githubEnabled || facebookEnabled) && <p className="social-auth-help">GitHub and Facebook sign-ins must confirm the email address they share with Firebase.</p>}
  </div>;
}
