import '@fontsource-variable/inter';
import './styles.css';
import { loadLanguage, t } from './i18n';

await loadLanguage();
document.title = t('LocalDeck: your offline library');
let framed = true;
try { framed = window.top !== window.self; } catch { /* another website */ }
if (framed) {
  // Another website could cover the buttons and make people press them.
  const note = document.createElement('p'), link = document.createElement('a');
  note.className = 'framed-note';
  note.textContent = `${t('LocalDeck does not run inside other websites, to protect your account.')} `;
  link.href = location.href; link.target = '_top'; link.textContent = t('Open LocalDeck');
  note.append(link);
  document.getElementById('root')?.replaceChildren(note);
} else await import('./main');
