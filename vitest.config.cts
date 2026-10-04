async function createTestConfig() {
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.WRANGLER_SEND_METRICS ??= "false";

  const { cloudflareTest, readD1Migrations } = await import(
    "@cloudflare/vitest-pool-workers"
  );
  const migrations = await readD1Migrations("./migrations");
  const { defineConfig } = await import("vitest/config");

  return defineConfig({
    test: {
      projects: [
        {
          plugins: [
            cloudflareTest({
              wrangler: { configPath: "./wrangler.toml" },
              miniflare: { bindings: { TEST_MIGRATIONS: migrations } },
            }),
          ],
          test: {
            name: "workers",
            include: ["test/**/*.test.ts"],
            exclude: ["test/tooling/**"],
          },
        },
        {
          test: {
            name: "tooling",
            environment: "node",
            include: ["test/tooling/**/*.test.ts"],
          },
        },
      ],
      coverage: {
        provider: "istanbul",
        include: ["src/**/*.ts"],
        reporter: ["text", "html"],
        thresholds: {
          statements: 85,
          branches: 85,
          functions: 85,
          lines: 85,
          "src/domain/**": {
            statements: 95,
            branches: 95,
            functions: 95,
            lines: 95,
          },
          "src/service/**": {
            statements: 90,
            branches: 90,
            functions: 90,
            lines: 90,
          },
        },
      },
    },
  });
}

export = createTestConfig;
