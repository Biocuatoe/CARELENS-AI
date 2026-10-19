import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            ENVIRONMENT: "test",
            ALLOWED_ORIGINS: "http://localhost:5173",
            // SHA-256 of the test admin token "test-admin-token-0123456789abcdef" (test/helpers.ts).
            ADMIN_TOKEN_SHA256: "5c3dac12081c73ec47965d6393ea1e412cef65beb4ad3e099810a2eea2e5c84a",
            ACCEPT_SIMULATED_SOURCES: "true",
            LEGACY_STREAM_ALLOWED_IPS: "127.0.0.1/32",
            // Production disables passwords and opens Google to viewers (wrangler.jsonc); tests start from the
            // conservative defaults and opt in per test.
            PASSWORD_SIGN_IN: "enabled",
            GOOGLE_OPEN_VIEWER_RECIPIENT_ID: "",
            // The production client id in wrangler.jsonc has no secret here; Google tests set their own test client.
            GOOGLE_CLIENT_ID: "",
            // Admin sign-in is off unless a test turns it on (the real list is a production secret).
            ADMIN_BOOTSTRAP_EMAILS: "",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
      include: ["test/**/*.test.ts"],
    },
  };
});
