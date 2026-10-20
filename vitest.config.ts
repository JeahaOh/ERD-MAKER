import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['app/tests/unit/**/*.test.ts'], testTimeout: 20_000 } });
