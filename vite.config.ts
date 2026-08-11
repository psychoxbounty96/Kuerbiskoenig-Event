import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const pagesRoot = resolve(projectRoot, "deployment/github-pages/site");

function normalizeBasePath(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized === "/") return "/";
  return `/${normalized.replace(/^\/+|\/+$/g, "")}/`;
}

function repositoryBasePath(explicitBasePath: string) {
  if (explicitBasePath) return normalizeBasePath(explicitBasePath);
  const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
  if (!repositoryName || repositoryName.endsWith(".github.io")) return "/";
  return `/${repositoryName}/`;
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, projectRoot, "");
  const read = (name: string, fallback = "") => process.env[name] || env[name] || fallback;
  const provider = read("VITE_DATA_PROVIDER", command === "serve" ? "mock" : "mock");
  const eventSlug = read("VITE_EVENT_SLUG", "halloween-2026");
  const supabaseUrl = read("VITE_SUPABASE_URL");
  const publishableKey = read("VITE_SUPABASE_PUBLISHABLE_KEY");
  const overlayStreamer = read("VITE_OVERLAY_STREAMER", "nachtfalter");

  if (provider === "supabase" && command === "build") {
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
      throw new Error("VITE_SUPABASE_URL fehlt oder ist keine gültige Supabase-Projekt-URL.");
    }
    if (!publishableKey.startsWith("sb_publishable_") && publishableKey.split(".").length !== 3) {
      throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY fehlt oder ist kein Publishable-/Legacy-Anon-Key.");
    }
  }

  return {
    root: pagesRoot,
    base: repositoryBasePath(read("VITE_BASE_PATH")),
    publicDir: resolve(projectRoot, "public"),
    plugins: [react()],
    define: {
      "process.env.NEXT_PUBLIC_DATA_PROVIDER": JSON.stringify(provider),
      "process.env.NEXT_PUBLIC_EVENT_SLUG": JSON.stringify(eventSlug),
      "process.env.NEXT_PUBLIC_STREAMER_SLUG": JSON.stringify(overlayStreamer),
      "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify(supabaseUrl),
      "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(publishableKey),
      "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify(""),
    },
    build: {
      outDir: resolve(projectRoot, "github-pages-dist"),
      emptyOutDir: true,
      rollupOptions: {
        input: {
          index: resolve(pagesRoot, "index.html"),
          admin: resolve(pagesRoot, "admin/index.html"),
          overlay: resolve(pagesRoot, "overlay/index.html"),
        },
      },
    },
  };
});
