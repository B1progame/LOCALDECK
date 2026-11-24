/* Creates a Firebase confirmation link and hands it to the mail relay (email/apps-script/Code.gs).
   The service account stays in this Worker. The relay only ever sees an address and a link. */

export interface MailEnv {
  /** JSON key of a service account that only has the "Firebase Authentication Admin" role. */
  FIREBASE_SERVICE_ACCOUNT?: string;
  /** Apps Script web app address ending in /exec. */
  MAIL_RELAY_URL?: string;
  MAIL_RELAY_SECRET?: string;
  /** LocalDeck address with the final slash. The link in the email opens this page. */
  APP_URL?: string;
}

type ServiceAccount = { client_email: string; private_key: string; project_id: string };

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const encodeJson = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)));

async function accessToken(account: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${encodeJson({ alg: 'RS256', typ: 'JWT' })}.${encodeJson({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/identitytoolkit', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 600 })}`;
  const der = Uint8Array.from(atob(account.private_key.replace(/-----[^-]+-----|\s/g, '')), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = toBase64Url(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned))));
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }) });
  if (!response.ok) throw new Error(`service_account_rejected_${response.status}`);
  return (await response.json() as { access_token: string }).access_token;
}

export async function sendVerificationLink(env: MailEnv, email: string, name: string, language: string): Promise<void> {
  const account = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT!) as ServiceAccount;
  const created = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/accounts:sendOobCode`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${await accessToken(account)}` },
    body: JSON.stringify({ requestType: 'VERIFY_EMAIL', email, returnOobLink: true }),
  });
  if (!created.ok) throw new Error(`link_rejected_${created.status}`);
  const code = new URL((await created.json() as { oobLink: string }).oobLink).searchParams.get('oobCode');
  if (!code) throw new Error('link_without_code');
  const link = `${env.APP_URL}?mode=verifyEmail&oobCode=${encodeURIComponent(code)}`;

  const sent = await fetch(env.MAIL_RELAY_URL!, { method: 'POST', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ secret: env.MAIL_RELAY_SECRET, to: email, name: name.slice(0, 60), link, language }) });
  if (!sent.ok) throw new Error(`relay_status_${sent.status}`);
  // Apps Script answers errors with status 200 and an HTML page, so only a clear yes counts.
  const result = await sent.json().catch(() => null) as { ok?: boolean; error?: string } | null;
  if (result?.ok !== true) throw new Error(`relay_${result?.error ?? 'bad_answer'}`);
}
