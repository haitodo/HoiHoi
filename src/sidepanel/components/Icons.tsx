import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
}

const baseProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true as const,
  className,
  style: { flexShrink: 0, display: 'block' },
});

export const PinIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 17v5" />
    <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
  </svg>
);

export const UnlockTrackIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v3" />
    <path d="M12 19v3" />
    <path d="M2 12h3" />
    <path d="M19 12h3" />
  </svg>
);

export const RefreshIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 16h5v5" />
  </svg>
);

export const SlidersIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <line x1="4" y1="7" x2="20" y2="7" />
    <line x1="4" y1="17" x2="20" y2="17" />
    <circle cx="9" cy="7" r="2.2" fill="currentColor" stroke="none" />
    <circle cx="15" cy="17" r="2.2" fill="currentColor" stroke="none" />
  </svg>
);

export const DownloadIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export const ExternalLinkIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M15 3h6v6" />
    <path d="M10 14 21 3" />
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
  </svg>
);

export const CopyIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

export const CheckIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)} strokeWidth={2.3}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const ExpandIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

export const PlayIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)} fill="currentColor" stroke="none">
    <polygon points="6 4 20 12 6 20 6 4" />
  </svg>
);

export const StopIcon: React.FC<IconProps> = ({ size = 11, className }) => (
  <svg {...baseProps(size, className)} fill="currentColor" stroke="none">
    <rect x="4" y="4" width="16" height="16" rx="2.5" />
  </svg>
);

export const CloseIcon: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...baseProps(size, className)} strokeWidth={2}>
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export const ChevronLeftIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)} strokeWidth={2}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

export const ChevronRightIcon: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...baseProps(size, className)} strokeWidth={2}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const FilmIcon: React.FC<IconProps> = ({ size = 22, className }) => (
  <svg {...baseProps(size, className)} strokeWidth={1.6}>
    <rect x="2" y="4" width="20" height="16" rx="2.5" />
    <polygon points="10 9 16 12 10 15 10 9" fill="currentColor" stroke="none" />
  </svg>
);

export const TerminalIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

export const LayersIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <polygon points="12 2 2 7 12 12 22 7 12 2" />
    <polyline points="2 17 12 22 22 17" />
    <polyline points="2 12 12 17 22 12" />
  </svg>
);

export const SearchIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

export const PipIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <rect x="2" y="4" width="20" height="15" rx="2" />
    <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
  </svg>
);

export const CameraIcon: React.FC<IconProps> = ({ size = 12, className }) => (
  <svg {...baseProps(size, className)}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);
