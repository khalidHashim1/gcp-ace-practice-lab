export const dynamic = "force-dynamic";
import { z } from "zod";
import {
  readJson,
  identity,
  history,
  getRecord,
  finalizeAttempt,
  failure,
} from "../../../lib/server";
import { score } from "../../../lib/exam";
import type { Question } from "../../../lib/schema";
export async function GET(r: Request) {
  try {
    return Response.json(await history((await identity(r)).uid));
  } catch (e) {
    return failure(e);
  }
}
export async function POST(r: Request) {
  try {
    const user = await identity(r);
    const p = z
      .object({
        sessionId: z.string().uuid(),
        answers: z.record(
          z.string(),
          z.array(z.enum(["A", "B", "C", "D"])).max(4),
        ),
        flags: z.array(z.string()).max(81),
      })
      .safeParse(await readJson(r));
    if (!p.success) throw new Error("BAD_REQUEST: invalid answers");
    const session = await getRecord(user.uid, "sessions", p.data.sessionId);
    if (!session) throw new Error("NOT_FOUND");
    const existing = await getRecord(user.uid, "attempts", p.data.sessionId);
    if (existing) return Response.json(existing);
    const qs = session.questions as Question[];
    for (const [id, selected] of Object.entries(p.data.answers)) {
      const q = qs.find((q) => q.id === id);
      if (
        !q ||
        selected.length > q.selectionCount ||
        new Set(selected).size !== selected.length
      )
        throw new Error("BAD_REQUEST: invalid selection");
    }
    if (p.data.flags.some((id) => !qs.some((q) => q.id === id)))
      throw new Error("BAD_REQUEST: invalid flag");
    const late = session.deadline && Date.now() > session.deadline + 15000;
    const result = {
      id: p.data.sessionId,
      submittedAt: Date.now(),
      expired: Boolean(late),
      flags: p.data.flags,
      questions: qs.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        options: q.options,
        topic: q.topic,
      })),
      ...score(qs, late ? {} : p.data.answers),
    };
    return Response.json(
      await finalizeAttempt(user.uid, p.data.sessionId, result),
    );
  } catch (e) {
    return failure(e);
  }
}
