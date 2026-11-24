# antislop Audit 001: Nachtrag (2026-11-24)

Freigegeben waren die Punkte 1 bis 17. Die Punkte 18 bis 28 sind unverändert.

## Was behoben ist

| Nr | Lösung | Nachweis |
|---|---|---|
| 1, 2, 3, 4, 5 | Neue Werte für `--muted`, Erfolg, Warnung und Fehler, neues `--go`, dunklerer Knopfverlauf. | Alle Seiten in 5 Themes gemessen: 3.585 Texte. 2 Treffer lagen auf Bildern: der Knopf rechnet sich auf 5.36 bis 5.48, der Paket-Titel hat jetzt einen dunklen Verlauf dahinter. |
| 6 | `readableAccent` passt die gewählte Farbe an. | 65 von 65 Kombinationen erreichen 4.5. |
| 7 | Neues `--field` für Ränder von Eingabefeldern, Chips und Schaltern. | Mindestens 3.0 in allen Themes. |
| 8 | Pfeiltasten, Home, End und Escape. | Menü: Fokus läuft durch, End springt ans Ende, Escape schließt, Fokus kehrt zurück. Chips, Studio-Tabs und Login-Tabs wechseln mit Pfeil rechts. |
| 9 | Verknüpfte Titel, Seite dahinter `inert`, Fokus kehrt zurück. | Suche und Player im Browser geprüft. |
| 10 | Pause-Knopf in der oberen Leiste und auf den Login-Seiten. | Login: vorher 5 Endlosschleifen aktiv, danach 0. SVG-Szene pausiert. Home und Import: 0. |
| 11 | Parallax hört auf Pause und "Bewegung reduzieren". | Normal `translateY(-21px)`, pausiert `none`, reduziert `none`. |
| 12 | "Offline-ready" nur noch mit aktivem Service Worker. | Ohne Service Worker steht dort "Online". |
| 13 | 44 px auf Touch-Geräten. | 10 Seiten bei 375 px gemessen: kein seitliches Scrollen. Kleinster Wert 43 px auf drei Kartenelementen, gemessen während der Einblendung (Skalierung). |
| 14 | Sichtbares "Search" vor dem Feld. | Im Browser geprüft. |
| 15 | Zeiger-Cursor für alle Bedienelemente. | Basis-CSS. |
| 16 | Gedankenstriche aus Oberfläche, Titel, Manifest und KI-Gliederung entfernt. | Suche in `src`: nur noch ein CSS-Kommentar. |
| 17 | Editor-Vorschau nutzt denselben Weg wie der Player. | Rahmen lädt eine `blob:`-Adresse mit `sandbox` ohne `allow-same-origin`, das Projekt wird angezeigt. |

## Zusätzlich gefunden und behoben

Sicherheitslücke aus meiner eigenen früheren Änderung: Ein Projekt, das sich im Manifest als Dokument ausgab, öffnete ohne aktiven Service Worker ohne Sandbox und konnte auf LocalDecks Speicher zugreifen. Behoben in Commit 877cf7d mit Tests in `tests/isolation.test.mjs`.

## Delivery Gate (Punkte 1 bis 17)

| Prüfung | Ergebnis |
|---|---|
| TypeScript | PASS |
| Tests | PASS, 28 von 28 |
| Build | PASS |
| Kontrast | PASS |
| Tastatur und Fokus | PASS |
| Bewegung pausierbar | PASS |
| Handybreite 375 px | PASS |
| Konsole, frischer Tab | PASS, keine Fehler |

Gesamtes Projekt: FAIL, weil 18 (R-33) als Hard Gate offen ist.

## Nicht geprüft

Screenreader, echtes Handy, Safari und Firefox, 200 % Zoom, echte Anmeldung, Service Worker in einem normalen Browser.
