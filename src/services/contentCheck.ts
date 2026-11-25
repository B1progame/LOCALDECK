/* Says whether a project may not be for children. Works without an AI, from words in the project and from hashtags.
   It is a hint, not a guarantee: pictures are not looked at, and a lesson about a topic is not the topic itself.
   The local AI can add its own opinion (see projectScan). */
export type Rating = 'ok' | '16' | '18';
export type Reason = 'marked' | 'sexual' | 'violence' | 'drugs' | 'gambling' | 'selfharm' | 'password' | 'ai';
/** `lesson`: the page teaches about the body ('body') or about anything else ('other'), so such words are its subject.
    `signs`: single words that are too little for a mark, but support what the AI says. `rated`: the local AI was asked about its content. */
export type ContentCheck = { rating: Rating; reasons: Reason[]; by: 'rules' | 'ai'; checkedAt: number; summary?: string; confirmed?: boolean; lesson?: 'body' | 'other'; signs?: Reason[]; rated?: boolean; scanned?: 'quick' | 'ai' };

const ORDER: Rating[] = ['ok', '16', '18'];
export const higher = (a: Rating, b: Rating): Rating => ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;

const word = (source: string) => new RegExp(`(?<![\\p{L}\\d])(?:${source})(?![\\p{L}\\d])`, 'giu');
/** Words that hardly appear in anything but adult content. */
const ADULT = word('porn\\p{L}*|hentai|nsfw|xxx|blowjobs?|handjobs?|gangbang|milfs?|onlyfans|camgirls?|deepthroat|cumshots?|creampie|fick(?:en|t|te)|wichsen|nutten?|porno|pornos|putes?|salope|baise[rz]?|follar|polvo porno|cogida|scopare|troie|erotik(?:film|geschichten?)?|sexfilme?|sexvideos?|nude ?pics|nacktbilder|nacktfotos|sextoys?|bdsm|strip ?poker');
const SEXUAL = word('sex|sexy|sexuell\\p{L}*|erotic\\p{L}*|erotisch\\p{L}*|érotique|erótic[oa]|erotic[oa]|nackt|naked|nude|desnud[oa]|nud[oa]|orgasm\\p{L}*|penis|vagina|strip ?tease|stripper\\p{L}*|fetisch|fetish');
const VIOLENCE = word('gore|gory|torture[ds]?|folter(?:n|t)?|beheading|enthaupt(?:en|et|ung)|dismember\\p{L}*|zerstückel\\p{L}*|massaker|massacre|blood ?bath|blutbad|slaughter\\p{L}*|abschlachten|headshots?|killstreak|torturer|torturar|torturare|decapitat\\p{L}*|masacre|massacro|mutilat\\p{L}*|verstümmel\\p{L}*');
const DRUGS = word('cocaine|kokain|cocaïne|cocaína|cocaina|heroin|heroína|eroina|crystal ?meth|meth|lsd|ecstasy|mdma|cannabis|marihuana|marijuana|kiffen|joints?|weed|crack|ketamin[ea]?|fentanyl');
const GAMBLING = word('casino|kasino|slots|slot ?machines?|spielautomat(?:en)?|roulette|jackpots?|sportwetten?|sports ?betting|real money|echtgeld|bet now|blackjack|einzahlungsbonus|deposit bonus|apuestas|scommesse|tragaperras');
const SELFHARM = word('suicide|suizid|selbstmord|self[- ]?harm|selbstverletz\\p{L}*|ritzen|suicidio|autolesi[oó]n\\p{L}*|automutilation');
const MILD = word(String.raw`kill(?:s|ed|ing|er)?|töten|mord|murder\p{L}*|blut|blood\p{L}*|weapons?|waffen?|alkohol|alcohol|vodka|wodka|horror|zombies?|flirt\p{L}*|küssen|verführ\p{L}*|seduc\p{L}*|tueur|tuer|matar|sangre|uccidere|sangue`);
/** Signs of a lesson. There such words are the subject, not the content. */
const LESSON_BODY = word('biologie|biology|biología|biologia|aufklärung|sexualkunde|prävention|prevention|prévention|prevención|prevenzione|medizin|medicine|anatomie|anatomy|anatomía|anatomia|fortpflanzung|reproduction|reproducción|riproduzione|schwangerschaft|pregnancy');
const LESSON = word('weltkrieg\\p{L}*|world war|guerre mondiale|guerra mundial|guerra mondiale|geschichte|history|histoire|historia|storia|unterricht|lernzettel|study sheet|ethik|ethics|politik|literatur|literature|mathe|mathematik|maths?|mathématiques|matemáticas|matematica|wahrscheinlichkeit|probability|apotheke|pharmacy|chemie|chemistry');

