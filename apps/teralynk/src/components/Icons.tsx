/**
 * Jeu d'icônes Teralynk — SVG inline cohérents (trait 1.8, 24×24).
 * Aucune dépendance externe : rendu net et instantané.
 */
import { useId, type SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 20, ...props }: IconProps) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props
  };
}

/**
 * Marque Teralynk v1.5.0 : hexagone de verre iridescent + deux nœuds reliés
 * par un faisceau lumineux — déclinée en SVG inline du nouvel icône
 * (dégradé violet → cyan, halo, reflets). Rendu net à toutes les tailles.
 */
export function TeralynkMark({ size = 20, ...props }: IconProps) {
  const rawId = useId();
  const gid = `tlg${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden {...props}>
      <defs>
        <linearGradient id={`${gid}a`} x1="4" y1="4.5" x2="20" y2="19.5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="0.45" stopColor="#8b5cf6" />
          <stop offset="1" stopColor="#38bdf8" />
        </linearGradient>
        <linearGradient id={`${gid}b`} x1="8" y1="9" x2="16" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#c4b5fd" />
          <stop offset="1" stopColor="#7dd3fc" />
        </linearGradient>
        <filter id={`${gid}f`} x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="1.4" />
        </filter>
      </defs>
      {/* halo diffus derrière l'hexagone */}
      <path d="M12 2.7 20.1 7.35v9.3L12 21.3 3.9 16.65v-9.3z" stroke={`url(#${gid}a)`} strokeWidth="2.4" opacity="0.4" filter={`url(#${gid}f)`} />
      {/* hexagone de verre */}
      <path d="M12 2.7 20.1 7.35v9.3L12 21.3 3.9 16.65v-9.3z" stroke={`url(#${gid}a)`} strokeWidth="1.55" strokeLinejoin="round" />
      {/* reflet supérieur du verre */}
      <path d="M12 4.1 18.6 7.9" stroke="#ffffff" strokeWidth="0.9" strokeLinecap="round" opacity="0.5" />
      {/* faisceau reliant les deux nœuds */}
      <path d="M10.35 10.95 13.65 13.05" stroke={`url(#${gid}b)`} strokeWidth="1.7" strokeLinecap="round" />
      <path d="M10.35 10.95 13.65 13.05" stroke={`url(#${gid}b)`} strokeWidth="3" strokeLinecap="round" opacity="0.35" filter={`url(#${gid}f)`} />
      {/* nœud violet */}
      <circle cx="9" cy="10" r="2.15" fill={`url(#${gid}a)`} />
      <circle cx="8.35" cy="9.35" r="0.65" fill="#ffffff" opacity="0.75" />
      {/* nœud cyan */}
      <circle cx="15" cy="14" r="2.15" fill={`url(#${gid}a)`} />
      <circle cx="14.35" cy="13.35" r="0.65" fill="#ffffff" opacity="0.75" />
      {/* étincelles */}
      <circle cx="16.6" cy="8.2" r="0.5" fill="#7dd3fc" opacity="0.9" />
      <circle cx="7.2" cy="15.6" r="0.42" fill="#c4b5fd" opacity="0.8" />
    </svg>
  );
}

export function IconHome(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </svg>
  );
}

export function IconCompass(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5.5-5.5 2 2-5.5z" />
    </svg>
  );
}

export function IconStar(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.9-5.3 2.9 1.1-5.9L3.5 9.7l5.9-.8z" />
    </svg>
  );
}

export function IconMegaphone(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 4.5A.6.6 0 0 0 10.5 18V6a.6.6 0 0 0-1-.5L6 10H4a1 1 0 0 0-1 1z" />
      <path d="M14 8.5a4.5 4.5 0 0 1 0 7" />
      <path d="M17 6a8 8 0 0 1 0 12" />
    </svg>
  );
}

export function IconPoll(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 20v-6M12 20V6M18 20v-9" />
      <path d="M3.5 20.5h17" />
    </svg>
  );
}

export function IconHistory(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5V9H8" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

export function IconSettings(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H9.1A1.7 1.7 0 0 0 10.13 3V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.09a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.03z" />
    </svg>
  );
}

