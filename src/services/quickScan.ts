/* Describes a project without a model: nothing is loaded, it takes milliseconds and works on every device and offline.
   Name, kind, subject, topic, description and hashtags come from the page itself: its title, headings, texts and the
   words that matter in it. It cannot think, but it also invents nothing. */
import type { ContentType } from '../types';
import { isPlaceholderTitle, parseTags, type ProjectText, type ScanResult } from './projectScan.ts';

type Lang = 'de' | 'en' | 'fr' | 'es' | 'it';
const LANGS: Lang[] = ['de', 'en', 'fr', 'es', 'it'];

const list = (text: string) => new Set(text.split(' '));
/** Words that carry no topic. */
const STOP: Record<Lang, Set<string>> = {
  de: list('aber alle allem allen aller alles also andere anderen auch auf aus beim bereits beide bin bis bist bitte dabei dadurch damit danach dann daran darauf daraus darf darin darum das dass davon dazu dein deine deinem deinen deiner dem den denen denn der deren des desto deshalb dich die dies diese diesem diesen dieser dieses dir doch dort drei durch ein eine einem einen einer eines einfach einige einigen einmal erst erste ersten etwa etwas euch euer eure falls fast für ganz ganze gar gegen genau gerade gibt gleich habe haben halt hast hat hatte hier hinter ich ihm ihn ihnen ihr ihre ihrem ihren ihrer immer ist jede jedem jeden jeder jedes jetzt kann kannst kein keine keinen können könnte lang lange lassen macht machen man mehr mein meine meist mich mir mit möglich muss müssen nach nächste nächsten neben nein neue neuen nicht nichts noch nun nur oben oder ohne schon sehr sein seine seinem seinen seiner seit sich sie sind sobald sofort sollte sondern sonst sowie stark statt teil über um und uns unser unter vier viel viele vielen vom von vor wann war waren warum was weg weil weiter welche welchem welchen welcher welches wenig wenn wer werden wie wieder wird wirst wo wobei wodurch wurde wurden während zeigt zum zur zwei zwischen zusammen hilft wichtig wichtige wichtigsten beispiel beispiele abschnitt kapitel'),
  en: list('about above after again all also always and another any are around because been before being below best better between both but can cannot could did does doing done down each easy else even every few find first for from full get gets give gives good great had has have having her here hers him his how however into its itself just keep kind know last less let lets like little long look made make makes many may more most much must need never new next not now off often once one only onto other our ours out over own part please quickly really same see set she should show shows simple some something soon start still such take than that the their them then there these they thing things this those three through time too try turn two under until upon use used useful user using very want was way well were what when where which while who why will with within without work works would you your yours example examples section chapter step steps'),
  fr: list('ainsi alors après assez aucun aucune aussi autre autres avant avec avoir bien car cela celle celles celui ceci cette ceux chaque chez comme comment dans de des depuis deux donc dont du elle elles encore entre est et être eux faire fait fois font grâce ici il ils jamais je la laquelle le lequel les leur leurs lors mais même mes moi moins mon ne ni non nos notre nous on ont ou où par parce pas pendant peu peut peuvent plus plusieurs pour pourquoi premier première près puis quand que quel quelle quelles quels qui quoi sa sans se ses si son sont sous soit sur ta te tes toi ton toujours tous tout toute toutes trois très tu un une vers voici votre vos vous exemple exemples chapitre partie étape'),
  es: list('además algo algún alguna algunas algunos ante antes aquel aquella aquí así aún aunque bajo bien cada casi como cómo con contra cual cuál cuales cuando cuándo cuanto de del desde donde dónde dos durante el ella ellas ellos en entonces entre era eran es esa esas ese eso esos esta está están estas este esto estos fue fueron ha hace hacer hacia han hasta hay la las le les lo los luego más me mejor menos mi mientras mis mismo misma mucho muchos muy nada ni no nos nosotros nuestra nuestro nunca o otra otras otro otros para pero poco podemos poder por porque primera primero puede pueden pues que qué quien quién se sea según ser si sí siempre sin sino sobre solo son su sus también tan tanto te tener tiene tienen toda todas todo todos tres tu tus un una unas uno unos usted varios ya yo ejemplo ejemplos parte paso'),
  it: list('abbiamo alcuna alcune alcuni allora altra altre altri altro anche ancora avere aveva bene che chi ci come con contro cosa così cui da dal dalla dalle dei del della delle dello dentro di dopo dove due durante e è ecco era essere fa fare fino fra già gli ha hanno ho i il in infatti invece io la le lei li lo loro lui ma mai me meglio meno mentre mi mia mie mio molti molto ne nel nella nelle nessun nessuna niente no noi non nostra nostro o ogni oltre ora per perché però più poco poi possiamo possono prima primo può qual quale quali quando quanto quella quelle quelli quello questa queste questi questo qui quindi se sei sempre senza si sia siamo solo sono sopra sotto su sua sue sui sul sulla suo suoi tra tre troppo tu tua tue tuo tuoi tutta tutte tutti tutto un una uno vi voi vostro esempio esempi parte passo capitolo'),
};
/** Words of buttons and menus. */
const INTERFACE = list('abbrechen again alert anfang anleitung antwort antworten answer answers auswahl back beenden bereit best button cancel canvas check click close closed copy correct default delete done download drag drop easy edit eingabe enter error escape ergebnis ergebnisse falsch fertig frage fragen game generate hard help high highscore home info input inhalt klick klicke kopieren leider level levels lives load loading los löschen medium menu menü move name neustart next nächste number öffnen open options pause play player points press previous prüfen punkt punkte question questions quiz random ready refresh reset restart result results richtig right round runde save score schließen schwer select send settings shuffle size skip space speed speichern spiel spielen start starten status stop submit tap test text time timer tippe title today total touch undo update versuch versuchen weiter welche wert wrong zahl zeit zurück zurücksetzen arrowleft arrowright arrowup arrowdown pagedown pageup keydown jouer commencer suivant précédent réponse réponses valider jugar empezar siguiente anterior respuesta respuestas gioca inizia avanti indietro risposta risposte system sans serif arial helvetica inter roboto monospace');