const MARK_18 = /(?<![\d.])(?:18\s?\+|\+\s?18|18plus)(?!\d)|(?:ab|from|over|über|dès|a partir de los|dai)\s18(?!\d)|\badults?[- ]only\b|\bnur für erwachsene\b/i;
const ADULTS_ONLY = /\b(?:(?:only|just) for (?:adults|members over 18)|adults[- ]only|18\+ only|over 18s? only|nur für erwachsene|ab 18 jahren|solo para adultos|mayores de 18|réservé aux adultes|interdit aux moins de 18|solo per adulti|vietato ai minori)\b/i;
const MARK_16 = /(?<![\d.])(?:16\s?\+|16plus)(?!\d)/i;

const count = (text: string, pattern: RegExp) => { const found = text.match(pattern) ?? []; return { total: found.length, different: new Set(found.map(entry => entry.toLowerCase())).size }; };

/** `top` is what names the project: title, description, hashtags, headings. */
export function checkContent(project: { top: string; text: string; source?: string }): ContentCheck {
  const top = project.top.slice(0, 4000), text = `${top}\n${project.text.slice(0, 400_000)}`;
  const reasons: Reason[] = [];
  let rating: Rating = 'ok';
  const add = (reason: Reason, level: Rating) => { if (!reasons.includes(reason)) reasons.push(reason); rating = higher(rating, level); };
  // One word in the name, or several in the text. A game with "history" in a menu is no lesson.
  const body = count(top, LESSON_BODY).total > 0 || count(text, LESSON_BODY).different >= 2;
  const lesson = body || count(top, LESSON).total > 0 || count(text, LESSON).different + count(text, LESSON_BODY).different >= 2;

  if (MARK_18.test(top)) add('marked', '18');
  else if (ADULTS_ONLY.test(text)) add('marked', '18');
  else if (MARK_16.test(top)) add('marked', '16');

  const adult = count(text, ADULT), adultTop = count(top, ADULT).total, sexual = count(text, SEXUAL);
  if (adultTop && !body) add('sexual', '18');
  else if (adult.total >= 3 && !body) add('sexual', '18');
  else if (adult.total >= 5) add('sexual', '18');
  else if (adult.total) add('sexual', '16');
  else if (sexual.total >= 3 && sexual.different >= 2 && !body) add('sexual', '16');

  const violence = count(text, VIOLENCE);
  if (violence.total >= 3 && violence.different >= 2 && !lesson) add('violence', '16');
  else if (count(text, MILD).different >= 4 && !lesson) add('violence', '16');
  const drugs = count(text, DRUGS);
  if (drugs.total >= 3 && drugs.different >= 2 && !lesson) add('drugs', '16');
  const gambling = count(text, GAMBLING);
  if (gambling.different >= 2) add('gambling', '16');
  const harm = count(text, SELFHARM);
  if (harm.total >= 2 && !lesson) add('selfharm', '16');
  // Not about age, but nobody should type a password into a shared project.
  if (project.source && /<input[^>]+type\s*=\s*["']?password/i.test(project.source)) reasons.push('password');
  const signs = ([['violence', violence.total + count(text, MILD).total], ['drugs', drugs.total], ['gambling', gambling.total]] as Array<[Reason, number]>).filter(([, total]) => total > 0).map(([reason]) => reason);
  return { rating, reasons, by: 'rules', checkedAt: Date.now(), ...(signs.length ? { signs } : {}), ...(lesson ? { lesson: body ? 'body' as const : 'other' as const } : {}) };
}

/** Adds what the local AI found, null when it was not asked. It never lowers what the rules found, and a lesson stays a lesson.
    Asked about violence, drugs or gambling, a small model is too strict (a pharmacy quiz is no drug page), so a word in the page must support it. */
export function withOpinion(rules: ContentCheck, found: Reason[] | null, summary: string): ContentCheck {
  const extra = (found ?? []).filter(reason => reason === 'sexual' ? rules.lesson !== 'body' : !rules.lesson && rules.signs?.includes(reason));
  let rating = rules.rating;
  for (const reason of extra) rating = higher(rating, reason === 'sexual' ? '18' : '16');
  const reasons = rating === rules.rating && extra.every(reason => rules.reasons.includes(reason)) ? rules.reasons : [...new Set([...rules.reasons, ...extra, 'ai' as const])];
  return { ...rules, rating, reasons, by: 'ai', scanned: 'ai', checkedAt: Date.now(), ...(found ? { rated: true } : {}), ...(summary ? { summary } : {}) };
}
