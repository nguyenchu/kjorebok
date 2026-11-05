import { defineConfig } from "vitest/config";

// Ukeberegningene regner i lokal tid. Lås tidssonen til norsk tid, så testene
// for sommertid treffer de faktiske overgangene og gir samme svar på alle maskiner.
process.env.TZ = "Europe/Oslo";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
