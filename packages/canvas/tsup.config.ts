import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', catalog: 'src/catalog/index.ts' },
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
  ],
  outDir: 'dist',
});
