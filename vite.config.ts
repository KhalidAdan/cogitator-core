import { cloudflare } from "@cloudflare/vite-plugin"
import { reactRouter } from "@react-router/dev/vite"
import { defineConfig } from "vite"

export default defineConfig({
  // the app lives at khld.dev/cogitator-core (React Router's `basename`); its built files go under the same
  // prefix, so Cloudflare serves them as static files without running the Worker
  build: { assetsDir: "cogitator-core/assets" },
  plugins: [cloudflare({ viteEnvironment: { name: "ssr" } }), reactRouter()],
  resolve: { tsconfigPaths: true },
  server: { port: 5173 }
})
