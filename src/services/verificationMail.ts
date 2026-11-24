import { language } from '../i18n';
import { firebaseAuthRequest } from './firebaseAuth';

/** Asks the sharing Worker for the LocalDeck email. False means: let Firebase send its own email instead. */
export async function requestBrandedMail(idToken: string): Promise<boolean> {
  const api = (import.meta.env.VITE_SHARE_API_BASE ?? '').replace(/\/$/, '');
  if (!api) return false;
  let response: Response;
  try { response = await fetch(`${api}/api/v1/shares/auth/verification`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ credential: idToken, language: language() }) }); }
  catch { return false; }
  if (response.ok) return true;
  const { error } = await response.json().catch(() => ({})) as { error?: string };
  if (error === 'mail_wait') throw new Error('We sent you a link a moment ago. Check your inbox and spam folder, or wait two minutes for a new one.');
  return false;
}

/** Sends the confirmation email. Firebase's own email is the fallback, so sign-up always works. */
export async function sendVerificationMail(apiKey: string, idToken: string): Promise<void> {
  if (await requestBrandedMail(idToken)) return;
  await firebaseAuthRequest(apiKey, 'sendOobCode', { requestType: 'VERIFY_EMAIL', idToken });
}
