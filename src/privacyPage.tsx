/* What LocalDeck stores, where, and whom it contacts. Keep it in step with the code. */
import { t } from './i18n';
import { PageHeading } from './shared';

const OPERATOR = (import.meta.env.VITE_OPERATOR_NAME ?? '').trim();
const CONTACT = (import.meta.env.VITE_OPERATOR_CONTACT ?? '').trim();
const ISSUES = 'https://github.com/B1progame/LOCALDECK/issues';

function Contact() {
  const href = /^https?:\/\//.test(CONTACT) ? CONTACT : /^[^\s@]+@[^\s@]+$/.test(CONTACT) ? `mailto:${CONTACT}` : '';
  if (CONTACT) return <p>{OPERATOR && <>{OPERATOR}<br/></>}{href ? <a href={href}>{CONTACT}</a> : CONTACT}</p>;
  return <p>{OPERATOR && <>{OPERATOR}<br/></>}<a href={ISSUES} target="_blank" rel="noopener noreferrer">{t('Contact through the project page on GitHub')}</a>. {t('Messages there are public, so do not write private data.')}</p>;
}

export function PrivacyPage() {
  const sections: Array<{ title: string; text?: string[]; list?: string[]; contact?: boolean }> = [
    { title: t('In short'), list: [
      t('LocalDeck works without an account. Your projects stay in this browser.'),
      t('LocalDeck sets no cookies. There is no advertising, no tracking and no statistics about visitors of the website.'),
      t('That is why there is no cookie banner. What is saved on your device is only what the app needs to work.'),
      t('An account is only needed for creating shared links and for connecting an AI.'),
    ] },
    { title: t('Who is responsible'), contact: true },
    { title: t('What is stored on your device'), list: [
      t('Your projects, collections, history and the keys of your links (browser database).'),
      t('Settings such as theme, language and view (browser storage).'),
      t('Your sign-in, until you sign out (browser storage). Without “Stay signed in” only until you close the tab.'),
      t('A copy of the app for offline use, and the model of the local AI if you set it up (browser cache).'),
      t('You can delete all of it in your browser under “Site data”. The model can also be deleted in Settings.'),
    ] },
    { title: t('When you open the website'), text: [t('The website is hosted by GitHub Pages. GitHub sees your IP address and which files you load, as every web server does.')] },
    { title: t('When you sign in'), text: [
      t('The sign-in page loads the sign-in of Google Firebase (apis.google.com and firebaseapp.com). Google sees your IP address then and may set its own cookies on its own pages. GitHub or Facebook are contacted only when you choose them.'),
      t('The sharing service runs on Cloudflare. It stores your name, email address, sign-in method, the times of your sign-ins and how much you use. The operator can see that. It never sees your password.'),
      t('To prevent abuse, your IP address is stored as a code that cannot be read back, for at most two days.'),
      t('Accounts that were not used for 180 days and have no links are deleted.'),
    ] },
    { title: t('When you share a project'), text: [
      t('The project is encrypted in your browser before it is uploaded. The key is in the link after “#” and is never sent to the server. Links expire by themselves.'),
      t('Anyone who has the complete link can open the project.'),
    ] },
    { title: t('When you use an AI'), text: [
      t('Local AI: the model files come from Hugging Face, which sees your IP address while they load. After that everything runs on your device.'),
      t('Connected AI: the company behind that AI sees what it writes for you. Its projects are stored encrypted. The server can read them only while it handles a request.'),
    ] },
    { title: t('Companies outside the EU'), text: [t('GitHub, Google, Cloudflare and Hugging Face are companies from the USA and may process data there.')] },
    { title: t('Why this is allowed'), text: [t('Accounts, links and AI connections: to provide what you asked for (Art. 6(1)(b) GDPR). Protection against abuse and limits: legitimate interest (Art. 6(1)(f) GDPR).')] },
    { title: t('Your rights'), list: [
      t('You can delete your account and everything stored about it yourself: Shared links, then Delete account.'),
      t('You can ask what is stored about you, have it corrected or deleted, receive it, or object to its use.'),
      t('You can complain to a data protection authority.'),
      t('If you are under 16, ask a parent before you create an account.'),
    ] },
  ];
  return <div className="privacy-page">
    <PageHeading title={t('Privacy')} description={t('What LocalDeck stores, where, and whom it contacts.')}/>
    {sections.map(section => <section key={section.title} className="panel"><h2>{section.title}</h2>
      {section.contact && <Contact/>}
      {section.text?.map(text => <p key={text}>{text}</p>)}
      {section.list && <ul>{section.list.map(text => <li key={text}>{text}</li>)}</ul>}
    </section>)}
  </div>;
}
