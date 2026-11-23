type FirebaseAuthResponse = { idToken?: string; email?: string; displayName?: string; users?: Array<{ email?: string; emailVerified?: boolean; displayName?: string }>; error?: { message?: string } };

function messageFor(code: string): string {
  if (code === 'EMAIL_EXISTS') return 'Could not create the account. If you already registered this address, try signing in or resetting your password.';
  if (code === 'INVALID_LOGIN_CREDENTIALS' || code === 'EMAIL_NOT_FOUND' || code === 'INVALID_PASSWORD') return 'The email or password is incorrect.';
  if (code === 'WEAK_PASSWORD') return 'Choose a stronger password with at least 12 characters.';
  if (code === 'TOO_MANY_ATTEMPTS_TRY_LATER') return 'Too many attempts. Wait a little, then try again.';
  if (code === 'USER_DISABLED') return 'This account is disabled.';
  if (code === 'INVALID_EMAIL') return 'Enter a valid email address.';
  if (code === 'OPERATION_NOT_ALLOWED') return 'Email and password sign-in is not enabled in Firebase yet.';
  return 'Email sign-in could not be completed. Check your details and try again.';
}

export async function firebaseAuthRequest(apiKey: string, operation: string, body: Record<string, string | boolean>): Promise<FirebaseAuthResponse> {
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${operation}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json() as FirebaseAuthResponse;
  if (!response.ok) throw new Error(messageFor(result.error?.message ?? 'UNKNOWN'));
  return result;
}
