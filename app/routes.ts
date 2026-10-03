import { index, prefix, route, type RouteConfig } from "@react-router/dev/routes"

export default [
  index("routes/home.tsx"),

  ...prefix("lists", [
    index("routes/lists.tsx"),
    route("import", "routes/lists.import.tsx"),
    // One list: the layout owns the list's data, its options and every change to them.
    route(":listId", "routes/list.tsx", [
      index("routes/list.matrix.tsx"),
      route("units/:unitId", "routes/list.unit.tsx"),
      route("targets/:targetId", "routes/list.target.tsx"),
      route("rules", "routes/list.rules.tsx"),
      route("check", "routes/list.check.tsx")
    ]),
    route(":listId/export.json", "routes/list.export.ts")
  ]),

  ...prefix("library", [
    index("routes/library.tsx"),
    route(":ruleId", "routes/library.rule.tsx")
  ]),

  ...prefix("database", [
    index("routes/database.tsx"),
    route("datasheets", "routes/database.datasheets.tsx"),
    route("datasheets/:datasheetId", "routes/database.datasheet.tsx")
  ]),

  route("theme", "routes/theme.ts"),

  // accounts: no sign-up; the owner creates them (the first one through /setup)
  route("sign-in", "routes/sign-in.tsx"),
  route("sign-out", "routes/sign-out.ts"),
  route("setup", "routes/setup.tsx"),
  route("accounts", "routes/accounts.tsx")
] satisfies RouteConfig
