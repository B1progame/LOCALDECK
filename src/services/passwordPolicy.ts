/* Password rules for LocalDeck share accounts.
   Keep these in step with Firebase → Authentication → Settings → Password policy
   (uppercase, lowercase and special character required; the app asks for 12+ characters). */

export type PasswordRule = { id: string; label: string; test: (password: string) => boolean };

/** Firebase's list of accepted special characters. */
const SPECIAL = /[\^$*.[\]{}()?"!@#%&/\\,><':;|_~`=+-]/;

export const PASSWORD_RULES: PasswordRule[] = [
  { id: 'length', label: '12+ characters', test: p => p.length >= 12 },
  { id: 'upper', label: 'An uppercase letter', test: p => /[A-Z]/.test(p) },
  { id: 'lower', label: 'A lowercase letter', test: p => /[a-z]/.test(p) },
  { id: 'special', label: 'A symbol like ! ? # @', test: p => SPECIAL.test(p) },
];

/** Labels of the rules a password does not meet yet. */
export function missingRules(password: string): string[] {
  return PASSWORD_RULES.filter(rule => !rule.test(password)).map(rule => rule.label.charAt(0).toLowerCase() + rule.label.slice(1));
}

export function passwordProblem(password: string): string | null {
  const missing = missingRules(password);
  return missing.length ? `Your password still needs ${missing.join(', ')}.` : null;
}
