import { describe, it, expect, vi, beforeAll } from "vitest";
const state = vi.hoisted(() => ({
  records: new Map<string, object>(),
  verify: vi.fn(async (token: string, revoked: boolean) => {
    if (!revoked || token === "bad") throw new Error("Invalid token");
    return {
      uid: token === "admin" ? "alice" : token,
      admin: token === "admin" || token === "guest-admin",
      firebase: { sign_in_provider: token.startsWith("guest") ? "anonymous" : "google.com" },
    };
  }),
}));
vi.mock("firebase-admin/app", () => ({
  getApps: () => [{}],
  initializeApp: () => ({}),
  applicationDefault: () => ({}),
}));
vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken: state.verify }),
}));
vi.mock("firebase-admin/firestore", () => ({
  getFirestore: () => ({
    runTransaction: async (callback: (t: object) => Promise<unknown>) =>
      callback({
        get: (ref: { get: () => Promise<unknown> }) => ref.get(),
        set: (ref: { set: (data: object) => Promise<void> }, data: object) =>
          ref.set(data),
      }),
    doc: (path: string) => ({
      get: async () => ({
        exists: state.records.has(path),
        data: () => state.records.get(path),
      }),
      set: async (data: object) => {
        state.records.set(path, data);
      },
      delete: async () => {
        state.records.delete(path);
      },
    }),
    collection: (path: string) => {
      const query = {
        orderBy: () => query,
        limit: () => query,
        get: async () => ({
          docs: [...state.records.entries()]
            .filter(([key]) => key.startsWith(path + "/"))
            .map(([, value]) => ({ data: () => value })),
        }),
      };
      return query;
    },
  }),
}));
beforeAll(() => {
  process.env.DATA_MODE = "firestore";
  vi.resetModules();
});
function req(token?: string, body?: unknown) {
  return new Request("http://localhost/api", {
    method: body ? "POST" : "GET",
    headers: {
      ...(token ? { Authorization: "Bearer " + token } : {}),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
describe("cloud authorization contract with SDK mocks", () => {
  it("rejects missing and invalid tokens with 401", async () => {
    const route = await import("../apps/web/app/api/attempts/route");
    expect((await route.GET(req())).status).toBe(401);
    expect((await route.GET(req("bad"))).status).toBe(401);
  });
  it("scopes sessions and histories to verified UID", async () => {
    const exams = await import("../apps/web/app/api/exams/route");
    const attempts = await import("../apps/web/app/api/attempts/route");
    const session = await (
      await exams.POST(req("alice", { mode: "practice", topic: "Networking" }))
    ).json();
    const body = { sessionId: session.id, answers: {}, flags: [] };
    expect((await attempts.POST(req("bob", body))).status).toBe(404);
    expect((await attempts.POST(req("alice", body))).status).toBe(200);
    expect(await (await attempts.GET(req("bob"))).json()).toEqual([]);
    expect(await (await attempts.GET(req("alice"))).json()).toHaveLength(1);
    expect(state.verify).toHaveBeenCalledWith("alice", true);
  });
  it("allows guest practice, grading, history and pause/resume only under its verified UID", async () => {
    const exams = await import("../apps/web/app/api/exams/route");
    const sessions = await import("../apps/web/app/api/sessions/route");
    const attempts = await import("../apps/web/app/api/attempts/route");
    for (const mode of ["review", "timed"]) {
      const session = await (await exams.POST(req("guest", { mode, ...(mode === "review" ? { topic: "Networking" } : { examId: "ace-practice-1" }) }))).json();
      const progress = { sessionId: session.id, answers: {}, flags: [], index: 0 };
      expect((await sessions.PATCH(req("guest-other", progress))).status).toBe(404);
      expect((await sessions.PATCH(req("guest", progress))).status).toBe(200);
      expect((await (await sessions.GET(req("guest"))).json()).paused).toBe(true);
      expect((await sessions.POST(req("guest", { sessionId: session.id }))).status).toBe(200);
      expect((await attempts.POST(req("guest", progress))).status).toBe(200);
    }
    expect(await (await attempts.GET(req("guest"))).json()).toHaveLength(2);
    expect(await (await attempts.GET(req("guest-other"))).json()).toEqual([]);
  });
  it("denies guests admin access even with an erroneously assigned admin claim", async () => {
    const admin = await import("../apps/web/app/api/admin/route");
    for (const token of ["guest", "guest-admin"]) {
      expect((await admin.GET(req(token))).status).toBe(403);
      expect((await admin.PUT(req(token, []))).status).toBe(403);
    }
  });
  it("requires the admin claim on the server", async () => {
    const admin = await import("../apps/web/app/api/admin/route");
    expect((await admin.GET(req("alice"))).status).toBe(403);
    expect((await admin.PUT(req("alice", []))).status).toBe(403);
    expect((await admin.GET(req("admin"))).status).toBe(200);
  });
});
