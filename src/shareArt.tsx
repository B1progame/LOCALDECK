/* Animated illustration for the sign-in / sharing screens.
   It tells the sharing story: your project → encrypted in the browser → a friend opens the link. */
import { t } from './i18n';
import { useEffect, useRef } from 'react';
import { useStillMotion } from './a11y';

/** One ball takes this long from the project through the lock to the friend. Lock and pulse keep in step with it. */
const ROUND = '4.5s';

export function ShareArt({ mode = 'signin' }: { mode?: 'signin' | 'signup' }) {
  const svg = useRef<SVGSVGElement>(null);
  const still = useStillMotion();
  useEffect(() => { if (still) svg.current?.pauseAnimations(); else svg.current?.unpauseAnimations(); }, [still]);
  return <div className={`share-art share-art-${mode}`} aria-hidden="true">
    <svg ref={svg} viewBox="10 96 400 300" className="share-art-svg">
      <defs>
        <linearGradient id="sa-vault" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#c4b5fd"/><stop offset=".55" stopColor="#8b5cf6"/><stop offset="1" stopColor="#5b21b6"/></linearGradient>
        <linearGradient id="sa-card" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#38bdf8"/><stop offset="1" stopColor="#6366f1"/></linearGradient>
        <linearGradient id="sa-friend" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#6ee7b7"/><stop offset="1" stopColor="#10b981"/></linearGradient>
        <linearGradient id="sa-ring" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#a78bfa" stopOpacity="0"/><stop offset=".5" stopColor="#e9d5ff"/><stop offset="1" stopColor="#a78bfa" stopOpacity="0"/></linearGradient>
        <radialGradient id="sa-core"><stop offset="0" stopColor="#a78bfa" stopOpacity=".75"/><stop offset="1" stopColor="#a78bfa" stopOpacity="0"/></radialGradient>
        <linearGradient id="sa-floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#a78bfa" stopOpacity="0"/><stop offset="1" stopColor="#a78bfa" stopOpacity=".35"/></linearGradient>
        <filter id="sa-glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        <filter id="sa-soft" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="14"/></filter>
        <path id="sa-in" d="M92 262 C 130 262, 150 214, 196 212"/>
        <path id="sa-out" d="M224 212 C 270 214, 290 262, 328 262"/>
        <clipPath id="sa-vault-clip"><rect x="166" y="160" width="88" height="88" rx="26"/></clipPath>
      </defs>

      {/* perspective floor */}
      <g className="sa-floor" stroke="url(#sa-floor)" strokeWidth="1">
        {[-6, -4, -2, 0, 2, 4, 6].map(i => <line key={i} x1={210 + i * 14} y1="300" x2={210 + i * 70} y2="420"/>)}
        {[318, 340, 368, 402].map((y, i) => <line key={y} x1="0" x2="420" y1={y} y2={y} opacity={.35 + i * .15}/>)}
        <line x1="0" x2="420" y1="300" y2="300"><animate attributeName="y1" values="300;420" dur="3s" repeatCount="indefinite"/><animate attributeName="y2" values="300;420" dur="3s" repeatCount="indefinite"/><animate attributeName="opacity" values="0;1;0" dur="3s" repeatCount="indefinite"/></line>
      </g>

      {/* one star */}
      <path d="M318 118 l3 9 l9 3 l-9 3 l-3 9 l-3 -9 l-9 -3 l9 -3 z" fill="#e9d5ff"><animate attributeName="opacity" values=".25;1;.25" dur="3.4s" repeatCount="indefinite"/></path>

      {/* data paths */}
      <use href="#sa-in" className="sa-path" />
      <use href="#sa-out" className="sa-path sa-path-out" />

      {/* one ball: plain on the way in, encrypted on the way out. The lock covers it in between. */}
      <circle r="6" fill="#7dd3fc" filter="url(#sa-glow)" opacity="0">
        <animateMotion dur={ROUND} repeatCount="indefinite" path="M92 262 C 130 262, 150 214, 196 212 L 224 212 C 270 214, 290 262, 328 262"/>
        <animate attributeName="fill" values="#7dd3fc;#7dd3fc;#c4b5fd;#c4b5fd" keyTimes="0;.46;.54;1" dur={ROUND} repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;.08;.92;1" dur={ROUND} repeatCount="indefinite"/>
      </circle>

      {/* source: your project */}
      <g className="sa-node sa-float-a">
        <rect x="32" y="232" width="64" height="60" rx="14" fill="url(#sa-card)"/>
        <rect x="42" y="244" width="30" height="5" rx="2.5" fill="#fff" opacity=".9"/>
        <rect x="42" y="254" width="44" height="4" rx="2" fill="#fff" opacity=".5"/>
        <rect x="42" y="263" width="36" height="4" rx="2" fill="#fff" opacity=".5"/>
        <path d="M44 280 l6 -6 l6 4 l8 -9 l10 11 z" fill="#fff" opacity=".7"/>
        <text x="64" y="312" textAnchor="middle" className="sa-label">{t('Your project')}</text>
      </g>

      {/* destination: a friend */}
      <g className="sa-node sa-float-b">
        <circle cx="356" cy="262" r="30" fill="url(#sa-friend)"/>
        <circle cx="356" cy="254" r="9" fill="#fff" opacity=".95"/>
        <path d="M340 278 a16 13 0 0 1 32 0 z" fill="#fff" opacity=".95"/>
        <g className="sa-check">
          <circle cx="378" cy="240" r="10" fill="#fff"/>
          <path d="M373 240 l3.5 3.5 l6.5 -7" fill="none" stroke="#10b981" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"/>
        </g>
        <text x="356" y="312" textAnchor="middle" className="sa-label">{t('A friend')}</text>
      </g>

      {/* the vault: encryption happens here, in your browser */}
      <circle cx="210" cy="204" r="92" fill="url(#sa-core)" filter="url(#sa-soft)">
        <animate attributeName="r" values="80;80;98;80" keyTimes="0;.36;.5;1" dur={ROUND} repeatCount="indefinite"/>
      </circle>
      <g>
        <animateTransform attributeName="transform" type="rotate" from="0 210 204" to="360 210 204" dur="9s" repeatCount="indefinite"/>
        <circle cx="210" cy="204" r="70" fill="none" stroke="url(#sa-ring)" strokeWidth="2.5"/>
      </g>
      <g>
        <animateTransform attributeName="transform" type="rotate" from="360 210 204" to="0 210 204" dur="16s" repeatCount="indefinite"/>
        <circle cx="210" cy="204" r="86" fill="none" stroke="#a78bfa" strokeOpacity=".35" strokeWidth="1" strokeDasharray="2 9"/>
      </g>
      <g className="sa-vault">
        <rect x="166" y="160" width="88" height="88" rx="26" fill="url(#sa-vault)"/>
        <g clipPath="url(#sa-vault-clip)">
          <rect x="120" y="150" width="30" height="120" fill="#fff" opacity=".28" transform="skewX(-20)">
            <animate attributeName="x" values="110;300" dur="3.2s" repeatCount="indefinite"/>
          </rect>
        </g>
        <rect x="166.5" y="160.5" width="87" height="87" rx="25.5" fill="none" stroke="#fff" strokeOpacity=".35"/>
        {/* padlock */}
        <path d="M196 200 v-8 a14 14 0 0 1 28 0 v8" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round">
          <animate attributeName="d" values="M196 200 v-8 a14 14 0 0 1 28 0 v8;M196 200 v-8 a14 14 0 0 1 28 0 v8;M196 194 v-8 a14 14 0 0 1 28 0 v-2;M196 200 v-8 a14 14 0 0 1 28 0 v8;M196 200 v-8 a14 14 0 0 1 28 0 v8" keyTimes="0;.28;.38;.56;1" dur={ROUND} repeatCount="indefinite"/>
        </path>
        <rect x="189" y="199" width="42" height="32" rx="9" fill="#fff"/>
        <circle cx="210" cy="212" r="4.5" fill="#7c3aed"/>
        <rect x="208" y="214" width="4" height="9" rx="2" fill="#7c3aed"/>
      </g>
      {/* one pulse when the ball is encrypted */}
      <rect x="166" y="160" width="88" height="88" rx="26" fill="none" stroke="#c4b5fd" strokeWidth="2">
        <animate attributeName="opacity" values="0;0;.9;0;0" keyTimes="0;.49;.5;.7;1" dur={ROUND} repeatCount="indefinite"/>
        <animateTransform attributeName="transform" type="translate" values="0 0;0 0;-73.5 -71.4;-73.5 -71.4" keyTimes="0;.5;.7;1" dur={ROUND} additive="sum" repeatCount="indefinite"/>
        <animateTransform attributeName="transform" type="scale" values="1;1;1.35;1.35" keyTimes="0;.5;.7;1" dur={ROUND} additive="sum" repeatCount="indefinite"/>
      </rect>
      <g className="sa-tag"><rect x="133" y="298" width="154" height="22" rx="11" fill="#1e1442" stroke="#a78bfa" strokeOpacity=".45"/><text x="210" y="313" textAnchor="middle" className="sa-label sa-label-strong">{t('Encrypted on your device')}</text></g>
    </svg>
    <div className="share-art-chips">
      {mode === 'signup' ? <><span><i className="dot-green"/> {t('Free account')}</span><span><i className="dot-violet"/> {t('Library stays on your device')}</span></> : <><span><i className="dot-violet"/> AES-256</span><span><i className="dot-green"/> {t('Key stays in the link')}</span></>}
    </div>
  </div>;
}