export function IconInfo(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.8v.4" />
    </svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

export function IconPlay(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M7 4.8v14.4a.7.7 0 0 0 1.07.6l11.2-7.2a.7.7 0 0 0 0-1.2L8.07 4.2A.7.7 0 0 0 7 4.8z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconStop(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconDownload(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v11" />
      <path d="m7.5 10.5 4.5 4 4.5-4" />
      <path d="M4 20h16" />
    </svg>
  );
}

export function IconRefresh(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" />
      <path d="M20.5 3.5V8H16" />
    </svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function IconX(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function IconAlert(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 21.5 20H2.5z" />
      <path d="M12 9.5v5M12 17.4v.3" />
    </svg>
  );
}

export function IconShield(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2.8 20 6v6c0 4.5-3.2 7.8-8 9.2C7.2 19.8 4 16.5 4 12V6z" />
      <path d="m8.8 12 2.2 2.2 4.2-4.4" />
    </svg>
  );
}

export function IconTerminal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="m7.5 9.5 3 2.5-3 2.5M13 15h4" />
    </svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </svg>
  );
}

export function IconExternal(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </svg>
  );
}

export function IconTrash(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7" />
      <path d="M6.5 6.5 7.4 20a1.4 1.4 0 0 0 1.4 1.3h6.4a1.4 1.4 0 0 0 1.4-1.3l.9-13.5" />
      <path d="M10.5 10.5v6.5M13.5 10.5v6.5" />
    </svg>
  );
}

export function IconSparkles(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3.5 13.8 9 19.5 10.8 13.8 12.6 12 18.2 10.2 12.6 4.5 10.8 10.2 9z" fill="currentColor" stroke="none" />
      <path d="M18.5 16.5 19.3 19l2.2.8-2.2.9-.8 2.3" opacity={0.6} />
      <path d="M5 3v3M3.5 4.5h3" opacity={0.6} />
    </svg>
  );
}

export function IconWrench(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M14.7 6.3a4.5 4.5 0 0 0 6 6L21 12l-8.5 8.5a2.1 2.1 0 0 1-3-3L18 9" />
      <path d="M6.5 6.5 3 3" opacity={0} />
      <path d="M14.7 6.3 12.3 8.7" />
    </svg>
  );
}

export function IconFlask(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9.5 3v6.2L4.8 17.4A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 1.7-3.1L14.5 9.2V3" />
      <path d="M8 3h8M7.2 14.5h9.6" />
    </svg>
  );
}

export function IconClock(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </svg>
  );
}

export function IconGlobe(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3.5 9.5h17M3.5 14.5h17" />
      <path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z" />
    </svg>
  );
}

export function IconFolder(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.3c.5 0 .9.2 1.2.6l1 1.4h8.5A1.5 1.5 0 0 1 21 9.5v8A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
    </svg>
  );
}

export function IconHeart(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 20.5S3.5 15.5 3.5 9.4A4.9 4.9 0 0 1 12 5.8a4.9 4.9 0 0 1 8.5 3.6c0 6.1-8.5 11.1-8.5 11.1z" />
    </svg>
  );
}

export function IconUser(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </svg>
  );
}

export function IconLayers(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m12 3 9 5-9 5-9-5z" />
      <path d="m4 12.5 8 4.5 8-4.5" />
      <path d="m4 16.8 8 4.5 8-4.5" opacity={0.5} />
    </svg>
  );
}

export function IconBell(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" />
      <path d="M10 19a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

/** Icônes de cartes du catalogue (nommées dans le manifeste). */
export const CATALOG_ICONS: Record<string, (p: IconProps) => JSX.Element> = {
  sparkles: IconSparkles,
  terminal: IconTerminal,
  wrench: IconWrench,
  flask: IconFlask,
  shield: IconShield,
  globe: IconGlobe,
  folder: IconFolder,
  layers: IconLayers,
  clock: IconClock,
  download: IconDownload,
  star: IconStar,
  poll: IconPoll
};

export function CatalogIcon({ name, ...props }: { name: string } & IconProps) {
  const Component = name.startsWith('http') ? null : (CATALOG_ICONS[name] ?? IconSparkles);
  if (!Component) {
    // Icône distante https (hôte GitHub autorisé — validé par le schéma) :
    return <img src={name} alt="" width={props.size ?? 22} height={props.size ?? 22} style={{ borderRadius: 6 }} />;
  }
  return <Component {...props} />;
}
