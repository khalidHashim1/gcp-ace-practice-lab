import { afterAll, describe, it, expect, vi } from "vitest";
import { rm } from "node:fs/promises";
import { GET as getQuestions } from "../apps/web/app/api/questions/route";
import { POST as start } from "../apps/web/app/api/exams/route";
import {
  GET as history,
  POST as submit,
} from "../apps/web/app/api/attempts/route";
import {
  GET as getAdmin,
  PUT as putAdmin,
} from "../apps/web/app/api/admin/route";
function request(body: unknown) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
afterAll(async () => {
  await rm(process.env.LOCAL_DATA_DIR!, { recursive: true, force: true });
});
describe("local API integration", () => {
  it("rejects malformed and oversized JSON", async () => {
    const malformed = new Request("http://localhost/api", {
      method: "POST",
      body: "{",
    });
    expect((await start(malformed)).status).toBe(400);
    const oversized = new Request("http://localhost/api", {
      method: "PUT",
      body: " ".repeat(701 * 1024),
    });
    expect((await putAdmin(oversized)).status).toBe(400);
  });
  it("enforces the server deadline for late submissions", async () => {
    const session = await (await start(request({ mode: "mock" }))).json();
    const now = vi.spyOn(Date, "now").mockReturnValue(session.deadline + 20000);
    try {
      const attempt = await (
        await submit(
          request({
            sessionId: session.id,
            answers: { [session.questions[0].id]: ["A"] },
            flags: [],
          }),
        )
      ).json();
      expect(attempt.expired).toBe(true);
      expect(attempt.review[0].selected).toEqual([]);
    } finally {
      now.mockRestore();
    }
  });

  it("strips private fields from public questions", async () => {
    const res = await getQuestions();
    expect(res.status).toBe(200);
    const qs = await res.json();
    expect(qs).toHaveLength(81);
    expect(qs[0]).not.toHaveProperty("correctOptionIds");
  });
  it("starts, validates, submits and persists an ungraded mock", async () => {
    const session = await (await start(request({ mode: "mock" }))).json();
    expect(session.questions).toHaveLength(81);
    expect(session.deadline).toBeGreaterThan(Date.now());
    expect(session.questions[0]).not.toHaveProperty("correctOptionIds");
    const bad = await submit(
      request({
        sessionId: session.id,
        answers: { [session.questions[0].id]: ["A", "A"] },
        flags: [],
      }),
    );
    expect(bad.status).toBe(400);
    const payload = {
      sessionId: session.id,
      answers: { [session.questions[0].id]: ["A"] },
      flags: [session.questions[0].id],
    };
    const attempt = await (await submit(request(payload))).json();
    expect(attempt.percentage).toBeNull();
    expect(attempt.ungraded).toBe(81);
    const retry = await (
      await submit(request({ ...payload, answers: {} }))
    ).json();
    expect(retry).toEqual(attempt);
    const saved = await (
      await history(new Request("http://localhost/api"))
    ).json();
    expect(saved.some((a: { id: string }) => a.id === session.id)).toBe(true);
  });
  it("rejects unknown sessions and empty topics", async () => {
    expect(
      (await start(request({ mode: "practice", topic: "missing" }))).status,
    ).toBe(400);
    expect(
      (
        await submit(
          request({
            sessionId: "c2bd6086-0463-4a8d-b08c-79a39aff4af5",
            answers: {},
            flags: [],
          }),
        )
      ).status,
    ).toBe(404);
  });
  it("validates admin imports and snapshots verified keys for scoring", async () => {
    const req = new Request("http://localhost/api");
    const original = await (await getAdmin(req)).json();
    const verified = {
      ...original[0],
      verification: "verified",
      correctOptionIds: ["A"],
      explanation: "Integration fixture explanation",
      references: ["https://docs.cloud.google.com/vpc/docs/vpc"],
    };
    expect(
      (await putAdmin(request([{ ...verified, explanation: null }]))).status,
    ).toBe(400);
    expect((await putAdmin(request([verified]))).status).toBe(200);
    const session = await (await start(request({ mode: "practice" }))).json();
    expect(session.questions[0]).not.toHaveProperty("correctOptionIds");
    await putAdmin(request(original));
    const result = await (
      await submit(
        request({
          sessionId: session.id,
          answers: { [verified.id]: ["A"] },
          flags: [],
        }),
      )
    ).json();
    expect(result.percentage).toBe(100);
    expect(result.review[0].explanation).toBe(verified.explanation);
  });
  it("rejects local authorization when serving production", async () => {
    const before = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect((await history(new Request("http://localhost/api"))).status).toBe(
        500,
      );
    } finally {
      process.env.NODE_ENV = before;
    }
  });
});