type Subject = Record<Lang, string> & { stems: string };
/** Beginnings of words that belong to a subject, in all five languages. */
const SUBJECTS: Subject[] = [
  { de: 'Mathematik', en: 'Math', fr: 'Mathématiques', es: 'Matemáticas', it: 'Matematica', stems: 'mathe math matem ableitung derivat dérivé deriva integral funktion function fonction función gleichung equation équation ecuaci equazion bruch fraction geometri géométri pythagor vektor vector vecteur matri algebra algèbre álgebra wahrschein probab polynom wurzel logarithm kurvendisk dreieck triangle triángul prozent einmaleins addition subtra multipl divis primzahl trigonom parabel steigung' },
  { de: 'Physik', en: 'Physics', fr: 'Physique', es: 'Física', it: 'Fisica', stems: 'physi física fisica kraft force fuerza geschwindig velocit vitesse beschleunig accelerat pendel pendul energie energy energía energia strom spannung voltage widerstand resistan magnet welle wave onde optik gravit newton impuls momentum schwingung oscillat reibung friction quant thermodyn kinetic kinetisch potenti mechan' },
  { de: 'Chemie', en: 'Chemistry', fr: 'Chimie', es: 'Química', it: 'Chimica', stems: 'chemi chimi quími molekül molecul atom element periodens säure acid base reaktion reaction ion elektron oxid redox bindung katalys lösung kohlenwasserst mol ' },
  { de: 'Biologie', en: 'Biology', fr: 'Biologie', es: 'Biología', it: 'Biologia', stems: 'biolog zelle zellen cell cellule célula photosynth fotosynth fotosínt fotosint chloro pflanz plant tier animal dna gen genetik evolution enzym protein herz heart blut blood organ ökosystem ecosyst bakteri virus mitochond stomata atmung respirat glucose stoffwechsel' },
  { de: 'Geschichte', en: 'History', fr: 'Histoire', es: 'Historia', it: 'Storia', stems: 'geschicht history histoire historia revolution révolution revolución krieg war guerre guerra könig king empire reich kaiser weltkrieg napoleon mittelalter medieval antike roman römer republik jahrhundert century bastille monarch diktat weimar kolonial' },
  { de: 'Erdkunde', en: 'Geography', fr: 'Géographie', es: 'Geografía', it: 'Geografia', stems: 'geograph géograph geograf erdkund kontinent continent hauptstadt capital hauptstädt fluss river gebirge mountain klima climate vulkan volcan magma lava erdbeben wetter weather wolke cloud niederschlag regen rain flüsse verdunst wasserkreis earthquake plattentekt ozean ocean bevölkerung population wüste landkarte karte map atmosph' },
  { de: 'Informatik', en: 'Computer science', fr: 'Informatique', es: 'Informática', it: 'Informatica', stems: 'informati algorithm algorit program code coding python javascript datenbank database netzwerk network binär binary sortier sort variable schleife loop array compiler software rekursion recurs hash' },
  { de: 'Deutsch', en: 'German', fr: 'Allemand', es: 'Alemán', it: 'Tedesco', stems: 'grammatik rechtschreib gedicht lyrik drama novelle erörterung satzglied nomen verben adjektiv kommasetzung metapher fontane goethe schiller kafka deutschunterricht' },
  { de: 'Englisch', en: 'English', fr: 'Anglais', es: 'Inglés', it: 'Inglese', stems: 'englisch vocabulary irregular tense present perfect pronoun shakespeare phrasal anglais inglés inglese' },
  { de: 'Französisch', en: 'French', fr: 'Français', es: 'Francés', it: 'Francese', stems: 'französisch français vocabulaire conjugaison passé imparfait subjonctif' },
  { de: 'Spanisch', en: 'Spanish', fr: 'Espagnol', es: 'Español', it: 'Spagnolo', stems: 'spanisch español vocabulario conjugación pretérito subjuntivo' },
  { de: 'Latein', en: 'Latin', fr: 'Latin', es: 'Latín', it: 'Latino', stems: 'latein latin deklination konjugation ablativ caesar cicero ovid' },
  { de: 'Musik', en: 'Music', fr: 'Musique', es: 'Música', it: 'Musica', stems: 'musik music musique música notenwert akkord chord melod rhythm piano klavier gitarre guitar tonleiter scale mozart beethoven' },
  { de: 'Kunst', en: 'Art', fr: 'Arts plastiques', es: 'Arte', it: 'Arte', stems: 'kunst malerei painting peinture pintura farbe farben color colour couleur palette harmon design skulptur impression perspektive' },
  { de: 'Wirtschaft', en: 'Economics', fr: 'Économie', es: 'Economía', it: 'Economia', stems: 'wirtschaft econom économ markt market angebot nachfrage demand inflation steuer tax aktie stock unternehmen bilanz konjunktur' },
  { de: 'Politik', en: 'Politics', fr: 'Éducation civique', es: 'Política', it: 'Educazione civica', stems: 'politik politic politique demokrat democra bundestag wahlen election grundgesetz verfassung constitution parlament parliament gewaltenteil menschenrecht' },
  { de: 'Sport', en: 'Sports', fr: 'Sport', es: 'Deporte', it: 'Sport', stems: 'sport training workout fitness fußball football basketball ausdauer muskel muscle dehnen yoga' },
];

