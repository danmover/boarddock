import { defineConfig } from 'vitest/config';

// The whole collision matrix (npm run collisions), apart from npm test's quick racks.
export default defineConfig({
  test: { include: ['tests/collide/**/*.collide.ts'], environment: 'node', testTimeout: 600_000 },
});
