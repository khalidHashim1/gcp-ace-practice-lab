import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  timeout: 60000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3000", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -w apps/web -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000/api/health",
    env: {
      DATA_MODE: "local",
      QUESTION_BANK_PATH: "",
      LOCAL_DATA_DIR: path.join(tmpdir(), `ace-e2e-${process.pid}`),
    },
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
