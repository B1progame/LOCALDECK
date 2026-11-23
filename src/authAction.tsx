/* Handles Firebase email action links (verify email, reset password) inside LOCALDECK,
   so the link in the email opens a branded page instead of the default Firebase screen. */
import React, { useEffect, useState } from 'react';
import { ArrowRight, Check, KeyRound, LoaderCircle, MailCheck, ShieldAlert } from 'lucide-react';
import { firebaseAuthRequest } from './services/firebaseAuth';
import { base } from './shared';

export type AuthAction = { mode: 'verifyEmail' | 'resetPassword' | 'recoverEmail'; oobCode: string; apiKey: string };

export function readAuthAction(): AuthAction | null {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  const oobCode = params.get('oobCode');
  const apiKey = params.get('apiKey') || import.meta.env.VITE_FIREBASE_API_KEY || '';
  if (!oobCode || !apiKey || (mode !== 'verifyEmail' && mode !== 'resetPassword' && mode !== 'recoverEmail')) return null;
  return { mode, oobCode, apiKey };
}

/** Removes the one-time code from the address bar and continues to a page of the app. */
function leave(hash: string) {
  history.replaceState(null, '', `${location.pathname}#/${hash}`);
  location.reload();
}

export function AuthActionPage({ action }: { action: AuthAction }) {
  const [state, setState] = useState<'working' | 'form' | 'done' | 'error'>(action.mode === 'resetPassword' ? 'working' : 'working');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        if (action.mode === 'resetPassword') {
          const result = await firebaseAuthRequest(action.apiKey, 'resetPassword', { oobCode: action.oobCode });
          if (active) { setEmail(result.email ?? ''); setState('form'); }
        } else {
          const result = await firebaseAuthRequest(action.apiKey, 'update', { oobCode: action.oobCode });
          if (active) { setEmail(result.email ?? ''); setState('done'); }
        }
      } catch {
        if (active) { setError('This link has expired or was already used. Request a new one from the sign-in page.'); setState('error'); }
      }
    })();
    return () => { active = false; };
  }, [action]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError('');
    if (password.length < 12) { setError('Choose a password with at least 12 characters.'); return; }
    if (password !== confirm) { setError('The two passwords do not match.'); return; }
    setBusy(true);
    try { await firebaseAuthRequest(action.apiKey, 'resetPassword', { oobCode: action.oobCode, newPassword: password }); setState('done'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The password could not be changed.'); }
    finally { setBusy(false); }
  };

  const title = action.mode === 'resetPassword'
    ? state === 'done' ? 'Your password is updated.' : 'Choose a new password.'
    : action.mode === 'recoverEmail' ? 'Your email address is restored.' : state === 'done' ? 'Your email is verified.' : 'Verifying your email…';

  return <div className="login-page-wrap">
    <a className="login-brand" href={`${base}#/home`}><img src={`${base}icon-192.png`} alt=""/> localdeck</a>
    <section className="auth-action-card">
      <span className={`auth-action-icon ${state}`}>
        {state === 'working' ? <LoaderCircle size={26} className="spin"/> : state === 'error' ? <ShieldAlert size={26}/> : state === 'form' ? <KeyRound size={26}/> : action.mode === 'verifyEmail' ? <MailCheck size={26}/> : <Check size={26}/>}
      </span>
      <h1>{state === 'error' ? 'This link no longer works.' : title}</h1>
      {state === 'working' && <p>One moment while we confirm the link.</p>}
      {state === 'error' && <p>{error}</p>}
      {state === 'done' && <p>{email ? <><b>{email}</b> is ready. </> : null}{action.mode === 'resetPassword' ? 'Sign in with your new password to manage your shared links.' : 'You can now sign in and create encrypted share links.'}</p>}
      {state === 'form' && <form onSubmit={event => void submit(event)} className="auth-action-form">
        <p>Resetting the password for <b>{email}</b>.</p>
        <label className="email-auth-field"><span>New password</span><input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} minLength={12} maxLength={128} required/></label>
        <label className="email-auth-field"><span>Repeat new password</span><input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} minLength={12} maxLength={128} required/></label>
        <div className="password-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, password.length / 16 * 100)}%` }} className={password.length >= 12 ? 'ok' : ''}/></div>
        {error && <p className="dialog-error" role="alert">{error}</p>}
        <button className="button primary email-auth-submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin"/> : <KeyRound size={15}/>} Save new password</button>
      </form>}
      {(state === 'done' || state === 'error') && <button className="button primary auth-action-continue" onClick={() => leave('login')}>Continue to sign in <ArrowRight size={16}/></button>}
      <button className="text-button" onClick={() => leave('home')}>Open my library</button>
    </section>
  </div>;
}
