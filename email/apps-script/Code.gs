/**
 * LocalDeck mail relay (Google Apps Script web app).
 *
 * Sends exactly one kind of email: the LocalDeck confirmation. It accepts a request only with the
 * shared secret, and only with a link that points to LocalDeck. Setup: docs/EMAIL_SETUP.md
 *
 * Script property needed: MAIL_RELAY_SECRET
 */
const APP_URL = 'https://b1progame.github.io/LOCALDECK/';

/** {0} is the email address. Unknown languages get English. */
const TEXTS = {
  en: { subject: 'Confirm your email for LocalDeck', preview: 'One click and your LocalDeck account is ready.', title: 'Confirm your email', hello: 'Hi', body: 'one step is left before you can share projects. Confirm that {0} belongs to you.', button: 'Confirm email', fallback: 'Button not working? Copy this address into your browser:', foot: 'The link works once and expires soon. If you did not create a LocalDeck account, ignore this email and nothing happens.' },
  de: { subject: 'Bestätige deine E-Mail für LocalDeck', preview: 'Ein Klick und dein LocalDeck-Konto ist fertig.', title: 'Bestätige deine E-Mail', hello: 'Hallo', body: 'ein Schritt fehlt noch, dann kannst du Projekte teilen. Bestätige, dass {0} dir gehört.', button: 'E-Mail bestätigen', fallback: 'Der Knopf geht nicht? Kopiere diese Adresse in deinen Browser:', foot: 'Der Link funktioniert einmal und läuft bald ab. Wenn du kein LocalDeck-Konto erstellt hast, ignoriere diese E-Mail einfach.' },
  fr: { subject: 'Confirme ton e-mail pour LocalDeck', preview: 'Un clic et ton compte LocalDeck est prêt.', title: 'Confirme ton e-mail', hello: 'Bonjour', body: 'il reste une étape avant de partager des projets. Confirme que {0} est bien ton adresse.', button: 'Confirmer l’e-mail', fallback: 'Le bouton ne marche pas ? Copie cette adresse dans ton navigateur :', foot: 'Le lien marche une seule fois et expire bientôt. Si tu n’as pas créé de compte LocalDeck, ignore cet e-mail.' },
  es: { subject: 'Confirma tu correo para LocalDeck', preview: 'Un clic y tu cuenta de LocalDeck está lista.', title: 'Confirma tu correo', hello: 'Hola', body: 'falta un paso para compartir proyectos. Confirma que {0} es tu correo.', button: 'Confirmar correo', fallback: '¿No funciona el botón? Copia esta dirección en tu navegador:', foot: 'El enlace funciona una vez y caduca pronto. Si no creaste una cuenta de LocalDeck, ignora este correo.' },
  it: { subject: 'Conferma la tua email per LocalDeck', preview: 'Un clic e il tuo account LocalDeck è pronto.', title: 'Conferma la tua email', hello: 'Ciao', body: 'manca un passo per condividere progetti. Conferma che {0} è la tua email.', button: 'Conferma email', fallback: 'Il pulsante non funziona? Copia questo indirizzo nel browser:', foot: 'Il link funziona una volta e scade presto. Se non hai creato un account LocalDeck, ignora questa email.' },
};

function doPost(event) {
  try {
    const secret = PropertiesService.getScriptProperties().getProperty('MAIL_RELAY_SECRET');
    const data = JSON.parse(event.postData.contents.slice(0, 6000));
    if (!secret || data.secret !== secret) return answer({ ok: false, error: 'forbidden' });

    const to = String(data.to || '');
    const link = String(data.link || '');
    if (!/^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(to) || to.length > 254) return answer({ ok: false, error: 'bad_address' });
    if (link.indexOf(APP_URL + '?mode=verifyEmail&oobCode=') !== 0 || link.length > 2000) return answer({ ok: false, error: 'bad_link' });
    if (MailApp.getRemainingDailyQuota() < 1) return answer({ ok: false, error: 'daily_limit' });

    sendConfirmation(to, String(data.name || ''), link, String(data.language || 'en'));
    return answer({ ok: true });
  } catch (error) {
    console.error('relay_failed');
    return answer({ ok: false, error: 'server_error' });
  }
}

/** Run this once in the editor: it asks for permission and sends you a preview. */
function sendTestToMyself() {
  sendConfirmation(Session.getEffectiveUser().getEmail(), 'Test', APP_URL + '?mode=verifyEmail&oobCode=preview-only', 'de');
}

function answer(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function sendConfirmation(to, name, link, language) {
  const known = Object.prototype.hasOwnProperty.call(TEXTS, language) ? language : 'en';
  const text = TEXTS[known];
  // A display name is free text chosen at sign-up, so anything that looks like a link is dropped.
  const safeName = /^[^\s:\/.@<>]{1,30}( [^\s:\/.@<>]{1,30})?$/.test(name) ? name : '';
  const hello = text.hello + (safeName ? ' ' + safeName : '') + ',';
  MailApp.sendEmail({
    to: to,
    name: 'LocalDeck',
    noReply: false,
    subject: text.subject,
    body: hello + '\n\n' + text.body.split('{0}').join(to) + '\n\n' + link + '\n\n' + text.foot,
    htmlBody: template(text, known, escapeHtml(hello), escapeHtml(to), escapeHtml(link)),
  });
}

function template(text, language, hello, email, link) {
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;";
  return '' +
'<!doctype html><html lang="' + language + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">' +
'<meta name="color-scheme" content="light"><title>' + text.title + '</title></head>' +
'<body style="margin:0;padding:0;background:#f1eff8;">' +
'<div style="display:none;max-height:0;overflow:hidden;">' + text.preview + '</div>' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1eff8;"><tr><td align="center" style="padding:32px 16px;">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e3e0ee;border-radius:20px;">' +

'<tr><td bgcolor="#1a1038" style="padding:34px 32px;border-radius:20px 20px 0 0;background:#1a1038;background-image:linear-gradient(135deg,#1a1038,#4c2a9c);">' +
'<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
'<td><img src="' + APP_URL + 'icon-192.png" width="44" height="44" alt="" style="display:block;border-radius:12px;"></td>' +
'<td style="padding-left:12px;' + font + 'font-size:20px;font-weight:700;color:#ffffff;">LocalDeck</td>' +
'</tr></table></td></tr>' +

'<tr><td style="padding:32px;' + font + 'color:#16151d;">' +
'<h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;">' + text.title + '</h1>' +
'<p style="margin:0 0 10px;font-size:15px;line-height:1.6;color:#4b4a5a;">' + hello + '</p>' +
'<p style="margin:0 0 26px;font-size:15px;line-height:1.6;color:#4b4a5a;">' + text.body.split('{0}').join('<b style="color:#16151d;">' + email + '</b>') + '</p>' +
'<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#6546d6" style="border-radius:12px;">' +
'<a href="' + link + '" style="display:inline-block;padding:15px 28px;' + font + 'font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:12px;">' + text.button + '</a>' +
'</td></tr></table>' +
'<p style="margin:26px 0 6px;font-size:13px;line-height:1.6;color:#5f5e6e;">' + text.fallback + '</p>' +
'<p style="margin:0;font-size:12px;line-height:1.5;word-break:break-all;"><a href="' + link + '" style="color:#6546d6;">' + link + '</a></p>' +
'</td></tr>' +

'<tr><td style="padding:20px 32px 26px;border-top:1px solid #eceaf3;' + font + 'font-size:12.5px;line-height:1.6;color:#5f5e6e;">' +
text.foot +
'</td></tr></table></td></tr></table></body></html>';
}
