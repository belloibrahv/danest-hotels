/**
 * Danest illustration set. Flat, geometric scenes in the Crest palette, each with one
 * purposeful loop of motion (water, light, music, breath). All motion stops under
 * prefers-reduced-motion. Shapes use CSS custom properties so they follow the theme.
 */

const C = {
  ink: 'var(--ink)',
  gold: 'var(--gold)',
  goldSoft: 'var(--gold-soft)',
  ivory: 'var(--cream)',
  stone: 'var(--stone)',
  palm: 'var(--palm)',
  red: 'var(--red)',
  paper: 'var(--paper)',
  water: '#7fb7c9',
  waterDeep: '#4f8fa6',
};

type P = { className?: string; title?: string };

function Svg({ children, title, className, viewBox = '0 0 320 200' }: P & { children: React.ReactNode; viewBox?: string }) {
  return (
    <svg viewBox={viewBox} className={`illo ${className ?? ''}`} role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title} preserveAspectRatio="xMidYMid slice">
      {children}
    </svg>
  );
}

function Palm({ x, y, s = 1 }: { x: number; y: number; s?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`} className="sway">
      <path d="M0 0 C 2 -30, 4 -55, 2 -80" stroke="#8a6a3f" strokeWidth="5" fill="none" strokeLinecap="round" />
      {[[-38, -78, -10], [38, -76, 10], [-30, -96, -40], [30, -96, 40], [0, -102, 0]].map(([dx, dy, r], i) => (
        <path key={i} d={`M2 -80 Q ${dx / 2} ${dy - 6} ${dx} ${dy + 10}`} stroke={C.palm} strokeWidth="7" fill="none" strokeLinecap="round" transform={`rotate(${r / 6} 2 -80)`} />
      ))}
    </g>
  );
}

export function PoolScene(p: P) {
  return (
    <Svg {...p}>
      <defs>
        <linearGradient id="pool-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6e7c4" />
          <stop offset="1" stopColor="#fbf7ef" />
        </linearGradient>
        <linearGradient id="pool-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={C.water} />
          <stop offset="1" stopColor={C.waterDeep} />
        </linearGradient>
        <clipPath id="pool-clip">
          <rect x="40" y="120" width="240" height="64" rx="6" />
        </clipPath>
      </defs>
      <rect width="320" height="200" fill="url(#pool-sky)" />
      <circle cx="248" cy="52" r="22" fill={C.gold} opacity=".85" className="glow" />
      <rect x="0" y="112" width="320" height="88" fill="#efe6d4" />
      <rect x="34" y="114" width="252" height="76" rx="9" fill={C.paper} />
      <rect x="40" y="120" width="240" height="64" rx="6" fill="url(#pool-water)" />
      <g clipPath="url(#pool-clip)" stroke="#ffffff" strokeWidth="2" fill="none" opacity=".55">
        <path className="wave" d="M0 140 q 15 -6 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0" />
        <path className="wave slow" d="M-20 162 q 15 -5 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0 t 30 0" />
      </g>
      {/* ladder */}
      <path d="M252 104 v 30 M264 104 v 30 M252 114 h 12 M252 124 h 12" stroke="#b9b2a4" strokeWidth="3" strokeLinecap="round" />
      {/* lounger + umbrella */}
      <path d="M58 104 l 40 0 l 10 -12" stroke={C.ink} strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M62 104 v 8 M94 104 v 8" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
      <path d="M86 60 v 52" stroke="#8a6a3f" strokeWidth="3" />
      <path d="M50 64 Q 86 30 122 64 Z" fill={C.red} />
      <path d="M68 64 Q 86 38 104 64" fill={C.paper} opacity=".35" />
      <Palm x={22} y={118} s={0.9} />
      <Palm x={300} y={120} s={0.75} />
    </Svg>
  );
}

export function GymScene(p: P) {
  return (
    <Svg {...p}>
      <rect width="320" height="200" fill="#efe9de" />
      <rect x="0" y="150" width="320" height="50" fill="#d9cfbd" />
      {/* window light */}
      <rect x="200" y="26" width="84" height="96" rx="4" fill="#f7efdc" stroke={C.paper} strokeWidth="4" />
      <path d="M242 26 v 96 M200 74 h 84" stroke={C.paper} strokeWidth="4" />
      <path d="M200 122 L 150 200 L 290 200 L 284 122 Z" fill="#fff8e6" opacity=".55" />
      {/* heart-rate line drawing itself */}
      <path className="trace" d="M30 60 h 30 l 8 -18 l 10 34 l 9 -26 l 6 10 h 40" stroke={C.red} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {/* rack + dumbbells */}
      <rect x="28" y="118" width="120" height="8" rx="3" fill={C.ink} />
      <path d="M36 126 v 26 M140 126 v 26" stroke={C.ink} strokeWidth="5" />
      {[44, 76, 108].map((x, i) => (
        <g key={x} className={i === 1 ? 'lift' : undefined}>
          <rect x={x} y={104} width="24" height="5" rx="2" fill="#6b645a" />
          <rect x={x - 4} y={98} width="9" height="17" rx="2" fill={C.gold} />
          <rect x={x + 19} y={98} width="9" height="17" rx="2" fill={C.gold} />
        </g>
      ))}
      {/* bench */}
      <rect x="168" y="146" width="96" height="12" rx="6" fill={C.ink} />
      <path d="M182 158 v 20 M250 158 v 20" stroke={C.ink} strokeWidth="5" strokeLinecap="round" />
      {/* kettlebell */}
      <circle cx="292" cy="170" r="13" fill={C.ink} />
      <path d="M284 160 q 8 -14 16 0" stroke={C.ink} strokeWidth="4" fill="none" />
    </Svg>
  );
}

export function LoungeScene(p: P) {
  return (
    <Svg {...p}>
      <defs>
        <radialGradient id="lamp" cx=".5" cy="0" r=".9">
          <stop offset="0" stopColor="#ffd98a" stopOpacity=".75" />
          <stop offset="1" stopColor="#ffd98a" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="320" height="200" fill="#1d1913" />
      {[[40, 40, 7], [270, 60, 10], [120, 30, 5], [210, 24, 6], [300, 120, 5]].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={C.gold} opacity=".25" className="bokeh" style={{ animationDelay: `${i * 0.7}s` }} />
      ))}
      {/* pendant lamps */}
      {[90, 160, 230].map((x, i) => (
        <g key={x}>
          <path d={`M${x} 0 v 46`} stroke="#5b5243" strokeWidth="2" />
          <path d={`M${x - 14} 58 q 14 -18 28 0 z`} fill={C.gold} />
          <path d={`M${x - 40} 58 L ${x + 40} 58 L ${x + 70} 150 L ${x - 70} 150 Z`} fill="url(#lamp)" className="flicker" style={{ animationDelay: `${i * 1.3}s` }} />
        </g>
      ))}
      {/* back bar shelves */}
      <rect x="40" y="78" width="240" height="4" fill="#3b342a" />
      {Array.from({ length: 11 }, (_, i) => {
        const x = 50 + i * 21;
        const h = 20 + ((i * 7) % 12);
        return <rect key={i} x={x} y={78 - h} width="9" height={h} rx="3" fill={i % 3 === 0 ? '#2e6b3f' : i % 3 === 1 ? '#8a3a22' : '#c9a24c'} opacity=".9" />;
      })}
      {/* counter */}
      <rect x="20" y="140" width="280" height="14" rx="4" fill={C.gold} />
      <rect x="30" y="154" width="260" height="46" fill="#2b251d" />
      {/* glasses */}
      <path d="M96 140 l -6 -18 h 16 z M100 122 v 0" fill="#f3eee4" opacity=".85" />
      <rect x="196" y="122" width="12" height="18" rx="2" fill="#f3eee4" opacity=".85" />
      <rect x="198" y="128" width="8" height="10" fill="#e3a537" />
      {/* music */}
      <g fill={C.gold}>
        <g className="float">
          <circle cx="250" cy="110" r="5" />
          <path d="M254 110 v -22 l 10 4" stroke={C.gold} strokeWidth="2.5" fill="none" />
        </g>
        <g className="float delay">
          <circle cx="60" cy="118" r="4" />
          <path d="M63 118 v -18 l 8 3" stroke={C.gold} strokeWidth="2" fill="none" />
        </g>
      </g>
    </Svg>
  );
}

const ROOM_STYLE = {
  standard: { wall: '#f3ead8', floor: '#d8c6a5', bed: '#ffffff', accent: '#c7a26b', throw: '#c7a26b' },
  deluxe: { wall: '#efe0bf', floor: '#c9ad7d', bed: '#ffffff', accent: '#b8862b', throw: '#b8862b' },
  executive: { wall: '#2c2720', floor: '#4a3f31', bed: '#f4efe6', accent: '#d8ad5c', throw: '#8a3a22' },
  royal: { wall: '#6f4c0e', floor: '#3a2b14', bed: '#fbf7ef', accent: '#f4d699', throw: '#b3261e' },
} as const;

export function RoomScene({ variant, ...p }: P & { variant: keyof typeof ROOM_STYLE | string }) {
  const s = ROOM_STYLE[(variant in ROOM_STYLE ? variant : 'standard') as keyof typeof ROOM_STYLE];
  const dark = variant === 'executive' || variant === 'royal';
  return (
    <Svg {...p}>
      <rect width="320" height="200" fill={s.wall} />
      <rect y="150" width="320" height="50" fill={s.floor} />
      {/* window with curtains, light drifting across */}
      <rect x="222" y="30" width="70" height="78" rx="3" fill={dark ? '#1a2a3d' : '#dfeef3'} />
      {dark && [[236, 46], [262, 60], [280, 40], [248, 82]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.5" fill="#fff" className="twinkle" style={{ animationDelay: `${i * 0.6}s` }} />)}
      {dark && <circle cx="270" cy="52" r="8" fill="#f4efe6" opacity=".9" />}
      <path d="M216 26 h 82" stroke={s.accent} strokeWidth="4" strokeLinecap="round" />
      <path d="M218 28 q 8 40 -2 84 h 18 q -4 -44 2 -84 z" fill={s.accent} opacity=".8" />
      <path d="M296 28 q -8 40 2 84 h -18 q 4 -44 -2 -84 z" fill={s.accent} opacity=".8" />
      {/* headboard + bed */}
      <rect x="44" y="70" width="150" height="70" rx="10" fill={dark ? '#3b3226' : s.accent} opacity={dark ? 1 : 0.55} />
      <rect x="36" y="118" width="166" height="34" rx="8" fill={s.bed} />
      <rect x="36" y="134" width="166" height="18" rx="6" fill={s.throw} />
      <rect x="56" y="104" width="50" height="20" rx="8" fill={s.bed} stroke="#00000010" />
      <rect x="128" y="104" width="50" height="20" rx="8" fill={s.bed} stroke="#00000010" />
      <path d="M40 152 v 12 M198 152 v 12" stroke={dark ? '#1a1611' : '#8a6a3f'} strokeWidth="5" strokeLinecap="round" />
      {/* lamp with soft glow */}
      <rect x="6" y="118" width="26" height="32" rx="3" fill={dark ? '#3b3226' : '#b99a6a'} />
      <path d="M19 118 v -18" stroke={C.ink} strokeWidth="2" />
      <path d="M8 100 h 22 l -5 -16 h -12 z" fill="#f7e2ae" />
      <circle cx="19" cy="94" r="26" fill="#ffd98a" opacity=".22" className="glow" />
      {variant === 'royal' && (
        <g className="sway-slow">
          <path d="M120 0 v 18" stroke={s.accent} strokeWidth="2" />
          <path d="M100 26 q 20 14 40 0" stroke={s.accent} strokeWidth="3" fill="none" />
          {[100, 110, 120, 130, 140].map((x) => <circle key={x} cx={x} cy={x === 120 ? 34 : 30} r="2.5" fill="#fff6d8" />)}
        </g>
      )}
      {variant === 'executive' && (
        <g>
          <rect x="226" y="132" width="80" height="22" rx="8" fill={s.accent} opacity=".85" />
          <rect x="230" y="120" width="72" height="16" rx="7" fill={s.accent} />
        </g>
      )}
      {variant === 'deluxe' && <rect x="238" y="122" width="34" height="30" rx="3" fill="#e9e3d8" stroke="#00000015" />}
    </Svg>
  );
}

/** Small spot illustrations for empty states. */
export function EmptyIllo({ kind }: { kind: 'bell' | 'key' | 'glass' | 'chart' }) {
  return (
    <svg viewBox="0 0 120 90" className="illo empty-illo" aria-hidden="true">
      <ellipse cx="60" cy="80" rx="40" ry="5" fill="var(--line)" />
      {kind === 'bell' && (
        <g className="ring">
          <path d="M30 66 h 60 a 30 30 0 0 0 -60 0 z" fill="var(--gold)" />
          <rect x="26" y="66" width="68" height="6" rx="3" fill="var(--ink)" />
          <circle cx="60" cy="33" r="4" fill="var(--ink)" />
          <path d="M44 52 a 18 18 0 0 1 10 -12" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" opacity=".6" />
        </g>
      )}
      {kind === 'key' && (
        <g className="float">
          <rect x="34" y="22" width="52" height="40" rx="6" fill="var(--ink)" />
          <rect x="40" y="28" width="22" height="4" rx="2" fill="var(--gold)" />
          <circle cx="72" cy="50" r="6" fill="var(--gold)" />
          <path d="M40 40 h 18 M40 47 h 12" stroke="#ffffff55" strokeWidth="3" strokeLinecap="round" />
        </g>
      )}
      {kind === 'glass' && (
        <g className="float">
          <path d="M44 20 h 32 l -4 26 a 12 12 0 0 1 -24 0 z" fill="var(--gold-soft)" stroke="var(--ink)" strokeWidth="3" />
          <path d="M60 58 v 14 M48 72 h 24" stroke="var(--ink)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="56" cy="34" r="2" fill="var(--gold)" />
          <circle cx="64" cy="40" r="1.5" fill="var(--gold)" />
        </g>
      )}
      {kind === 'chart' && (
        <g>
          {[30, 46, 62, 78].map((x, i) => <rect key={x} x={x} y={70 - (i + 1) * 11} width="10" height={(i + 1) * 11} rx="2" fill={i === 3 ? 'var(--gold)' : 'var(--line-2)'} className="grow" style={{ animationDelay: `${i * 0.12}s` }} />)}
        </g>
      )}
    </svg>
  );
}
