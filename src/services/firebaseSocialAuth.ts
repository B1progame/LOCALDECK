import { initializeApp, getApps } from '@firebase/app';
import {
  browserPopupRedirectResolver,
  browserSessionPersistence,
  FacebookAuthProvider,
  getAuth,
  GithubAuthProvider,
  GoogleAuthProvider,
  initializeAuth,
  reload,
  sendEmailVerification,
  signInWithPopup,
  type Auth,
  type UserCredential,
} from '@firebase/auth';
import { language } from '../i18n';
import { requestBrandedMail } from './verificationMail';

export type FirebaseSocialProvider = 'google' | 'github' | 'facebook';
export type FirebaseSocialConfig = { apiKey: string; projectId: string; appId: string };
export type SocialSignIn = { token?: string; refresh?: string; verificationSent?: boolean };

const APP_NAME = 'localdeck-sharing-auth';
let prepared: Promise<Auth> | null = null;

function createAuth(config: FirebaseSocialConfig): Auth {
  const existing = getApps().find(candidate => candidate.name === APP_NAME);
  if (existing) return getAuth(existing);
  const app = initializeApp({ apiKey: config.apiKey, authDomain: `${config.projectId}.firebaseapp.com`, projectId: config.projectId, appId: config.appId }, APP_NAME);
  return initializeAuth(app, { persistence: browserSessionPersistence, popupRedirectResolver: browserPopupRedirectResolver });
}

/** Loads everything the sign-in window needs before the first click.
    Firebase otherwise fetches its scripts during the click. Safari then no longer counts the window as
    opened by the user and blocks it, so people had to sign in twice. */
export function prepareSocialSignIn(config: FirebaseSocialConfig): Promise<Auth> {
  prepared ??= (async () => {
    const auth = createAuth(config);
    await auth.authStateReady();
    // Not part of Firebase's public types. Without it, only the preloading is lost.
    const resolver = (auth as unknown as { _popupRedirectResolver?: { _initialize?: (auth: Auth) => Promise<unknown> } })._popupRedirectResolver;
    await resolver?._initialize?.(auth);
    return auth;
  })().catch(error => { prepared = null; throw error; });
  return prepared;
}

function createProvider(name: FirebaseSocialProvider) {
  const provider = name === 'google' ? new GoogleAuthProvider() : name === 'github' ? new GithubAuthProvider() : new FacebookAuthProvider();
  provider.addScope(name === 'github' ? 'user:email' : 'email');
  return provider;
}

async function finishSignIn({ user }: UserCredential): Promise<SocialSignIn> {
  await reload(user);
  if (!user.email) throw new Error('The provider did not share an email address. Add an email to that account and allow LocalDeck to use it.');
  if (!user.emailVerified) {
    if (!await requestBrandedMail(await user.getIdToken())) await sendEmailVerification(user, { url: `${window.location.origin}${import.meta.env.BASE_URL}#/sharing` });
    return { verificationSent: true };
  }
  return { token: await user.getIdToken(true), refresh: user.refreshToken };
}

/** Must run directly inside the click: nothing may be awaited before the window opens.
    There is no redirect fallback. Browsers keep github.io and firebaseapp.com apart, so the result of a
    redirect never reaches this page. */
export function openSocialSignIn(auth: Auth, name: FirebaseSocialProvider): Promise<SocialSignIn> {
  auth.languageCode = language();
  return signInWithPopup(auth, createProvider(name)).then(finishSignIn);
}

/** Firebase keeps its own copy of the sign-in until the tab is closed. */
export async function forgetSocialSignIn(): Promise<void> { await (await prepared)?.signOut(); }
