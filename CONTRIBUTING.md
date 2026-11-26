# Contributing

Thank you for helping. Please read the [license](LICENSE.md) first: LocalDeck is not open source. By sending a change you say that it is your own work, and you allow B1progame to use, change and publish it as part of LocalDeck, without a fee and without a time limit.

## Report a bug or an idea

Use the [forms](https://github.com/B1progame/LOCALDECK/issues/new/choose). Issues are public, so leave out names, email addresses and links with a key (the part after `#`). Security problems are reported [privately](.github/SECURITY.md).

## Change something

1. Open an issue first, unless it is a small fix.
2. Node 22 or newer, then:

   ```powershell
   npm ci
   npm run dev
   ```

3. Before you send it:

   ```powershell
   npm test
   npm run typecheck
   npm run build
   ```

## How the code is written

- Every text a person sees goes through `t()` and exists in all five languages ([how](docs/LANGUAGES.md)). A test checks that.
- It works on a phone of 320 px, with a keyboard and with reduced motion ([design](docs/DESIGN_SYSTEM.md)).
- Nothing is uploaded without a click. Projects never get access to the library ([how](docs/ARCHITECTURE.md)).
- New packages need a license that allows passing them on (MIT, BSD, ISC, Apache 2.0, OFL). Then run `npm run licenses`.
- No keys, passwords or personal data in the repository.
