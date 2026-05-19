#!/usr/bin/env node
// Rasterize apps/web/public/icon-source.svg into PWA-icon PNG variants.
// Invoke manually after editing icon-source.svg; the generated PNGs are committed.
//
//   cd apps/web && bun run icons
//
// Produces:
//   public/icon-192.png           — 192×192 (manifest "any")
//   public/icon-512.png           — 512×512 (manifest "any")
//   public/icon-maskable-512.png  — 512×512 with the glyph inset into a 410×410
//                                   safe-zone (manifest "maskable" — Android/Chrome
//                                   crop the outer ~10% for adaptive icon masks).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, '..', 'public');
const sourcePath = resolve(publicDir, 'icon-source.svg');
const sourceSvg = readFileSync(sourcePath, 'utf8');

function renderToPng(svg, size, outName) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  const png = resvg.render().asPng();
  const outPath = resolve(publicDir, outName);
  writeFileSync(outPath, png);
  console.log(`wrote ${outName} — ${png.byteLength} bytes`);
}

// "any"-purpose icons rasterize the source SVG directly.
renderToPng(sourceSvg, 192, 'icon-192.png');
renderToPng(sourceSvg, 512, 'icon-512.png');

// "maskable"-purpose icon: wrap the source SVG in a 512×512 canvas with the same
// #09090b background filling the whole frame, and place the source content
// scaled to 410×410 offset by 51px on each axis so OS masks can crop the outer
// ~10% without clipping the glyph.
const innerWithPosition = sourceSvg.replace(
  /<svg\b[^>]*>/,
  '<svg x="51" y="51" width="410" height="410" viewBox="0 0 512 512">',
);
const maskableSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#09090b"/>
  ${innerWithPosition}
</svg>
`;
renderToPng(maskableSvg, 512, 'icon-maskable-512.png');
