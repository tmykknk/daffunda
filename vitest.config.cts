async function createTestConfig() {
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  const { cloudflareTest } = await import("@cloudflare/vitest-pool-workers");
  const { defineConfig } = await import("vitest/config");

  return defineConfig({
    plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
    test: {
      include: ["test/**/*.test.ts"],
      coverage: {
        provider: "istanbul",
        include: ["src/**/*.ts"],
        reporter: ["text", "html"],
      },
    },
  });
}

export = createTestConfig;
