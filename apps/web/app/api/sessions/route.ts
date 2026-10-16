import { z } from "zod";
import {
  failure,
  getRecord,
  identity,
  readJson,
  saveRecord,
} from "../../../lib/server";
import { publicQuestion, type Question } from "../../../lib/schema";
import { score } from "../../../lib/exam";

type StoredSession = {
  id: string;
  questions: Question[];
  deadline: number | null;
  mode?: "review" | "timed";
  status?: "active" | "paused" | "submitted";
  pausedRemainingSeconds?: number | null;
  answers?: Record<string, string[]>;
  flags?: string[];
  index?: number;
};

function toPublic(session: StoredSession) {
  return {
    id: session.id,
    questions: session.questions.map(publicQuestion),
    deadline: session.deadline,
    mode: session.mode ?? (session.deadline ? "timed" : "review"),
    answers: session.answers ?? {},
    flags: session.flags ?? [],
    index: Math.max(0, Math.min(session.index ?? 0, session.questions.length - 1)),
    paused: session.status === "paused",
    pausedRemainingSeconds: session.pausedRemainingSeconds ?? null,
  };
}

function validateProgress(
  session: StoredSession,
  answers: Record<string, string[]>,
  flags: string[],
) {
  for (const [id, selected] of Object.entries(answers)) {
    const question = session.questions.find((item) => item.id === id);
    if (
      !question ||
      selected.length > question.selectionCount ||
      new Set(selected).size !== selected.length ||
      selected.some((option) => !question.options.some((item) => item.id === option))
    )
      throw new Error("BAD_REQUEST: invalid saved progress");
  }
  if (flags.some((id) => !session.questions.some((question) => question.id === id)))
    throw new Error("BAD_REQUEST: invalid saved progress");
}

async function currentSession(uid: string) {
  const pointer = await getRecord(uid, "state", "current-session");
  if (!pointer?.sessionId) return undefined;
  return getRecord(uid, "sessions", pointer.sessionId) as Promise<StoredSession | undefined>;
}

export async function GET(request: Request) {
  try {
    const session = await currentSession((await identity(request)).uid);
    if (!session || session.status === "submitted") return Response.json(null);
    return Response.json(toPublic(session));
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z
      .object({
        sessionId: z.string().uuid(),
        answers: z.record(z.string(), z.array(z.enum(["A", "B", "C", "D", "E"])).max(4)),
        flags: z.array(z.string()).max(1000),
        index: z.number().int().nonnegative(),
      })
      .safeParse(await readJson(request));
    if (!parsed.success) throw new Error("BAD_REQUEST: invalid saved progress");
    const session = await currentSession(user.uid);
    if (!session || session.id !== parsed.data.sessionId || session.status === "submitted")
      throw new Error("NOT_FOUND");
    validateProgress(session, parsed.data.answers, parsed.data.flags);
    const pausedRemainingSeconds = session.deadline
      ? Math.max(0, Math.ceil((session.deadline - Date.now()) / 1000))
      : null;
    const paused: StoredSession = {
      ...session,
      answers: parsed.data.answers,
      flags: parsed.data.flags,
      index: Math.min(parsed.data.index, session.questions.length - 1),
      deadline: null,
      pausedRemainingSeconds,
      status: "paused",
    };
    await saveRecord(user.uid, "sessions", session.id, paused);
    return Response.json(toPublic(paused));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z.object({ sessionId: z.string().uuid() }).safeParse(await readJson(request));
    if (!parsed.success) throw new Error("BAD_REQUEST: invalid session");
    const session = await currentSession(user.uid);
    if (!session || session.id !== parsed.data.sessionId || session.status === "submitted")
      throw new Error("NOT_FOUND");
    const resumed: StoredSession = {
      ...session,
      deadline:
        session.pausedRemainingSeconds === null || session.pausedRemainingSeconds === undefined
          ? null
          : Date.now() + session.pausedRemainingSeconds * 1000,
      pausedRemainingSeconds: null,
      status: "active",
    };
    await saveRecord(user.uid, "sessions", session.id, resumed);
    return Response.json(toPublic(resumed));
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z
      .object({
        sessionId: z.string().uuid(),
        questionId: z.string(),
        answers: z.record(z.string(), z.array(z.enum(["A", "B", "C", "D", "E"])).max(4)),
      })
      .safeParse(await readJson(request));
    if (!parsed.success) throw new Error("BAD_REQUEST: invalid answer check");
    const session = await currentSession(user.uid);
    if (!session || session.id !== parsed.data.sessionId || session.status === "submitted")
      throw new Error("NOT_FOUND");
    if ((session.mode ?? (session.deadline ? "timed" : "review")) !== "review")
      throw new Error("BAD_REQUEST: answer checks are only available in review mode");
    validateProgress(session, parsed.data.answers, []);
    const question = session.questions.find((item) => item.id === parsed.data.questionId);
    if (!question) throw new Error("BAD_REQUEST: unknown question");
    return Response.json(score([question], parsed.data.answers).review[0]);
  } catch (error) {
    return failure(error);
  }
}
