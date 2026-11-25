/* The logo on the start page. A ball of light flies around it, behind it and in front of it.
   It notices the mouse: the logo leans towards it and the ball gets faster. A click lets sparks fly. */
import { useEffect, useRef, useState } from 'react';
import { useStillMotion } from './a11y';

const base = import.meta.env.BASE_URL;
const SPARKS = 16, FAST = 3.2, FASTEST = 9;

export function HeroLogo() {
  const still = useStillMotion();
  const stage = useRef<HTMLDivElement>(null);
  const [awake, setAwake] = useState(false);
  const [bursts, setBursts] = useState<number[]>([]);
  const rate = useRef({ now: 1, wanted: 1, frame: 0 });

  /** Changes the speed of the flight smoothly, without a jump. */
  const fly = (wanted: number) => {
    const speed = rate.current;
    speed.wanted = wanted;
    if (speed.frame) return;
    const step = () => {
      speed.now += (speed.wanted - speed.now) * .07;
      const done = Math.abs(speed.wanted - speed.now) < .02;
      if (done) speed.now = speed.wanted;
      for (const animation of stage.current?.getAnimations({ subtree: true }) ?? []) if ((animation as CSSAnimation).animationName === 'orbit') animation.updatePlaybackRate(speed.now);
      speed.frame = done ? 0 : requestAnimationFrame(step);
    };
    speed.frame = requestAnimationFrame(step);
  };
  useEffect(() => () => cancelAnimationFrame(rate.current.frame), []);

  const lean = (event: React.PointerEvent<HTMLDivElement>) => {
    if (still) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width * 2 - 1, y = (event.clientY - box.top) / box.height * 2 - 1;
    stage.current?.style.setProperty('--lean-x', `${(-y * 16).toFixed(1)}deg`);
    stage.current?.style.setProperty('--lean-y', `${(x * 20).toFixed(1)}deg`);
  };
  const enter = () => { if (still) return; setAwake(true); fly(FAST); };
  const leave = () => {
    setAwake(false); fly(1);
    for (const name of ['--lean-x', '--lean-y']) stage.current?.style.removeProperty(name);
  };
  const burst = () => {
    if (still) return;
    const id = Date.now();
    setBursts(list => [...list.slice(-2), id]);
    window.setTimeout(() => setBursts(list => list.filter(entry => entry !== id)), 1100);
    const back = awake ? FAST : 1;
    fly(FASTEST);
    window.setTimeout(() => { if (rate.current.wanted === FASTEST) fly(back); }, 900);
  };

  return <div className="hero-art hero-live" aria-hidden="true" onPointerEnter={enter} onPointerMove={lean} onPointerLeave={leave} onClick={burst}>
    <div ref={stage} className={`hero-stage ${awake ? 'awake' : ''}`}>
      <div className="hero-ring"><div className="hero-spin"><i className="hero-tail"/><span className="hero-ball"><i/></span></div></div>
      <div className="hero-core" key={bursts.at(-1) ?? 0} data-pop={bursts.length ? '' : undefined}><img src={`${base}icon-512.png`} alt="" draggable={false}/><i className="hero-glint"/></div>
    </div>
    {bursts.map(id => <span key={id} className="hero-burst">{Array.from({ length: SPARKS }, (_, index) => <i key={index} style={{ '--angle': `${index * 360 / SPARKS}deg`, '--far': `${96 + (index * 37) % 46}px`, '--late': `${(index * 53) % 90}ms` } as React.CSSProperties}/>)}</span>)}
  </div>;
}
