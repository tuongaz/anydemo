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
