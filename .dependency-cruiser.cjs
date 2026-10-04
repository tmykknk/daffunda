module.exports = {
  forbidden: [
    { name: "no-cycles", severity: "error", from: {}, to: { circular: true } },
    {
      name: "domain-is-pure",
      severity: "error",
      from: { path: "^src/domain/" },
      to: {
        path: "^src/(service|repo|line)/|^src/index\\.ts$|(?:^|/)node_modules/hono(?:/|$)|^hono(?:/|$)",
      },
    },
    {
      name: "domain-and-line-do-not-access-repo",
      severity: "error",
      from: { path: "^src/(domain|line)/" },
      to: { path: "^src/repo/" },
    },
    {
      name: "production-does-not-import-tests",
      severity: "error",
      from: { path: "^src/" },
      to: { path: "^test/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: { extensions: [".ts", ".js", ".json"] },
  },
};
