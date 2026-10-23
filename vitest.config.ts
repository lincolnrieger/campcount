import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        main: './src/worker/index.ts',
        wrangler: { configPath: './wrangler.jsonc', environment: 'dev' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: 'test',
            AUTH_SECRET: 'test-secret-not-for-production-0123456789',
          },
        },
      }),
    ],
    test: {
      setupFiles: ['./test/setup.ts'],
      include: ['test/**/*.test.ts'],
    },
  };
});
