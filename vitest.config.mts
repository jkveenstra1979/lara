import { defineConfig } from "vitest/config";


export default defineConfig({
  resolve: {
    // Zelfde alias als tsconfig, zodat "@/lib/…" ook in tests werkt.
    alias: { "@": import.meta.dirname },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
