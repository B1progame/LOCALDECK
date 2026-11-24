/* Sign-in / create-account screen for sharing. The two modes look clearly different and animate between each other. */
import { t, tm } from './i18n';
import React, { useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Check, Clock3, Eye, EyeOff, KeyRound, LoaderCircle, Mail, ShieldCheck, Sparkles, UserRound, WandSparkles } from 'lucide-react';
import { firebaseAuthRequest } from './services/firebaseAuth';
import { sendVerificationMail } from './services/verificationMail';
import { rovingKeys } from './a11y';
import { useProfile } from './profile';
import { PASSWORD_RULES } from './services/passwordPolicy';
import { passwordMessage } from './passwordText';
import { ShareArt } from './shareArt';

export type AuthMode = 'signin' | 'signup';
export const EMAIL_FOR_LINK_KEY = 'localdeck-email-for-signin';


export function LoginExperience({ apiKey, social, onCredential, error, backHref }: {
  apiKey: string;
  social: (mode: AuthMode) => React.ReactNode;
  onCredential: (credential: string) => Promise<void>;
  error?: string;
  backHref: string;
}) {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState<'' | 'submit' | 'link' | 'reset'>('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  const rulesMet = PASSWORD_RULES.filter(rule => rule.test(password)).length;
  // Measure the active form so the card height glides instead of snapping when switching modes.
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  useLayoutEffect(() => {
    const el = inner.current; if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const switchMode = (next: AuthMode) => { setMode(next); setFormError(''); setMessage(''); setPassword(''); setConfirm(''); };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setFormError(''); setMessage(''); setBusy('submit');
    try {
      if (mode === 'signup') {
        const name = username.trim();
        if (!/^[\p{L}\p{N} ._-]{2,30}$/u.test(name)) throw new Error(t('Choose a username with 2–30 letters, numbers, spaces, dots, dashes or underscores.'));
        const problem = passwordMessage(password);
        if (problem) throw new Error(problem);
        if (password !== confirm) throw new Error(t('The two passwords do not match.'));
        const created = await firebaseAuthRequest(apiKey, 'signUp', { email: email.trim(), password, returnSecureToken: true });
        if (!created.idToken) throw new Error(t('Firebase did not return an account session.'));
        await firebaseAuthRequest(apiKey, 'update', { idToken: created.idToken, displayName: name, returnSecureToken: false }).catch(() => undefined);
        await sendVerificationMail(apiKey, created.idToken);
        if (!useProfile.getState().name) useProfile.getState().update({ name });
        setMessage(t('Welcome, {0}! We sent a confirmation link to {1}. Open it, then sign in here.', name, email.trim()));
        setPassword(''); setConfirm(''); setMode('signin');
      } else {
        const result = await firebaseAuthRequest(apiKey, 'signInWithPassword', { email: email.trim(), password, returnSecureToken: true });
        if (!result.idToken || !result.email) throw new Error(t('Email sign-in could not be completed.'));
        const account = await firebaseAuthRequest(apiKey, 'lookup', { idToken: result.idToken });
        if (account.users?.[0]?.emailVerified !== true) {
          await sendVerificationMail(apiKey, result.idToken);
          throw new Error(t('Confirm your email first. We just sent you a fresh link.'));
        }
        setPassword('');
        await onCredential(result.idToken);
      }
    } catch (reason) { setFormError(reason instanceof Error ? tm(reason.message) : t('That did not work. Please try again.')); }
    finally { setBusy(''); }
  };

  const sendLink = async () => {
    setFormError(''); setMessage('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setFormError(t('Enter your email address first.')); return; }
    setBusy('link');
    try {
      await firebaseAuthRequest(apiKey, 'sendOobCode', { requestType: 'EMAIL_SIGNIN', email: email.trim(), continueUrl: `${location.origin}${import.meta.env.BASE_URL}`, canHandleCodeInApp: true });
      try { localStorage.setItem(EMAIL_FOR_LINK_KEY, email.trim()); } catch { /* the link page will ask for the email */ }
      setMessage(t('Sign-in link sent to {0}. Open it on this device and you’re signed in, no password needed.', email.trim()));
    } catch (reason) {
      const text = reason instanceof Error ? reason.message : '';
      setFormError(/not enabled/i.test(text) ? t('Email-link sign-in isn’t switched on yet. In Firebase → Authentication → Email/Password, enable “Email link (passwordless sign-in)”.') : tm(text) || t('The sign-in link could not be sent.'));
    } finally { setBusy(''); }
  };

  const reset = async () => {
    setFormError(''); setMessage('');
    if (!email.trim()) { setFormError(t('Enter your email address first.')); return; }
    setBusy('reset');
    try { await firebaseAuthRequest(apiKey, 'sendOobCode', { requestType: 'PASSWORD_RESET', email: email.trim() }); setMessage(t('If an account uses that address, a password reset link is on its way.')); }
    catch (reason) { setFormError(reason instanceof Error ? tm(reason.message) : t('Could not send a reset link.')); }
    finally { setBusy(''); }
  };

  const signup = mode === 'signup';
  return <section className={`share-login-card share-login-card-full auth-card beam mode-${mode}`}>
    <div className="share-login-art auth-art">
      <ShareArt mode={mode}/>
    </div>
    <div className="share-login-content auth-content">
      <a className="login-back-link" href={backHref}><ArrowLeft size={15}/> {t('Back to shared links')}</a>
      <div className="auth-switch" role="tablist" aria-label={t('Account')} onKeyDown={event => rovingKeys(event, '[role="tab"]', true)}>
        {(['signin', 'signup'] as const).map(value => <button key={value} id={`auth-tab-${value}`} type="button" role="tab" aria-selected={mode === value} aria-controls="auth-panel" tabIndex={mode === value ? 0 : -1} className={mode === value ? 'active' : ''} onClick={() => switchMode(value)}>
          {mode === value && <motion.span layoutId="auth-pill" className="auth-pill" transition={{ type: 'spring', bounce: .25, visualDuration: .35 }}/>}
          {value === 'signin' ? <><KeyRound size={15}/> {t('Sign in')}</> : <><Sparkles size={15}/> {t('Create account')}</>}
        </button>)}
      </div>
      <motion.div className="auth-stage" animate={{ height }} transition={{ type: 'spring', bounce: 0, visualDuration: .45 }}>
      <div ref={inner} className="auth-stage-inner" id="auth-panel" role="tabpanel" aria-labelledby={`auth-tab-${mode}`}>
      <AnimatePresence mode="popLayout" initial={false} custom={signup}>
        <motion.div key={mode} className="auth-body" custom={signup}
          variants={{ enter: (toSignup: boolean) => ({ opacity: 0, x: toSignup ? 40 : -40 }), center: { opacity: 1, x: 0 }, exit: (toSignup: boolean) => ({ opacity: 0, x: toSignup ? -40 : 40 }) }}
          initial="enter" animate="center" exit="exit" transition={{ type: 'spring', bounce: 0, visualDuration: .4 }}>
          <span className={`share-login-kicker ${signup ? 'kicker-new' : ''}`}>{signup ? <><Sparkles size={14}/> {t('FREE · NO CARD NEEDED')}</> : <><ShieldCheck size={14}/> {t('PRIVATE BY DESIGN')}</>}</span>
          <h2>{signup ? <>{t('Create your')}<br/><em>{t('free account.')}</em></> : <>{t('Welcome')}<br/><em>{t('back to LocalDeck.')}</em></>}</h2>
          <p>{signup ? t('Only needed for sharing links. Your library itself never leaves this device.') : t('Sign in to create and manage encrypted links. People you send a link to don’t need an account.')}</p>
          {signup && <ul className="auth-perks"><li><Check size={14}/> {t('Encrypted share links')}</li><li><Check size={14}/> {t('Free storage included')}</li><li><Check size={14}/> {t('No ads, no tracking')}</li></ul>}
          {social(mode)}
          <div className="auth-divider"><span>{signup ? t('or sign up with email') : t('or with email')}</span></div>
          <form onSubmit={event => void submit(event)} className="auth-form">
            {signup && <label className="email-auth-field"><span>{t('Username')}</span><span className="auth-input"><UserRound size={16}/><input value={username} onChange={e => setUsername(e.target.value)} autoComplete="nickname" placeholder={t('How LocalDeck greets you')} required minLength={2} maxLength={30}/></span></label>}
            <label className="email-auth-field"><span>{t('Email address')}</span><span className="auth-input"><Mail size={16}/><input type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required maxLength={254}/></span></label>
            <label className="email-auth-field"><span className="auth-label-row">{t('Password')}{!signup && <button type="button" className="text-button" disabled={Boolean(busy)} onClick={() => void reset()}>{t('Forgot?')}</button>}</span>
              <span className="auth-input"><KeyRound size={16}/><input type={show ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={signup ? 12 : 1} maxLength={128} placeholder={signup ? t('12+ characters, A–z and a symbol') : ''}/><button type="button" className="icon-button auth-eye" onClick={() => setShow(v => !v)} aria-label={show ? t('Hide password') : t('Show password')}>{show ? <EyeOff size={16}/> : <Eye size={16}/>}</button></span></label>
            {signup && <>
              <div className={`auth-meter s${password ? Math.min(5, rulesMet + (rulesMet === PASSWORD_RULES.length && password.length >= 16 ? 1 : 0)) : 0}`} aria-hidden="true"><span><i/><i/><i/><i/><i/></span></div>
              <ul className="pw-rules" aria-label={t('Password requirements')}>{PASSWORD_RULES.map(rule => { const ok = rule.test(password); return <li key={rule.id} className={ok ? 'ok' : ''}>{ok ? <Check size={13} aria-hidden="true"/> : <span className="pw-dot" aria-hidden="true"/>}{t(rule.label)}<span className="visually-hidden">{ok ? t(' (done)') : t(' (missing)')}</span></li>; })}</ul>
              <label className="email-auth-field"><span>{t('Repeat password')}</span><span className={`auth-input ${confirm && confirm !== password ? 'mismatch' : confirm ? 'match' : ''}`}><KeyRound size={16}/><input type={show ? 'text' : 'password'} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required maxLength={128}/>{confirm && confirm === password && <Check size={16} className="auth-ok"/>}</span></label>
              {confirm && confirm !== password && <p className="field-hint error" role="alert">{t('The passwords don’t match yet.')}</p>}
            </>}
            <button className="button primary auth-submit" disabled={Boolean(busy)}>{busy === 'submit' ? <LoaderCircle size={16} className="spin"/> : signup ? <Sparkles size={16}/> : <ShieldCheck size={16}/>} {busy === 'submit' ? t('Please wait…') : signup ? t('Create free account') : t('Sign in')} {!busy && <ArrowRight size={16}/>}</button>
          </form>
          {!signup && <button type="button" className="auth-magic" disabled={Boolean(busy)} onClick={() => void sendLink()}>{busy === 'link' ? <LoaderCircle size={15} className="spin"/> : <WandSparkles size={15}/>} {t('Email me a sign-in link instead')}</button>}
          {formError && <p className="dialog-error" role="alert">{formError}</p>}
          {error && <p className="dialog-error" role="alert">{error}</p>}
          {message && <p className="email-auth-message" role="status">{message}</p>}
          <p className="auth-switch-hint">{signup ? <>{t('Already have an account?')} <button type="button" className="text-button" onClick={() => switchMode('signin')}>{t('Sign in')}</button></> : <>{t('New here?')} <button type="button" className="text-button" onClick={() => switchMode('signup')}>{t('Create a free account')}</button></>}</p>
        </motion.div>
      </AnimatePresence>
      </div>
      </motion.div>
      <div className="share-login-foot"><span><ShieldCheck size={14}/> {t('Encrypted before upload')}</span><span><Clock3 size={14}/> {t('Links expire by themselves')}</span></div>
      <p className="auth-privacy">{t('The operator of this sharing service sees your name, email address and usage, but never your projects.')}</p>
    </div>
  </section>;
}
