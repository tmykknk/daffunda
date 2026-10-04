declare module "cloudflare:workers" {
  export const env: Readonly<{
    DB: import("@cloudflare/workers-types").D1Database;
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
  }>;
}

declare module "cloudflare:test" {
  export function applyD1Migrations(
    db: import("@cloudflare/workers-types").D1Database,
    migrations: import("@cloudflare/vitest-pool-workers").D1Migration[],
    migrationsTableName?: string,
  ): Promise<void>;
  export function reset(): Promise<void>;
}
