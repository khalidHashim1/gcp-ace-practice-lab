export const dynamic = "force-dynamic";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  readJson,
  exams,
  identity,
  questions,
  questionsForExam,
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
        examId: z.string().optional(),
      })
      .safeParse(await readJson(r));
    if (!p.success) throw new Error("BAD_REQUEST: invalid exam");
    const catalog = await exams();
    const exam = catalog.find(
      (item) => item.id === (p.data.examId ?? "ace-practice-1"),
    );
    if (!exam) throw new Error("BAD_REQUEST: unknown exam");
    const qs =
      p.data.mode === "mock"
        ? await questionsForExam(exam)
        : (await questions(exam.questionBankId)).filter(
            (q) => !p.data.topic || q.topic === p.data.topic,
          );
    if (!qs.length) throw new Error("BAD_REQUEST: empty topic");
    const shuffled = qs
      .map((q) => ({ q, n: Math.random() }))
      .sort((a, b) => a.n - b.n)
      .map((x) => x.q);
    const sessionQuestions = p.data.mode === "mock" ? shuffled : shuffled;
    const id = randomUUID();
    const deadline =
      p.data.mode === "mock"
        ? Date.now() + exam.durationMinutes * 60 * 1000
        : null;
    await saveRecord(user.uid, "sessions", id, {
      id,
      examId: exam.id,
      questions: sessionQuestions,
      deadline,
      startedAt: Date.now(),
    });
    return Response.json({
      id,
      questions: sessionQuestions.map(publicQuestion),
      deadline,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function GET() {
  try {
    const catalog = await exams();
    const payload = await Promise.all(
      catalog.map(async (exam) => {
        const bank = await questions(exam.questionBankId);
        const available = exam.questionIds.every((id) =>
          bank.some((question) => question.id === id),
        );
        return {
          ...exam,
          available,
          totalQuestions: bank.length,
          verifiedQuestions: bank.filter((q) => q.verification === "verified")
            .length,
        };
      }),
    );
    return Response.json(payload);
  } catch (e) {
    return failure(e);
  }
}
