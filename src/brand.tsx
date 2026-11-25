/* The LocalDeck logo with its name. A small surprise: with the mouse a hand of cards comes out from behind the logo,
   on a touch screen a tap deals the whole deck across the screen. */
import { BookOpen, Gamepad2, Sparkles, Star } from 'lucide-react';

const base = import.meta.env.BASE_URL;
const NAME = 'LocalDeck';
const COLORS = ['#8b5cf6', '#38bdf8', '#34d399', '#fb923c', '#f472b6', '#facc15'];
const SIGNS = [
  'M12 7v14M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z',
  'M6 12h4M8 10v4M15 13h.01M18 11h.01M17.32 5H6.68a4 4 0 0 0-3.98 3.59C2.6 9.42 2 14.46 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.41-1.41A2 2 0 0 1 9.83 16h4.34a2 2 0 0 1 1.42.59L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.55-.6-6.58-.68-7.26A4 4 0 0 0 17.32 5z',
  'M12 3l2.6 6.2 6.4.6-4.9 4.2 1.5 6.4L12 17l-5.6 3.4 1.5-6.4L3 9.8l6.4-.6z',
];

const still = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

let dealing = false;
/** Deals the deck from this point across the screen. */
export function dealCards(x: number, y: number): void {
  if (dealing || still() || !document.body.animate) return;
  dealing = true;
  const layer = document.createElement('div');
  layer.className = 'deal-layer';
  layer.setAttribute('aria-hidden', 'true');
  const count = 22, width = innerWidth, height = innerHeight;
  const runs: Array<Promise<unknown>> = [];
  for (let index = 0; index < count; index++) {
    const card = document.createElement('span');
    card.className = 'deal-card';
    card.style.setProperty('--card', COLORS[index % COLORS.length]!);
    card.innerHTML = `<svg viewBox="0 0 24 24"><path d="${SIGNS[index % SIGNS.length]}"/></svg>`;
    card.style.left = `${x - 24}px`; card.style.top = `${y - 33}px`;
    layer.append(card);
    // Evenly spread over the screen, a little different each time.
    const column = (index % 5 + .5 + (Math.random() - .5) * .7) / 5, row = (Math.floor(index / 5) + .5 + (Math.random() - .5) * .7) / 5;
    const dx = column * width - x, dy = row * height * .86 + height * .06 - y, turn = (Math.random() - .5) * 70, spin = Math.random() < .5 ? 360 : -360;
    runs.push(card.animate([
      { transform: 'translate(0, 0) rotate(0) rotateY(180deg) scale(.4)', opacity: 0, easing: 'cubic-bezier(.16, .9, .3, 1)' },
      { transform: 'translate(0, 0) rotate(0) rotateY(180deg) scale(.6)', opacity: 1, offset: .04, easing: 'cubic-bezier(.16, .9, .3, 1)' },
      { transform: `translate(${dx}px, ${dy}px) rotate(${turn + spin}deg) rotateY(0deg) scale(1)`, opacity: 1, offset: .5, easing: 'cubic-bezier(.5, 0, .9, .4)' },
      { transform: `translate(${dx}px, ${dy + 12}px) rotate(${turn + spin}deg) rotateY(0deg) scale(1)`, opacity: 1, offset: .66, easing: 'cubic-bezier(.5, 0, .9, .4)' },
      { transform: `translate(${dx}px, ${height - y + 160}px) rotate(${turn * 2 + spin}deg) rotateY(40deg) scale(.9)`, opacity: 1 },
    ], { duration: 2100, delay: index * 28, fill: 'both' }).finished.catch(() => undefined));
  }
  document.body.append(layer);
  void Promise.all(runs).then(() => { layer.remove(); dealing = false; });
}

/** Only for a finger: with the mouse the cards are already there. */
function tapped(event: React.MouseEvent<HTMLElement>): void {
  const kind = (event.nativeEvent as PointerEvent).pointerType;
  if (kind ? kind === 'mouse' : !matchMedia('(hover: none)').matches) return;
  const box = (event.currentTarget.querySelector('img') ?? event.currentTarget).getBoundingClientRect();
  dealCards(box.left + box.width / 2, box.top + box.height / 2);
}

export function Brand({ className, href = '#/home', label, name = true }: { className: string; href?: string; label?: string; name?: boolean }) {
  return <a className={`${className} brand-egg`} href={href} aria-label={label ?? (name ? NAME : undefined)} onClick={tapped}>
    <span className="brand-hand" aria-hidden="true"><i><BookOpen size={11}/></i><i><Gamepad2 size={11}/></i><i><Star size={11}/></i><i><Sparkles size={11}/></i><img src={`${base}icon-192.png`} alt="" draggable={false}/></span>
    {name && <span className="brand-name" aria-hidden="true">{[...NAME].map((letter, index) => <span key={index} style={{ '--i': index } as React.CSSProperties}>{letter}</span>)}</span>}
  </a>;
}
