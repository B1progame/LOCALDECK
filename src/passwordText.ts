import { t } from './i18n';
import { PASSWORD_RULES } from './services/passwordPolicy';

/** What a password still needs, in the language of the app. Null when it meets every rule. */
export function passwordMessage(password: string): string | null {
  const missing = PASSWORD_RULES.filter(rule => !rule.test(password)).map(rule => t(rule.label));
  return missing.length ? t('Your password still needs: {0}.', missing.join(', ')) : null;
}
