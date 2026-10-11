import { z } from "zod";
export const optionIdSchema = z.enum(["A", "B", "C", "D", "E"]);
export const questionSchema = z
  .object({
    id: z.string().regex(/^ace-\d{3}$/),
    number: z.number().int().positive(),
    prompt: z.string().min(10),
    options: z
      .array(z.object({ id: optionIdSchema, text: z.string().min(1) }))
      .min(4)
      .max(5),
    selectionCount: z.number().int().min(1).max(5),
    topic: z.string().min(1),
    verification: z.enum(["ungraded", "verified"]),
    correctOptionIds: z.array(optionIdSchema),
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
      q.options.map((o) => o.id).join("") !== "ABCDE".slice(0, q.options.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Options must be sequential A-D or A-E",
      });
    if (
      q.selectionCount > q.options.length ||
      q.correctOptionIds.some((id) => !q.options.some((o) => o.id === id))
    )
      ctx.addIssue({
        code: "custom",
        message: "Selection count and answer keys must match available options",
      });
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
export type Question = z.infer<typeof questionSchema>;
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
