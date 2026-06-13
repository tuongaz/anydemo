import type { SVGProps } from 'react';

const baseProps = (props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> => ({
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeWidth: 1.75,
  ...props,
});

export const LineSolidIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps(props)} aria-hidden="true">
    <line x1="2" y1="8" x2="14" y2="8" />
  </svg>
);

export const LineDashedIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps(props)} aria-hidden="true">
    <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="3 2.5" />
  </svg>
);

export const LineDottedIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps(props)} aria-hidden="true">
    <line x1="2" y1="8" x2="14" y2="8" strokeDasharray="0.1 2.6" />
  </svg>
);

export const PathCurveIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps(props)} aria-hidden="true">
    <path d="M2 12 C 5 12, 5 4, 8 4 S 11 12, 14 12" />
  </svg>
);

export const PathStepIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps(props)} aria-hidden="true">
    <path d="M2 12 H 6 V 4 H 14" />
  </svg>
);

// ER crow's-foot head-shape toggle icons: a line into the right edge ending in
// the endpoint mark (matches the glyphs drawn by ConnectorHeadGlyph).
export const HeadOneIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps(props)} aria-hidden="true">
    <line x1="2" y1="8" x2="13" y2="8" />
    <line x1="11" y1="4" x2="11" y2="12" />
  </svg>
);

export const HeadManyIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps(props)} aria-hidden="true">
    <line x1="2" y1="8" x2="8" y2="8" />
    <path d="M8 8 L14 4 M8 8 L14 8 M8 8 L14 12" />
  </svg>
);

export const HeadOptionalManyIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...baseProps(props)} aria-hidden="true">
    <line x1="2" y1="8" x2="4" y2="8" />
    <circle cx="6" cy="8" r="2" />
    <path d="M9 8 L14 4 M9 8 L14 8 M9 8 L14 12" />
  </svg>
);
