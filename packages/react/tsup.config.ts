import { defineConfig } from 'tsup';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const DIRECTIVE = '"use client";\n';

/**
 * Prepend the `"use client"` directive to every emitted JS chunk. esbuild
 * strips module-level directives when bundling/splitting, so we re-add it after
 * the build — guaranteeing it is the first line for React Server Component
 * consumers (Next.js App Router et al.).
 */
async function addUseClient(): Promise<void> {
  const dir = join(process.cwd(), 'dist');
  const files = await readdir(dir);
  await Promise.all(
    files
      .filter((f) => f.endsWith('.js') || f.endsWith('.cjs'))
      .map(async (f) => {
        const path = join(dir, f);
        const code = await readFile(path, 'utf8');
        if (!code.startsWith(DIRECTIVE.trim())) {
          await writeFile(path, DIRECTIVE + code);
        }
      }),
  );
}

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  treeshake: true,
  splitting: true, // keep the lazy-loaded editor dialog in its own chunk
  target: 'es2022',
  external: ['react', 'react-dom', '@glot-manager/core'],
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
  onSuccess: addUseClient,
});
