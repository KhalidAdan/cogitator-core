import type { Config } from "@react-router/dev/config"

export default {
  // served at khld.dev/cogitator-core, one site among others on the domain
  basename: "/cogitator-core",
  ssr: true,
  future: {
    v8_middleware: true,
    v8_passThroughRequests: true,
    v8_trailingSlashAwareDataRequests: true,
    v8_splitRouteModules: true,
    v8_viteEnvironmentApi: true
  }
} satisfies Config
