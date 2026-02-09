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
    entry: { plugin: 'src/plugin/index.ts' },
    format: ['cjs'],
    sourcemap: true,
  },
  {
    entry: {
      unplugin: 'src/build/unplugin.ts',
      vite: 'src/build/vite.ts',
      rollup: 'src/build/rollup.ts',
      esbuild: 'src/build/esbuild.ts',
      webpack: 'src/build/webpack.ts',
    },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    external: ['solc', 'viem', 'unplugin', 'magic-string', 'typescript'],
  },
]);
