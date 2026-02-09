import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    entry: { plugin: 'src/editor/index.ts' },
    format: ['cjs'],
    sourcemap: true,
  },
  {
    entry: {
      unplugin: 'src/bundler/unplugin.ts',
      vite: 'src/bundler/vite.ts',
      rollup: 'src/bundler/rollup.ts',
      esbuild: 'src/bundler/esbuild.ts',
      webpack: 'src/bundler/webpack.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: ['solc', 'viem', 'unplugin', 'magic-string', 'typescript'],
  },
]);
