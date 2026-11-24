# Languages

LocalDeck speaks English, German, French, Spanish and Italian. It follows the browser, and **Settings → Language** (or the picker on the sign-in page) overrides that. The choice is stored in `localStorage` under `localdeck-language`. Changing it reloads the page.

- `src/i18n.ts` holds the list of languages and the functions `t`, `plural` and `tm`.
- `src/locales/<id>.ts` holds the translations. The key is the English text from the source, so a missing entry shows English.
- Only the chosen language is loaded. All of them are cached for offline use.

## In code

- `t('Delete {0}', name)` for a text, with `{0}`, `{1}` … for values.
- `plural(count, '{0} project', '{0} projects', count)` when a number changes the words.
- `tm(error.message)` for finished messages from `src/services`. Services keep throwing plain English.

`npm test` fails when a text used by the app is missing in a language. German also covers every rare ZIP and backup error; the other languages show a few of those in English.

## Add a language

1. Add it to `Language` and `LANGUAGES` in `src/i18n.ts`.
2. Copy `src/locales/de.ts` to `src/locales/<id>.ts` and translate the values. Keep the placeholders and the keys.
3. Add the email texts to `TEXTS` in `email/apps-script/Code.gs` and publish a new version there.
4. Run `npm test`.

## Style

Write the way people talk: short sentences, informal "you" (du, tu, tú, tu), no em dashes, no advertising words. Avoid forms that guess the reader's gender. Buttons name the action.

Not translated: the prompts for AI tools, the demo projects and everything users write themselves.
