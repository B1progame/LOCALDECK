/* Says whether a project may not be for children. Works without an AI, from words in the project and from hashtags.
   It is a hint, not a guarantee: pictures are not looked at, and a lesson about a topic is not the topic itself.
   The local AI can add its own opinion (see projectScan). */
export type Rating = 'ok' | '16' | '18';
export type Reason = 'marked' | 'sexual' | 'violence' | 'drugs' | 'gambling' | 'selfharm' | 'password' | 'ai';
/** `hint`: a single word that is too little for a rating, but enough to take the AI seriously. */
export type ContentCheck = { rating: Rating; reasons: Reason[]; by: 'rules' | 'ai'; checkedAt: number; summary?: string; confirmed?: boolean; hint?: boolean };

const ORDER: Rating[] = ['ok', '16', '18'];
export const higher = (a: Rating, b: Rating): Rating => ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;

const word = (source: string) => new RegExp(`(?<![\\p{L}\\d])(?:${source})(?![\\p{L}\\d])`, 'giu');
/** Words that hardly appear in anything but adult content. */
const ADULT = word('porn\\p{L}*|hentai|nsfw|xxx|blowjobs?|handjobs?|gangbang|milfs?|onlyfans|camgirls?|deepthroat|cumshots?|creampie|fick(?:en|t|te)|wichsen|nutten?|porno|pornos|putes?|salope|baise[rz]?|follar|polvo porno|cogida|scopare|troie|erotik(?:film|geschichten?)?|sexfilme?|sexvideos?|nude ?pics|nacktbilder|nacktfotos|sextoys?|bdsm');
const SEXUAL = word('sex|sexy|erotic|erotisch|érotique|erótic[oa]|erotic[oa]|nackt|naked|nude|desnud[oa]|nud[oa]|orgasm\\p{L}*|penis|vagina|strip ?tease|stripper\\p{L}*|fetisch|fetish');
const VIOLENCE = word('gore|gory|torture[ds]?|folter(?:n|t)?|beheading|enthaupt(?:en|et|ung)|dismember\\p{L}*|zerstückel\\p{L}*|massaker|massacre|blood ?bath|blutbad|slaughter\\p{L}*|abschlachten|headshots?|killstreak|torturer|torturar|torturare|masacre|massacro|mutilat\\p{L}*|verstümmel\\p{L}*');
const DRUGS = word('cocaine|kokain|cocaïne|cocaína|cocaina|heroin|heroína|eroina|crystal ?meth|meth|lsd|ecstasy|mdma|cannabis|marihuana|marijuana|kiffen|joints?|weed|crack|ketamin[ea]?|fentanyl');
const GAMBLING = word('casino|kasino|slot ?machines?|spielautomat(?:en)?|roulette|jackpots?|sportwetten?|sports ?betting|real money|echtgeld|bet now|blackjack|einzahlungsbonus|deposit bonus|apuestas|scommesse|tragaperras');
const SELFHARM = word('suicide|suizid|selbstmord|self[- ]?harm|selbstverletz\\p{L}*|ritzen|suicidio|autolesi[oó]n\\p{L}*|automutilation');
const MILD = word(String.raw`kill(?:s|ed|ing|er)?|töten|mord|murder\p{L}*|blut|blood\p{L}*|weapons?|waffen?|alkohol|alcohol|vodka|wodka|horror|zombies?|flirt\p{L}*|küssen|verführ\p{L}*|seduc\p{L}*|tueur|tuer|matar|sangre|uccidere|sangue`);
/** Signs of a lesson. There such words are the subject, not the content. */
const LESSON = word('biologie|biology|biología|biologia|geschichte|history|histoire|historia|storia|aufklärung|prävention|prevention|prévention|prevención|prevenzione|medizin|medicine|unterricht|schule|school|lernzettel|quiz|gesundheit|health|anatomie|anatomy|fortpflanzung|reproduction|ethik|ethics');

const MARK_18 = /(?<![\d.])(?:18\s?\+|\+\s?18|18plus)(?!\d)|(?:ab|from|over|über|dès|a partir de los|dai)\s18(?!\d)|\badults?[- ]only\b|\bnur für erwachsene\b/i;
const MARK_16 = /(?<![\d.])(?:16\s?\+|16plus)(?!\d)/i;

const count = (text: string, pattern: RegExp) => { const found = text.match(pattern) ?? []; return { total: found.length, different: new Set(found.map(entry => entry.toLowerCase())).size }; };

/** `top` is what names the project: title, description, hashtags, headings. */
export function checkContent(project: { top: string; text: string; source?: string }): ContentCheck {
  const top = project.top.slice(0, 4000), text = `${top}\n${project.text.slice(0, 400_000)}`;
  const reasons: Reason[] = [];
  let rating: Rating = 'ok';
  const add = (reason: Reason, level: Rating) => { if (!reasons.includes(reason)) reasons.push(reason); rating = higher(rating, level); };
  const lesson = count(text, LESSON).total > 0;

  if (MARK_18.test(top)) add('marked', '18');
  else if (MARK_16.test(top)) add('marked', '16');

  const adult = count(text, ADULT), adultTop = count(top, ADULT).total, sexual = count(text, SEXUAL);
  if (adultTop && !lesson) add('sexual', '18');
  else if (adult.total >= 3 && !lesson) add('sexual', '18');
  else if (adult.total >= 5) add('sexual', '18');
  else if (adult.total) add('sexual', '16');
  else if (sexual.total >= 4 && sexual.different >= 2 && !lesson) add('sexual', '16');

  const violence = count(text, VIOLENCE);
  if (violence.total >= 3 && violence.different >= 2 && !lesson) add('violence', '16');
  const drugs = count(text, DRUGS);
  if (drugs.total >= 3 && drugs.different >= 2 && !lesson) add('drugs', '16');
  const gambling = count(text, GAMBLING);
  if (gambling.different >= 2) add('gambling', '16');
  const harm = count(text, SELFHARM);
  if (harm.total >= 2 && !lesson) add('selfharm', '16');
  // Not about age, but nobody should type a password into a shared project.
  if (project.source && /<input[^>]+type\s*=\s*["']?password/i.test(project.source)) reasons.push('password');
  const hint = rating !== 'ok' || (!lesson && [ADULT, SEXUAL, VIOLENCE, DRUGS, GAMBLING, SELFHARM, MILD].some(pattern => count(text, pattern).total > 0));
  return { rating, reasons, by: 'rules', checkedAt: Date.now(), ...(hint ? { hint } : {}) };
}

/** Adds what the local AI thinks. It can raise the rating by one step and only when the project itself gives a reason:
    a small model also calls a volcano quiz "18". It never lowers what the rules found. */
export function withOpinion(rules: ContentCheck, age: number | null, summary: string): ContentCheck {
  const opinion: Rating = age === null || !rules.hint ? 'ok' : age >= 18 && rules.rating !== 'ok' ? '18' : age >= 16 ? '16' : 'ok';
  const rating = higher(rules.rating, opinion);
  return { ...rules, rating, reasons: rating === rules.rating ? rules.reasons : [...rules.reasons, 'ai'], by: 'ai', checkedAt: Date.now(), ...(summary ? { summary } : {}) };
}
