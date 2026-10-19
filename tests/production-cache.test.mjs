import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

// Run after npm run build. Exercise the same standalone server used by Docker;
// next dev cannot catch regressions in production prerendering/cache headers.
const root = fileURLToPath(new URL("../", import.meta.url));
const build = path.join(root, "apps/web/.next");
let server;
let baseURL;
let logs = "";

before(
  async () => {
    cpSync(
      path.join(build, "static"),
      path.join(build, "standalone/apps/web/.next/static"),
      { recursive: true },
    );
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolve, reject) =>
      reservation.close((error) => (error ? reject(error) : resolve())),
    );
    baseURL = `http://127.0.0.1:${port}`;
    server = spawn(
      process.execPath,
      [path.join(build, "standalone/apps/web/server.js")],
      {
        cwd: root,
        env: {
          ...process.env,
          NODE_ENV: "production",
          HOSTNAME: "127.0.0.1",
          PORT: String(port),
          NEXT_TELEMETRY_DISABLED: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    server.stdout.on("data", (data) => {
      logs += data;
    });
    server.stderr.on("data", (data) => {
      logs += data;
    });
    server.on("error", (error) => {
      logs += error.message;
    });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      assert.equal(server.exitCode, null, logs);
      try {
        const response = await fetch(`${baseURL}/api/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) return;
      } catch {
        /* Wait for the production server to bind its port. */
      }
      await delay(100);
    }
    throw new Error(`Production server did not become ready: ${logs}`);
  },
  { timeout: 25000 },
);

after(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill("SIGTERM");
    const force = setTimeout(() => server.kill("SIGKILL"), 5000);
    try {
      await stopped;
    } finally {
      clearTimeout(force);
    }
  }
});

function assertDocumentCache(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  const policy = response.headers.get("cache-control") ?? "";
  for (const directive of [
    "private",
    "no-cache",
    "no-store",
    "max-age=0",
    "must-revalidate",
  ]) {
    assert.ok(
      policy.split(/,\s*/).includes(directive),
      `Missing ${directive}: ${policy}`,
    );
  }
  assert.doesNotMatch(
    policy,
    /s-maxage=[1-9]|immutable|stale-while-revalidate/,
  );
}

test("HTML is not retained across deployments, with or without a query string", async () => {
  for (const route of ["/", "/?cache-regression=1"]) {
    const response = await fetch(`${baseURL}${route}`);
    assertDocumentCache(response);
    assert.equal(response.headers.get("x-nextjs-prerender"), null);
  }
  assertDocumentCache(await fetch(baseURL, { method: "HEAD" }));
  // An ETag from an older deployment must not resurrect stale HTML.
  assertDocumentCache(
    await fetch(baseURL, { headers: { "If-None-Match": '"old-deployment"' } }),
  );
});

test("hashed CSS and JavaScript remain immutable and support conditional requests", async () => {
  const html = await (await fetch(baseURL)).text();
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="([^\"]+)"/g)]
        .map((match) => match[1])
        .filter(
          (url) => url.startsWith("/_next/static/") && /\.(css|js)$/.test(url),
        ),
    ),
  ];
  assert.ok(
    assets.some((url) => url.endsWith(".css")),
    "Expected a CSS asset in production HTML",
  );
  assert.ok(
    assets.some((url) => url.endsWith(".js")),
    "Expected a JavaScript asset in production HTML",
  );
  for (const asset of assets) {
    const response = await fetch(`${baseURL}${asset}`);
    assert.equal(response.status, 200, asset);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
      asset,
    );
    const etag = response.headers.get("etag");
    assert.ok(etag, asset);
    assert.equal(
      (
        await fetch(`${baseURL}${asset}`, {
          cache: "force-cache",
          headers: { "If-None-Match": etag },
        })
      ).status,
      304,
      asset,
    );
  }
});

test("the health API retains its existing response and cache policy", async () => {
  const response = await fetch(`${baseURL}/api/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
  assert.equal(response.headers.get("cache-control"), null);
});
