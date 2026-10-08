import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";
import { localCoresignalLiveDemoEnabled } from "./lib/local-development";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ command, mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const localDevelopment = command === "serve"
    && process.env.NODE_ENV === "development"
    && process.env.LOCAL_DEV_AUTH_ENABLED === "true";
  const localEnvironment = {
    ...loadEnv(mode, process.cwd(), ""),
    ...process.env,
  };
  const localCoresignalKey = localEnvironment.CORESIGNAL_API_KEY?.trim() ?? "";
  const localCoresignalDemo = localDevelopment
    && localCoresignalLiveDemoEnabled(localEnvironment);
  const localRuntimeVariables: Record<string, string> = localDevelopment
    ? {
        NODE_ENV: "development",
        LOCAL_DEV_AUTH_ENABLED: "true",
        LOCAL_CORESIGNAL_LIVE_DEMO_ENABLED: localCoresignalDemo ? "true" : "false",
        LOCAL_CORESIGNAL_LIVE_DEMO_HOST: "127.0.0.1",
        CORESIGNAL_LIVE_ENABLED: localCoresignalDemo ? "true" : "false",
        CORESIGNAL_LIVE_SEARCH_MAX_RESULTS: "1",
        CORESIGNAL_LIVE_REFRESH_MAX_PROFILES: "1",
        ...(localCoresignalDemo
          ? { CORESIGNAL_API_KEY: localCoresignalKey }
          : {}),
        LUSHA_LIVE_ENABLED: "false",
        LUSHA_SIGNALS_LIVE_ENABLED: "false",
        MAIL_MODE: "mock",
        MAIL_LIVE_ENABLED: "false",
        GMAIL_SEND_SCOPE_CONFIRMED: "false",
        APP_PUBLIC_URL: "http://localhost:3000",
        APP_BASE_PATH: "/",
        ...(process.env.INTELLIGENCE_SERVICE_URL?.trim()
          ? { INTELLIGENCE_SERVICE_URL: process.env.INTELLIGENCE_SERVICE_URL.trim() }
          : {}),
        ...(process.env.INTELLIGENCE_SERVICE_SECRET?.trim()
          ? { INTELLIGENCE_SERVICE_SECRET: process.env.INTELLIGENCE_SERVICE_SECRET.trim() }
          : {}),
      }
    : {};

  return {
    server: {
      host: localCoresignalDemo ? "127.0.0.1" : "0.0.0.0",
      allowedHosts: ["terminal.local"],
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        inspectorPort: false,
        config: { ...localBindingConfig, vars: localRuntimeVariables },
      }),
    ],
  };
});
