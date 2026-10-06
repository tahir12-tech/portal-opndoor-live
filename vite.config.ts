// vitest/config, not vite: `defineConfig` from 'vite' has no `test` key, so the
// block below is a type error under tsc -b. Same signature otherwise.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    /*
     * WITHOUT THIS, vitest globs the whole repo. Its default include is
     * `**\/*.{test,spec}.?(c|m)[jt]s?(x)` minus node_modules, which picks up the
     * DENO tests under supabase/functions. Those import from https://deno.land,
     * which Node's ESM loader cannot resolve, so they fail with "Only URLs with a
     * scheme in: file, data, and node are supported" and turn a clean run red for
     * a reason unrelated to the client.
     *
     * The two suites are genuinely separate and run separately:
     *   npm test          the client, here
     *   deno test supabase/functions/_shared/   the Edge Function helpers
     */
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules/**', 'dist/**', 'supabase/**'],
  },
});
