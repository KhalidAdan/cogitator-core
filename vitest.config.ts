import { defineConfig } from "vitest/config"

// Separate from vite.config.ts on purpose: the React Router plugin is for the
// app build and has nothing to offer unit tests.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000
  }
})
