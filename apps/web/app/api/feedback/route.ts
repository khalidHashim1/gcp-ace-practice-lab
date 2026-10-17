import { z } from "zod";
import { failure, identity, saveRecord } from "../../../lib/server";
const schema = z.object({ questionId: z.string().min(1), category: z.enum(["wrong_answer", "unclear_explanation", "unclear_question", "technical_issue"]), comment: z.string().trim().max(1000).default("") });
export async function POST(request: Request) {
  try {
    const user = await identity(request);
    const body = schema.safeParse(await request.json());
    if (!body.success) throw new Error("BAD_REQUEST: invalid feedback");
    await saveRecord(user.uid, "feedback", `${Date.now()}-${crypto.randomUUID()}`, { ...body.data, createdAt: Date.now(), status: "new" });
    return Response.json({ saved: true });
  } catch (error) { return failure(error); }
}
