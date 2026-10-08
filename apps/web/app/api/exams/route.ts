export const dynamic = "force-dynamic";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  readJson,
  identity,
  questions,
  saveRecord,
  failure,
} from "../../../lib/server";
import { publicQuestion } from "../../../lib/schema";
export async function POST(r: Request) {
  try {
    const user = await identity(r);
    const p = z
      .object({
        topic: z.string().optional(),
        mode: z.enum(["practice", "mock"]),
      })
      .safeParse(await readJson(r));
    if (!p.success) throw new Error("BAD_REQUEST: invalid exam");
    const qs = (await questions()).filter(
      (q) => !p.data.topic || q.topic === p.data.topic,
    );
    if (!qs.length) throw new Error("BAD_REQUEST: empty topic");
    const shuffled = qs
      .map((q) => ({ q, n: Math.random() }))
      .sort((a, b) => a.n - b.n)
      .map((x) => x.q);
    const id = randomUUID();
    const deadline =
      p.data.mode === "mock" ? Date.now() + 120 * 60 * 1000 : null;
    await saveRecord(user.uid, "sessions", id, {
      id,
      questions: shuffled,
      deadline,
      startedAt: Date.now(),
    });
    return Response.json({
      id,
      questions: shuffled.map(publicQuestion),
      deadline,
    });
  } catch (e) {
    return failure(e);
  }
}
