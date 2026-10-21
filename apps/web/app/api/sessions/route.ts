import { z } from "zod";
import {
  failure,
  getRecord,
  identity,
  readJson,
  updateSession,
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
  progressRevision?: number;
};

function toPublic(session: StoredSession) {
  return {
    id: session.id,
    progressRevision: session.progressRevision ?? 0,
    questions: session.questions.map(publicQuestion),
    deadline: session.deadline,
    mode: session.mode ?? (session.deadline ? "timed" : "review"),
    answers: session.answers ?? {},
    flags: session.flags ?? [],
    index: Math.max(
      0,
      Math.min(session.index ?? 0, session.questions.length - 1),
    ),
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
      selected.some(
        (option) => !question.options.some((item) => item.id === option),
      )
    )
      throw new Error("BAD_REQUEST: invalid saved progress");
  }
  if (
    flags.some(
      (id) => !session.questions.some((question) => question.id === id),
    )
  )
    throw new Error("BAD_REQUEST: invalid saved progress");
}

function validateTiming(session: StoredSession) {
  if (
    session.status &&
    session.status !== "active" &&
    session.status !== "paused"
  )
    throw new Error("BAD_REQUEST: invalid session state");
  const timed =
    (session.mode ?? (session.deadline ? "timed" : "review")) === "timed";
  if (!timed) return false;
  if (session.status === "paused") {
    if (
      session.deadline !== null ||
      !Number.isFinite(session.pausedRemainingSeconds) ||
      session.pausedRemainingSeconds! <= 0
    )
      throw new Error(
        "BAD_REQUEST: paused timed session has no remaining budget",
      );
  } else if (
    !Number.isFinite(session.deadline) ||
    !session.deadline ||
    session.pausedRemainingSeconds != null
  ) {
    throw new Error("BAD_REQUEST: timed session has inconsistent timer state");
  }
  return true;
}

async function currentSession(uid: string) {
  const pointer = await getRecord(uid, "state", "current-session");
  if (!pointer?.sessionId) return undefined;
  return getRecord(uid, "sessions", pointer.sessionId) as Promise<
    StoredSession | undefined
  >;
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
        action: z.enum(["save", "pause"]).default("pause"),
        progressRevision: z.number().int().nonnegative().optional(),
        answers: z.record(
          z.string(),
          z.array(z.enum(["A", "B", "C", "D", "E"])).max(4),
        ),
        flags: z.array(z.string()).max(1000),
        index: z.number().int().nonnegative(),
      })
      .safeParse(await readJson(request));
    if (!parsed.success) throw new Error("BAD_REQUEST: invalid saved progress");
    const paused = await updateSession<StoredSession>(
      user.uid,
      parsed.data.sessionId,
      (session) => {
        if (
          !session ||
          session.id !== parsed.data.sessionId ||
          session.status === "submitted"
        )
          throw new Error("NOT_FOUND");
        validateProgress(session, parsed.data.answers, parsed.data.flags);
        const revision = session.progressRevision ?? 0;
        const timed = validateTiming(session);
        // A duplicate Pause must return the original budget, even on a transaction retry.
        if (session.status === "paused" && parsed.data.action === "pause") {
          const sameAnswers =
            JSON.stringify(session.answers ?? {}) ===
            JSON.stringify(parsed.data.answers);
          const sameFlags =
            JSON.stringify(session.flags ?? []) ===
            JSON.stringify(parsed.data.flags);
          if (
            !sameAnswers ||
            !sameFlags ||
            session.index !==
              Math.min(parsed.data.index, session.questions.length - 1)
          )
            throw new Error(
              "BAD_REQUEST: paused progress differs; reopen the saved session",
            );
          return session;
        }
        if (session.status === "paused")
          throw new Error(
            "BAD_REQUEST: session is paused; resume before saving",
          );
        if (
          parsed.data.progressRevision !== undefined &&
          parsed.data.progressRevision !== revision
        )
          throw new Error(
            "BAD_REQUEST: progress changed in another request; reopen the saved session",
          );
        if (
          parsed.data.action === "save" &&
          parsed.data.progressRevision === undefined
        )
          throw new Error(
            "BAD_REQUEST: active saves require a progress revision",
          );
        if (timed && session.deadline! <= Date.now())
          throw new Error(
            "BAD_REQUEST: exam expired; submit with the original deadline",
          );
        const pause = parsed.data.action === "pause";
        return {
          ...session,
          answers: parsed.data.answers,
          flags: parsed.data.flags,
          index: Math.min(parsed.data.index, session.questions.length - 1),
          progressRevision: revision + 1,
          deadline: pause ? null : session.deadline,
          pausedRemainingSeconds:
            pause && timed
              ? Math.max(0, (session.deadline! - Date.now()) / 1000)
              : null,
          status: pause ? "paused" : "active",
        };
      },
    );
    return Response.json(toPublic(paused));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const parsed = z
      .object({ sessionId: z.string().uuid() })
      .safeParse(await readJson(request));
    if (!parsed.success) throw new Error("BAD_REQUEST: invalid session");
    const resumed = await updateSession<StoredSession>(
      user.uid,
      parsed.data.sessionId,
      (session) => {
        if (
          !session ||
          session.id !== parsed.data.sessionId ||
          session.status === "submitted"
        )
          throw new Error("NOT_FOUND");
        const timed = validateTiming(session);
        if (session.status !== "paused") {
          // Keep expired deadlines too: the existing submission policy must still
          // grade late submissions as expired, rather than refunding refresh time.
          return session;
        }
        return {
          ...session,
          deadline: timed
            ? Date.now() + session.pausedRemainingSeconds! * 1000
            : null,
          pausedRemainingSeconds: null,
          status: "active",
          progressRevision: (session.progressRevision ?? 0) + 1,
        };
      },
    );
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
        answers: z.record(
          z.string(),
          z.array(z.enum(["A", "B", "C", "D", "E"])).max(4),
        ),
      })
      .safeParse(await readJson(request));
    if (!parsed.success) throw new Error("BAD_REQUEST: invalid answer check");
    const session = (await getRecord(
      user.uid,
      "sessions",
      parsed.data.sessionId,
    )) as StoredSession | undefined;
    if (
      !session ||
      session.id !== parsed.data.sessionId ||
      session.status === "submitted"
    )
      throw new Error("NOT_FOUND");
    if ((session.mode ?? (session.deadline ? "timed" : "review")) !== "review")
      throw new Error(
        "BAD_REQUEST: answer checks are only available in review mode",
      );
    validateProgress(session, parsed.data.answers, []);
    const question = session.questions.find(
      (item) => item.id === parsed.data.questionId,
    );
    if (!question) throw new Error("BAD_REQUEST: unknown question");
    return Response.json(score([question], parsed.data.answers).review[0]);
  } catch (error) {
    return failure(error);
  }
}
