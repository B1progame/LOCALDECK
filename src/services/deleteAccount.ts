import { forgetShare, savedShares } from './savedShares.ts';
import { firebaseAuthRequest } from './firebaseAuth.ts';
import { authFetch, freshToken } from './session.ts';

/** Deletes everything the sharing service knows about a person, then the sign-in itself.
    False: the data is gone, but Firebase wants a fresh sign-in before it deletes the sign-in. */
export async function deleteAccount(api: string, firebaseKey: string): Promise<boolean> {
  // The service removes a few links per request.
  for (let left = 1, calls = 0; left > 0; calls++) {
    if (calls > 100) throw new Error('The account could not be deleted completely. Try again.');
    let response: Response;
    try { response = await authFetch(`${api}/api/v1/shares/me`, { method: 'DELETE' }); }
    catch { throw new Error('The sharing service is not reachable. Try again.'); }
    if (response.status === 401) throw new Error('Your sign-in expired. Please sign in again.');
    if (!response.ok) throw new Error('The account could not be deleted completely. Try again.');
    left = Number((await response.json() as { left?: number }).left ?? 0);
  }
  for (const id of Object.keys(await savedShares().catch(() => ({})))) await forgetShare(id).catch(() => undefined);
  if (!firebaseKey) return true;
  try { await firebaseAuthRequest(firebaseKey, 'delete', { idToken: await freshToken() ?? '' }); return true; } catch { return false; }
}
