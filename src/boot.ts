import '@fontsource-variable/inter';
import './styles.css';
import { loadLanguage, t } from './i18n';

await loadLanguage();
document.title = t('LocalDeck: your offline library');
await import('./main');
