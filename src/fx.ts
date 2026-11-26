/* Small decorations: particles, the change between light and dark, and the surprises behind them.
   Everything here is only for the eyes, is hidden from screen readers and does nothing when motion is reduced. */

export const still = () => document.documentElement.classList.contains('reduce-motion') || matchMedia('(prefers-reduced-motion: reduce)').matches;

function layer(className: string): HTMLElement {
  const element = document.createElement('div');
  element.className = `fx-layer ${className}`;
  element.setAttribute('aria-hidden', 'true');
  document.body.append(element);
  return element;
}

type Burst = { glyphs?: string[]; colors?: string[]; count?: number; far?: number; size?: number; up?: number; duration?: number };
/** Lets signs or dots fly away from a point and fall. */
export function burst(x: number, y: number, { glyphs, colors = ['#c4b5fd', '#7dd3fc', '#6ee7b7', '#fdba74', '#f9a8d4', '#fde047'], count = 24, far = 130, size = 18, up = 60, duration = 1100 }: Burst = {}): void {
  if (still() || !document.body.animate) return;
  const root = layer('fx-burst'), runs: Array<Promise<unknown>> = [];
  for (let index = 0; index < count; index++) {
    const part = document.createElement('span');
    const angle = index / count * Math.PI * 2 + Math.random() * .6, reach = far * (.45 + Math.random() * .75);
    const color = colors[index % colors.length]!;
    if (glyphs) { part.textContent = glyphs[Math.floor(Math.random() * glyphs.length)]!; part.style.color = color; part.style.fontSize = `${size * (.7 + Math.random() * .6)}px`; }
    else { part.className = 'fx-dot'; part.style.background = color; part.style.width = part.style.height = `${size * (.25 + Math.random() * .35)}px`; }
    part.style.left = `${x}px`; part.style.top = `${y}px`;
    root.append(part);
    const dx = Math.cos(angle) * reach, dy = Math.sin(angle) * reach - up;
    runs.push(part.animate([
      { transform: 'translate(-50%, -50%) scale(.2)', opacity: 1, easing: 'cubic-bezier(.1, .8, .3, 1)' },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${(Math.random() - .5) * 240}deg)`, opacity: 1, offset: .5, easing: 'cubic-bezier(.4, 0, 1, .6)' },
      { transform: `translate(calc(-50% + ${dx * 1.15}px), calc(-50% + ${dy + 110}px)) scale(.6) rotate(${(Math.random() - .5) * 420}deg)`, opacity: 0 },
    ], { duration: duration * (.8 + Math.random() * .4), delay: Math.random() * 60, fill: 'both' }).finished.catch(() => undefined));
  }
  void Promise.all(runs).then(() => root.remove());
}

export function burstFrom(element: Element, options?: Burst): void {
  const box = element.getBoundingClientRect();
  burst(box.left + box.width / 2, box.top + box.height / 2, options);
}

/** Calls `action` when this was clicked `times` times in a short while. */
export function manyClicks(times: number, action: () => void, within = 2200): () => number {
  let clicks: number[] = [];
  return () => {
    const now = Date.now();
    clicks = [...clicks.filter(time => time > now - within), now];
    const count = clicks.length;
    if (count >= times) { clicks = []; action(); }
    return count;
  };
}

/* ---------- Light and dark ---------- */

let last: { x: number; y: number; at: number } | null = null;
addEventListener('pointerdown', event => { last = { x: event.clientX, y: event.clientY, at: Date.now() }; }, { passive: true, capture: true });

/** Where the change starts: the last touch, or the control that has the focus. */
function origin(): { x: number; y: number } {
  if (last && Date.now() - last.at < 1500) return last;
  const box = document.activeElement && document.activeElement !== document.body ? document.activeElement.getBoundingClientRect() : null;
  return box?.width ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : { x: innerWidth - 60, y: 40 };
}

type Transition = { ready: Promise<void>; finished: Promise<void> };
type WithTransitions = Document & { startViewTransition?: (change: () => void) => Transition };
let turning = false;

/** The new look spreads like a sunrise from where it was chosen, or the light draws back into that place. */
export function turnTheme(change: () => void, toLight: () => boolean): void {
  const page = document as WithTransitions, root = document.documentElement;
  if (turning || still() || !page.startViewTransition || document.visibilityState !== 'visible') { change(); return; }
  const { x, y } = origin();
  const reach = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 40;
  const wasLight = root.dataset.theme === 'pearl';
  turning = true;
  root.classList.add('theme-turning');
  const transition = page.startViewTransition(change);
  const done = () => { turning = false; root.classList.remove('theme-turning', 'theme-closing'); };
  transition.finished.then(done, done);
  transition.ready.then(() => {
    const light = toLight(), closing = wasLight && !light;
    root.classList.toggle('theme-closing', closing);
    const small = `circle(0px at ${x}px ${y}px)`, large = `circle(${reach}px at ${x}px ${y}px)`;
    root.animate({ clipPath: closing ? [large, small] : [small, large] }, { duration: 820, easing: 'cubic-bezier(.65, 0, .2, 1)', fill: 'both', pseudoElement: closing ? '::view-transition-old(root)' : '::view-transition-new(root)' });
  }).catch(() => undefined);
  // The sky: rays when it gets light, stars and a shooting star when it gets dark.
  transition.finished.then(() => { if (wasLight !== toLight()) sky(toLight(), x, y); }, () => undefined);
}

function sky(light: boolean, x: number, y: number): void {
  if (still()) return;
  const root = layer(light ? 'fx-day' : 'fx-night'), runs: Array<Promise<unknown>> = [];
  if (light) {
    for (let index = 0; index < 14; index++) {
      const ray = document.createElement('i');
      ray.style.left = `${x}px`; ray.style.top = `${y}px`;
      root.append(ray);
      const turn = index * 360 / 14;
      runs.push(ray.animate([{ transform: `rotate(${turn}deg) translateX(18px) scaleX(0)`, opacity: .95 }, { transform: `rotate(${turn + 12}deg) translateX(${70 + index % 3 * 34}px) scaleX(1)`, opacity: .8, offset: .55 }, { transform: `rotate(${turn + 20}deg) translateX(190px) scaleX(.1)`, opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'both' }).finished);
    }
  } else {
    for (let index = 0; index < 26; index++) {
      const star = document.createElement('i');
      star.style.left = `${Math.random() * 100}%`; star.style.top = `${Math.random() * 46}%`;
      root.append(star);
      const big = .5 + Math.random();
      runs.push(star.animate([{ transform: 'scale(0)', opacity: 0 }, { transform: `scale(${big}) rotate(45deg)`, opacity: 1, offset: .35 }, { transform: 'scale(0) rotate(90deg)', opacity: 0 }], { duration: 1100 + Math.random() * 900, delay: Math.random() * 500, fill: 'both' }).finished);
    }
    const shooting = document.createElement('b');
    root.append(shooting);
    runs.push(shooting.animate([{ transform: 'translate(92vw, 4vh) rotate(158deg) scaleX(0)', opacity: 0 }, { opacity: 1, offset: .2 }, { transform: 'translate(30vw, 30vh) rotate(158deg) scaleX(1)', opacity: 0 }], { duration: 950, delay: 350, easing: 'cubic-bezier(.3, 0, .6, 1)', fill: 'both' }).finished);
  }
  void Promise.allSettled(runs).then(() => root.remove());
}

/** The surprise for people who cannot stop pressing the switch. */
export function disco(): void {
  if (still()) return;
  const root = layer('fx-disco');
  for (let index = 0; index < 26; index++) {
    const spot = document.createElement('i');
    spot.style.left = `${Math.random() * 100}%`; spot.style.top = `${Math.random() * 100}%`;
    spot.style.setProperty('--hue', String(Math.round(Math.random() * 360)));
    spot.style.animationDelay = `${-Math.random() * 3}s`;
    root.append(spot);
  }
  const ball = document.createElement('b');
  root.append(ball);
  void root.animate([{ opacity: 0 }, { opacity: 1, offset: .08 }, { opacity: 1, offset: .88 }, { opacity: 0 }], { duration: 6000, fill: 'both' }).finished.then(() => root.remove(), () => root.remove());
}

/** Copies of a picture rain down, for the profile. */
export function rain(source: Element): void {
  if (still()) return;
  const root = layer('fx-rain'), runs: Array<Promise<unknown>> = [];
  for (let index = 0; index < 26; index++) {
    const copy = source.cloneNode(true) as HTMLElement;
    copy.classList.add('fx-drop');
    const size = 26 + Math.random() * 34;
    copy.style.width = copy.style.height = `${size}px`; copy.style.fontSize = `${size * .42}px`;
    copy.style.left = `${Math.random() * 100}%`;
    root.append(copy);
    const turns = (Math.random() < .5 ? -1 : 1) * (360 + Math.random() * 720);
    runs.push(copy.animate([{ transform: 'translateY(-90px) rotateY(0) rotate(0)' }, { transform: `translateY(${innerHeight + 100}px) rotateY(${turns}deg) rotate(${turns / 8}deg)` }], { duration: 1700 + Math.random() * 1500, delay: Math.random() * 900, easing: 'cubic-bezier(.4, 0, .9, .6)', fill: 'both' }).finished.catch(() => undefined));
  }
  void Promise.all(runs).then(() => root.remove());
}