const KIND: Record<Lang, Partial<Record<ContentType, string>>> = {
  de: { quiz: 'Ein Quiz über {0}.', learning: 'Ein Lernzettel über {0}.', presentation: 'Eine Präsentation über {0}.', simulation: 'Eine Simulation zu {0}.', game: 'Ein Spiel mit {0}.', tool: 'Ein Werkzeug für {0}.', app: 'Eine App für {0}.', other: 'Eine Seite über {0}.' },
  en: { quiz: 'A quiz about {0}.', learning: 'A study sheet about {0}.', presentation: 'A presentation about {0}.', simulation: 'A simulation of {0}.', game: 'A game with {0}.', tool: 'A tool for {0}.', app: 'An app for {0}.', other: 'A page about {0}.' },
  fr: { quiz: 'Un quiz sur {0}.', learning: 'Une fiche sur {0}.', presentation: 'Une présentation sur {0}.', simulation: 'Une simulation : {0}.', game: 'Un jeu avec {0}.', tool: 'Un outil pour {0}.', app: 'Une application pour {0}.', other: 'Une page sur {0}.' },
  es: { quiz: 'Un cuestionario sobre {0}.', learning: 'Un resumen sobre {0}.', presentation: 'Una presentación sobre {0}.', simulation: 'Una simulación de {0}.', game: 'Un juego con {0}.', tool: 'Una herramienta para {0}.', app: 'Una aplicación para {0}.', other: 'Una página sobre {0}.' },
  it: { quiz: 'Un quiz su {0}.', learning: 'Un riassunto su {0}.', presentation: 'Una presentazione su {0}.', simulation: 'Una simulazione: {0}.', game: 'Un gioco con {0}.', tool: 'Uno strumento per {0}.', app: 'Un’app per {0}.', other: 'Una pagina su {0}.' },
};
const AND: Record<Lang, string> = { de: 'und', en: 'and', fr: 'et', es: 'y', it: 'e' };

