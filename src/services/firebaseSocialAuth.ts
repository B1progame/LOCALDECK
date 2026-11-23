import { initializeApp, getApps } from '@firebase/app';
import {
  browserSessionPersistence,
  FacebookAuthProvider,
  getAuth,
  getRedirectResult,
  GithubAuthProvider,
  GoogleAuthProvider,
  reload,
  sendEmailVerification,
  setPersistence,
  signInWithPopup,
  signInWithRedirect,
  type UserCredential,
} from '@firebase/auth';

export type FirebaseSocialProvider = 'google' | 'github' | 'facebook';
export type FirebaseSocialConfig = { apiKey: string; projectId: string; appId: string };
export type FirebaseSocialProfile = { email: string; name: string; picture: string };
let redirectResultCheck: Promise<{ token?: string; profile?: FirebaseSocialProfile; verificationSent?: boolean } | null> | null = null;

function getAuthClient(config: FirebaseSocialConfig) {
  const appName = 'localdeck-sharing-auth';
  const app = getApps().find(candidate => candidate.name === appName) ?? initializeApp({
    apiKey: config.apiKey,
    authDomain: `${config.projectId}.firebaseapp.com`,
    projectId: config.projectId,
    appId: config.appId,
  }, appName);
  return getAuth(app);
}

function createProvider(providerName: FirebaseSocialProvider) {
  const provider = providerName === 'google'
    ? new GoogleAuthProvider()
    : providerName === 'github' ? new GithubAuthProvider() : new FacebookAuthProvider();
  provider.addScope(providerName === 'github' ? 'user:email' : 'email');
  return provider;
}

async function finishSignIn(result: UserCredential): Promise<{ token?: string; profile?: FirebaseSocialProfile; verificationSent?: boolean }> {
  const user = result.user;
  await reload(user);
  if (!user.email) {
    throw new Error('The provider did not share an email address. Add an email to that account and allow LOCALDECK to use it.');
  }
  if (!user.emailVerified) {
    await sendEmailVerification(user, { url: `${window.location.origin}${import.meta.env.BASE_URL}#/sharing` });
    return { verificationSent: true };
  }
  return {
    token: await user.getIdToken(true),
    profile: { email: user.email, name: user.displayName || user.email, picture: user.photoURL || '' },
  };
}

/** Opens the provider in a popup. Resolves null when the browser forced a redirect instead. */
export async function beginFirebaseSocialSignIn(providerName: FirebaseSocialProvider, config: FirebaseSocialConfig): Promise<{ token?: string; profile?: FirebaseSocialProfile; verificationSent?: boolean } | null> {
  const auth = getAuthClient(config);
  await setPersistence(auth, browserSessionPersistence);
  auth.useDeviceLanguage();
  try {
    return await finishSignIn(await signInWithPopup(auth, createProvider(providerName)));
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, createProvider(providerName));
      return null;
    }
    throw error;
  }
}

export async function finishFirebaseSocialSignIn(config: FirebaseSocialConfig) {
  if (!redirectResultCheck) redirectResultCheck = (async () => {
    const auth = getAuthClient(config);
    await setPersistence(auth, browserSessionPersistence);
    const result = await getRedirectResult(auth);
    return result ? finishSignIn(result) : null;
  })();
  return redirectResultCheck;
}
