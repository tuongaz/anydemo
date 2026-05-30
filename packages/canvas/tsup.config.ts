import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', catalog: 'src/catalog/index.ts', types: 'src/types.ts' },
  format: ['esm'],
  dts: true,
  sourcemap: true,
  clean: false,
  external: [
    'react',
    'react-dom',
    '@xyflow/react',
    'lucide-react',
    'react-markdown',
    'remark-gfm',
    'recharts',
    'shiki',
    'mermaid',
    '@iconify/react',
    '@iconify-json/logos',
  ],
  outDir: 'dist',
});