/** The language of the page: what it says itself, or the one whose small words occur most. */
export function pageLanguage(project: Pick<ProjectText, 'language' | 'text'>, fallback: string): Lang {
  const named = project.language.slice(0, 2).toLowerCase() as Lang;
  const words = project.text.slice(0, 20_000).toLocaleLowerCase().match(/\p{L}{2,}/gu) ?? [];
  const score = LANGS.map(lang => words.filter(entry => STOP[lang].has(entry)).length);
  const best = Math.max(...score);
  // Many pages say "en" although they are written in another language.
  if (best >= 8 && (!LANGS.includes(named) || score[LANGS.indexOf(named)]! * 2 < best)) return LANGS[score.indexOf(best)]!;
  return LANGS.includes(named) ? named : LANGS.includes(fallback as Lang) ? fallback as Lang : 'en';
}

const stem = (text: string) => text.toLocaleLowerCase().slice(0, 5);

export function keywords(project: Pick<ProjectText, 'title' | 'headings' | 'text'>, lang: Lang, max = 8): string[] {
  const name = isPlaceholderTitle(project.title) ? '' : project.title;
  const heads = [name, ...project.headings.filter(text => !isPlaceholderTitle(text))].join(' ');
  const inHeads = new Set((heads.match(/\p{L}{4,}/gu) ?? []).map(stem)), inTitle = new Set((name.match(/\p{L}{4,}/gu) ?? []).map(stem));
  const found = new Map<string, { forms: Map<string, number>; count: number; lower: number; first: number }>();
  const text = `${heads}\n${project.text.slice(0, 200_000)}`;
  let place = 0;
  for (const match of text.matchAll(/(?<![\p{L}\d_./@#-])\p{L}[\p{L}-]{2,24}(?![\p{L}\d_(@])/gu)) {
    const form = match[0].replace(/-+$/, ''), lower = form.toLocaleLowerCase();
    place++;
    if (lower.length < 4 || INTERFACE.has(lower) || LANGS.some(entry => STOP[entry].has(lower)) || /[a-z][A-Z]/.test(form)) continue;
    const key = stem(form), entry = found.get(key) ?? { forms: new Map(), count: 0, lower: 0, first: place };
    const shown = form === form.toLocaleUpperCase() && form.length > 3 ? form[0] + lower.slice(1) : form;
    entry.forms.set(shown, (entry.forms.get(shown) ?? 0) + 1);
    entry.count++;
    if (form === lower) entry.lower++;
    found.set(key, entry);
  }
  return [...found].map(([key, entry]) => {
    // In German a topic word is a noun, and nouns are written with a capital.
    const noun = lang !== 'de' || entry.lower < entry.count / 2;
    const score = (Math.min(entry.count, 6) + (inTitle.has(key) ? 5 : 0) + (inHeads.has(key) ? 3 : 0)) * (noun ? 1 : .2) - entry.first / (place * 2 || 1);
    const form = [...entry.forms].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]![0];
    return { form, score };
  }).filter(entry => entry.score >= 1.2).sort((a, b) => b.score - a.score)
    // "sort" next to "Sorting" says nothing new.
    .filter((entry, index, sorted) => !sorted.slice(0, index).some(other => stem(other.form).startsWith(stem(entry.form)) || stem(entry.form).startsWith(stem(other.form)))).slice(0, max).map(entry => entry.form);
}

export function findSubject(project: Pick<ProjectText, 'title' | 'headings' | 'text'>, lang: Lang): string {
  const words = (text: string) => [...new Set(text.toLocaleLowerCase().match(/\p{L}{3,}/gu) ?? [])];
  // Words that the page repeats count like its name.
  const often = keywords(project, lang, 3).filter(entry => project.text.toLocaleLowerCase().split(entry.toLocaleLowerCase()).length > 3);
  const top = words([project.title, ...project.headings, ...often].join(' ')), all = words(project.text.slice(0, 60_000));
  let best = { score: 0, name: '' };
  for (const subject of SUBJECTS) {
    const stems = subject.stems.trim().split(/\s+/);
    const inTop = stems.filter(entry => top.some(word => word.startsWith(entry))).length, inAll = stems.filter(entry => all.some(word => word.startsWith(entry))).length;
    const score = inTop * 2 + inAll;
    // One word alone can be chance, unless it is in the name of the page.
    if ((inAll >= 2 || inTop >= 1) && score >= 3 && score > best.score) best = { score, name: subject[lang] };
  }
  return best.name;
}

const squash = (text: string) => text.replace(/\s+/g, ' ').trim();
const shorten = (text: string, max: number) => text.length <= max ? text : `${text.slice(0, Math.max(text.lastIndexOf(' ', max - 1), max / 2))}…`;

/** Everything at once. `fallback` is the language of the app, for pages that do not name theirs. */
export function quickScan(project: ProjectText, options: { filename: string; fallback: string }): ScanResult {
  const lang = pageLanguage(project, options.fallback), words = keywords(project, lang);
  const type: ContentType | '' = project.kind || '';
  const own = [project.title, project.headings[0] ?? ''].map(squash).find(text => text.length >= 3 && text.length <= 60 && !isPlaceholderTitle(text));
  const named = words.slice(0, 3).join(', ');
  const title = own ?? (named ? `${type === 'quiz' ? 'Quiz: ' : ''}${named}` : '');
  const plain = ['game', 'tool', 'app'].includes(type);
  const subject = plain ? '' : findSubject(project, lang);
  const topic = plain ? '' : (own && project.headings.map(squash).find(text => text !== own && text.length >= 4 && text.length <= 40 && !isPlaceholderTitle(text) && words.some(entry => text.includes(entry)))) || words[0] || '';
  const about = words.slice(0, 3), joined = about.length > 1 ? `${about.slice(0, -1).join(', ')} ${AND[lang]} ${about.at(-1)}` : about[0] ?? '';
  const description = shorten(squash(project.description), 300) || shorten(squash(project.intro ?? ''), 300) || (joined ? KIND[lang][type || 'other']!.replace('{0}', joined) : '');
  return { suggestion: { title, type, subject, topic, description, tags: parseTags(words.join(',')) }, found: null, read: 1, total: 1, quick: true };
}
