import { defineConfig } from "vitest/config";

// Local config so vitest never walks up into the fleet workspace root's config
// (which sets coverage thresholds for fleet's own packages).
export default defineConfig({
  test: { include: ["test/**/*.spec.ts"], environment: "node" }
});
