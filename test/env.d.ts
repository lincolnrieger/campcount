import type { D1Migration } from '@cloudflare/vitest-plugin';
import type { Env } from '../src/worker/env';

declare global {
  namespace Cloudflare {
    interface Env extends EnvBase {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}
type EnvBase = Env;
export {};
