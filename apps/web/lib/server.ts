import "server-only";
import { getApps, initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import source from "../../../data/questions.json";
import {
  bankSchema,
  examCatalogSchema,
  type Exam,
  type Question,
} from "./schema";
export const cloud = process.env.DATA_MODE === "firestore";
function ids(prefix: string, first: number, count = 60) {
  return Array.from(
    { length: count },
    (_, offset) => `${prefix}-${String(first + offset).padStart(3, "0")}`,
  );
}
const defaultExams: Exam[] = [
  {
    id: "ace-practice-1",
    title: "Practice exam 01",
    description: "A fixed, full-length Associate Cloud Engineer simulation.",
    questionBankId: "ace-practice-1",
    questionCount: 60,
    durationMinutes: 120,
    questionIds: ids("ace", 1),
  },
];
function requireSafeMode() {
  if (process.env.NODE_ENV === "production" && !cloud)
    throw new Error("Production requires DATA_MODE=firestore");
}
function admin() {
  return (
    getApps()[0] ??
    initializeApp({
      credential: applicationDefault(),
      projectId: process.env.GOOGLE_CLOUD_PROJECT,
    })
  );
}
export function db() {
  admin();
  return getFirestore();
}
const dir = process.env.LOCAL_DATA_DIR ?? path.join(process.cwd(), ".local");
export async function identity(request: Request) {
  requireSafeMode();
  if (!cloud) return { uid: "local-user", admin: true };
  admin();
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error("UNAUTHORIZED");
  try {
    const claims = await getAuth().verifyIdToken(token, true);
    return { uid: claims.uid, admin: claims.admin === true };
  } catch {
    throw new Error("UNAUTHORIZED");
  }
}
function bankDocument(bankId: string) {
  return bankId === "ace-practice-1"
    ? "config/question-bank"
    : `question-banks/${bankId}`;
}
export async function exams(): Promise<Exam[]> {
  requireSafeMode();
  if (cloud) {
    const snap = await db().doc("config/exams").get();
    return examCatalogSchema.parse(
      snap.exists ? snap.data()?.exams : defaultExams,
    );
  }
  try {
    return examCatalogSchema.parse(
      JSON.parse(await fs.readFile(path.join(dir, "exams.json"), "utf8")),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return defaultExams;
    throw e;
  }
}
export async function questions(
  bankId = "ace-practice-1",
): Promise<Question[]> {
  requireSafeMode();
  if (cloud) {
    const snap = await db().doc(bankDocument(bankId)).get();
    return bankSchema.parse(snap.exists ? snap.data()?.questions : source);
  }
  try {
    return bankSchema.parse(
      JSON.parse(
        await fs.readFile(
          path.join(
            /* turbopackIgnore: true */ dir,
            "question-banks",
            `${bankId}.json`,
          ),
          "utf8",
        ),
      ),
    );
  } catch (e) {
    if (
      (e as NodeJS.ErrnoException).code === "ENOENT" &&
      bankId === "ace-practice-1"
    )
      return bankSchema.parse(source);
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export async function saveQuestions(q: Question[], bankId = "ace-practice-1") {
  const data = bankSchema.parse(q);
  if (cloud) {
    await db().doc(bankDocument(bankId)).set({ questions: data });
    return;
  }
  const bankDir = path.join(/* turbopackIgnore: true */ dir, "question-banks");
  await fs.mkdir(bankDir, { recursive: true });
  const temp = path.join(
    /* turbopackIgnore: true */ dir,
    randomUUID() + ".tmp",
  );
  await fs.writeFile(temp, JSON.stringify(data));
  await fs.rename(
    temp,
    path.join(/* turbopackIgnore: true */ bankDir, `${bankId}.json`),
  );
}
export async function questionsForExam(exam: Exam): Promise<Question[]> {
  const bank = await questions(exam.questionBankId);
  const byId = new Map(bank.map((question) => [question.id, question]));
  const assigned = exam.questionIds.map((id) => byId.get(id));
  if (assigned.some((question) => !question))
    throw new Error("BAD_REQUEST: exam bank assignment is incomplete");
  return assigned as Question[];
}
export async function saveRecord(
  uid: string,
  collection: string,
  id: string,
  data: object,
) {
  if (cloud) {
    await db().doc(`users/${uid}/${collection}/${id}`).set(data);
    return;
  }
  await fs.mkdir(path.join(/* turbopackIgnore: true */ dir, uid, collection), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(/* turbopackIgnore: true */ dir, uid, collection, id + ".json"),
    JSON.stringify(data),
  );
}
export async function getRecord(uid: string, collection: string, id: string) {
  if (cloud) {
    return (await db().doc(`users/${uid}/${collection}/${id}`).get()).data();
  }
  try {
    return JSON.parse(
      await fs.readFile(
        path.join(
          /* turbopackIgnore: true */ dir,
          uid,
          collection,
          id + ".json",
        ),
        "utf8",
      ),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
}
export async function deleteRecord(uid: string, collection: string, id: string) {
  if (cloud) {
    await db().doc(`users/${uid}/${collection}/${id}`).delete();
    return;
  }
  try {
    await fs.unlink(
      path.join(/* turbopackIgnore: true */ dir, uid, collection, id + ".json"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}
export async function history(uid: string) {
  if (cloud) {
    const s = await db()
      .collection(`users/${uid}/attempts`)
      .orderBy("submittedAt", "desc")
      .limit(100)
      .get();
    return s.docs.map((d) => d.data());
  }
  try {
    const p = path.join(/* turbopackIgnore: true */ dir, uid, "attempts");
    const names = await fs.readdir(p);
    return (
      await Promise.all(
        names.map((n) => fs.readFile(path.join(p, n), "utf8").then(JSON.parse)),
      )
    )
      .sort((a, b) => b.submittedAt - a.submittedAt)
      .slice(0, 100);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}
export function failure(e: unknown) {
  const message = e instanceof Error ? e.message : "";
  const status =
    message === "UNAUTHORIZED"
      ? 401
      : message === "FORBIDDEN"
        ? 403
        : message === "NOT_FOUND"
          ? 404
          : message.startsWith("BAD_REQUEST")
            ? 400
            : 500;
  if (status === 500)
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "API request failed",
        error: message,
      }),
    );
  return Response.json(
    { error: status === 500 ? "Server error. Please retry." : message },
    { status },
  );
}

/** Bound imports below Firestore's document limit and reject malformed JSON. */
export async function readJson(request: Request, maxBytes = 700 * 1024) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("BAD_REQUEST: empty body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error(`BAD_REQUEST: body exceeds ${Math.floor(maxBytes / 1024)} KiB`);
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("BAD_REQUEST: malformed JSON");
  }
}
export async function finalizeAttempt<T extends object>(
  uid: string,
  id: string,
  data: T,
): Promise<T> {
  if (cloud) {
    const ref = db().doc(`users/${uid}/attempts/${id}`);
    return db().runTransaction(async (transaction) => {
      const existing = await transaction.get(ref);
      if (existing.exists) return existing.data() as T;
      transaction.set(ref, data);
      return data;
    });
  }
  const existing = await getRecord(uid, "attempts", id);
  if (existing) return existing as T;
  await saveRecord(uid, "attempts", id, data);
  return data;
}
