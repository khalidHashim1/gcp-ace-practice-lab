import { z } from "zod";
export const questionSchema = z
  .object({
    // The first bank uses ace-001…; additional private banks use a distinct
    // stable prefix (for example ace2-001). IDs must remain stable because
    // attempts snapshot and refer to them.
    id: z.string().regex(/^[a-z][a-z0-9]*-\d{3}$/),
    number: z.number().int().positive(),
    prompt: z.string().min(10),
    options: z
      .array(
        z.object({
          id: z.enum(["A", "B", "C", "D", "E"]),
          text: z.string().min(1),
        }),
      )
      .min(4)
      .max(5),
    selectionCount: z.number().int().min(1).max(4),
    topic: z.string().min(1),
    verification: z.enum(["ungraded", "verified"]),
    correctOptionIds: z.array(z.enum(["A", "B", "C", "D", "E"])),
    explanation: z.string().nullable(),
    references: z.array(
      z
        .string()
        .url()
        .refine((v) => {
          try {
            const url = new URL(v);
            return (
              url.protocol === "https:" &&
              [
                "cloud.google.com",
                "docs.cloud.google.com",
                "firebase.google.com",
              ].includes(url.hostname)
            );
          } catch {
            return false;
          }
        }),
    ),
  })
  .superRefine((q, ctx) => {
    if (new Set(q.options.map((o) => o.id)).size !== q.options.length)
      ctx.addIssue({ code: "custom", message: "Duplicate options" });
    if (
      q.verification === "verified" &&
      (q.correctOptionIds.length !== q.selectionCount ||
        new Set(q.correctOptionIds).size !== q.selectionCount ||
        !q.explanation ||
        !q.references.length)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Verified questions require complete key, explanation and official references",
      });
    if (
      q.verification === "ungraded" &&
      (q.correctOptionIds.length || q.explanation || q.references.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Ungraded questions cannot contain a key",
      });
  });
export const bankSchema = z
  .array(questionSchema)
  .min(1)
  .superRefine((qs, ctx) => {
    if (new Set(qs.map((q) => q.id)).size !== qs.length)
      ctx.addIssue({ code: "custom", message: "Duplicate IDs" });
  });
export const examSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: z.string().min(1).max(80),
    description: z.string().min(1).max(240),
    questionBankId: z.string().regex(/^[a-z][a-z0-9-]*$/),
    questionCount: z.number().int().min(1).max(60),
    durationMinutes: z.number().int().min(1).max(240),
    // Published exams are immutable assignments, not random draws from a pool.
    questionIds: z
      .array(z.string().regex(/^[a-z][a-z0-9]*-\d{3}$/))
      .min(1)
      .max(60),
  })
  .superRefine((exam, ctx) => {
    if (exam.questionIds.length !== exam.questionCount)
      ctx.addIssue({
        code: "custom",
        message: "Exam must assign exactly questionCount questions",
      });
    if (new Set(exam.questionIds).size !== exam.questionIds.length)
      ctx.addIssue({
        code: "custom",
        message: "Exam cannot assign a question more than once",
      });
  });
export const examCatalogSchema = z.array(examSchema).min(1);
export type Question = z.infer<typeof questionSchema>;
export type Exam = z.infer<typeof examSchema>;
export type PublicQuestion = Omit<
  Question,
  "correctOptionIds" | "explanation" | "references"
>;
export function publicQuestion(q: Question): PublicQuestion {
  const { correctOptionIds, explanation, references, ...safe } = q;
  void correctOptionIds;
  void explanation;
  void references;
  return safe;
}
