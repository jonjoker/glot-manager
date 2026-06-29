import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/backends/github.ts', 'src/backends/system.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  target: 'es2022',
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
