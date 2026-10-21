import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { POST as start } from "../apps/web/app/api/exams/route";
import { GET, PATCH, POST } from "../apps/web/app/api/sessions/route";
import { POST as submit } from "../apps/web/app/api/attempts/route";
import { getRecord, saveRecord } from "../apps/web/lib/server";

const request = (body: object) =>
  new Request("http://localhost/api/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
async function exam() {
  const response = await start(request({ mode: "timed" }));
  expect(response.status).toBe(200);
  return response.json();
}
function progress(s: any, extra = {}) {
  return {
    sessionId: s.id,
    answers: { [s.questions[0].id]: ["A"] },
    flags: [s.questions[0].id, s.questions[1].id],
    index: 4,
    ...extra,
  };
}
afterEach(() => vi.restoreAllMocks());
afterAll(() =>
  rm(process.env.LOCAL_DATA_DIR!, { recursive: true, force: true }),
);

describe("exam progress and timer reliability", () => {
  it("autosaves answers, two flags and position without pausing, then restores on refresh/resume", async () => {
    const s = await exam();
    const body = progress(s, { action: "save", progressRevision: 0 });
    const saved = await PATCH(request(body));
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      answers: body.answers,
      flags: body.flags,
      index: 4,
      paused: false,
      deadline: s.deadline,
      progressRevision: 1,
    });
    const restored = await (
      await GET(new Request("http://localhost/api"))
    ).json();
    expect(restored).toMatchObject({
      answers: body.answers,
      flags: body.flags,
      index: 4,
      deadline: s.deadline,
    });
    vi.spyOn(Date, "now").mockReturnValue(s.deadline - 60_000);
    const resumed = await (await POST(request({ sessionId: s.id }))).json();
    expect(resumed).toEqual(restored);
    expect(resumed.deadline - Date.now()).toBe(60_000);
  });
  it("active resume is idempotent and never refunds time elapsed during refresh", async () => {
    const s = await exam();
    vi.spyOn(Date, "now").mockReturnValue(s.deadline - 42_000);
    const responses = await Promise.all([
      POST(request({ sessionId: s.id })),
      POST(request({ sessionId: s.id })),
    ]);
    for (const r of responses)
      expect((await r.json()).deadline).toBe(s.deadline);
  });
  it("expired active resume preserves original deadline and late submission policy", async () => {
    const s = await exam();
    vi.spyOn(Date, "now").mockReturnValue(s.deadline + 20_000);
    expect(
      (await (await POST(request({ sessionId: s.id }))).json()).deadline,
    ).toBe(s.deadline);
    expect((await PATCH(request(progress(s)))).status).toBe(400);
    const attempt = await (await submit(request(progress(s)))).json();
    expect(attempt.expired).toBe(true);
    expect(attempt.review.every((q: any) => q.selected.length === 0)).toBe(
      true,
    );
  });
  it("duplicate and concurrent Pause requests preserve one budget; resume spends it once", async () => {
    const s = await exam();
    const clock = vi.spyOn(Date, "now").mockReturnValue(s.deadline - 61_500);
    const body = progress(s);
    const responses = await Promise.all(
      Array.from({ length: 6 }, () => PATCH(request(body))),
    );
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        paused: true,
        deadline: null,
        pausedRemainingSeconds: 61.5,
      });
    }
    clock.mockReturnValue(s.deadline + 300_000);
    const duplicate = await (await PATCH(request(body))).json();
    expect(duplicate.pausedRemainingSeconds).toBe(61.5);
    const resumes = await Promise.all([
      POST(request({ sessionId: s.id })),
      POST(request({ sessionId: s.id })),
    ]);
    for (const r of resumes)
      expect((await r.json()).deadline).toBe(Date.now() + 61_500);
  });
  it("rejects stale overlapping saves and never overwrites the winning progress", async () => {
    const s = await exam();
    const responses = await Promise.all([
      PATCH(request(progress(s, { action: "save", progressRevision: 0 }))),
      PATCH(
        request(progress(s, { action: "save", progressRevision: 0, index: 9 })),
      ),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 400]);
    const winning = await responses.find((r) => r.status === 200)!.json();
    expect((await getRecord("local-user", "sessions", s.id)).index).toBe(
      winning.index,
    );
    expect(
      (
        await PATCH(
          request(
            progress(s, { action: "save", progressRevision: 1, index: 12 }),
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await PATCH(
          request(progress(s, { action: "save", progressRevision: 0 })),
        )
      ).status,
    ).toBe(400);
    expect((await getRecord("local-user", "sessions", s.id)).index).toBe(12);
  });
  it("never confirms different progress as saved when another request already paused the session", async () => {
    const s = await exam();
    expect((await PATCH(request(progress(s)))).status).toBe(200);
    expect((await PATCH(request(progress(s, { index: 8 })))).status).toBe(400);
    expect((await getRecord("local-user", "sessions", s.id)).index).toBe(4);
  });
  it("does not let a delayed autosave unpause or overwrite an explicit pause", async () => {
    const s = await exam();
    expect(
      (await PATCH(request(progress(s, { progressRevision: 0 })))).status,
    ).toBe(200);
    expect(
      (
        await PATCH(
          request(
            progress(s, { action: "save", progressRevision: 0, index: 8 }),
          ),
        )
      ).status,
    ).toBe(400);
    expect((await getRecord("local-user", "sessions", s.id)).index).toBe(4);
  });
  it.each([
    { status: "active", deadline: null, pausedRemainingSeconds: null },
    { status: "active", deadline: 9999999999999, pausedRemainingSeconds: 30 },
    { status: "paused", deadline: null, pausedRemainingSeconds: null },
    { status: "paused", deadline: null, pausedRemainingSeconds: 0 },
    { status: "paused", deadline: 12345, pausedRemainingSeconds: 20 },
  ])("rejects inconsistent timed state %j", async (state) => {
    const s = await exam();
    await saveRecord("local-user", "sessions", s.id, {
      ...(await getRecord("local-user", "sessions", s.id)),
      ...state,
    });
    expect((await POST(request({ sessionId: s.id }))).status).toBe(400);
  });
  it("retains untimed practice and explicit Pause & Save", async () => {
    const s = await (await start(request({ mode: "practice" }))).json();
    const body = progress(s);
    const paused = await (await PATCH(request(body))).json();
    expect(paused).toMatchObject({
      paused: true,
      deadline: null,
      pausedRemainingSeconds: null,
      answers: body.answers,
    });
    const resumed = await (await POST(request({ sessionId: s.id }))).json();
    expect(resumed).toMatchObject({
      paused: false,
      deadline: null,
      flags: body.flags,
      index: 4,
    });
  });
  it("rejects invalid progress and requires a revision for active saves", async () => {
    const s = await exam();
    for (const extra of [
      { flags: ["foreign-question"] },
      { answers: { unknown: ["A"] } },
      { action: "save" },
    ])
      expect((await PATCH(request(progress(s, extra)))).status).toBe(400);
  });
});
