export const dynamic = "force-dynamic";
import {
  readJson,
  identity,
  exams,
  questions,
  saveQuestions,
  failure,
} from "../../../lib/server";
import { bankSchema } from "../../../lib/schema";
async function bankIdFor(request: Request) {
  const bankId =
    new URL(request.url).searchParams.get("bankId") ?? "ace-practice-1";
  const valid = new Set((await exams()).map((exam) => exam.questionBankId));
  if (!valid.has(bankId)) throw new Error("BAD_REQUEST: unknown question bank");
  return bankId;
}
export async function GET(r: Request) {
  try {
    if (!(await identity(r)).admin) throw new Error("FORBIDDEN");
    return Response.json(await questions(await bankIdFor(r)));
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(r: Request) {
  try {
    if (!(await identity(r)).admin) throw new Error("FORBIDDEN");
    // Question-bank imports are larger than ordinary session payloads, but
    // still capped beneath the Cloud Run request limit.
    const body = await readJson(r, 1024 * 1024);
    const envelope =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { bankId?: unknown; questions?: unknown })
        : null;
    // Accept the original array-only payload for existing local tooling; the
    // bank-aware admin UI always sends the explicit envelope.
    const requestedBankId = envelope?.bankId;
    if (requestedBankId !== undefined && typeof requestedBankId !== "string")
      throw new Error("BAD_REQUEST: invalid bankId");
    const bankId = requestedBankId ?? "ace-practice-1";
    const valid = new Set((await exams()).map((exam) => exam.questionBankId));
    if (!valid.has(bankId))
      throw new Error("BAD_REQUEST: unknown question bank");
    const parsed = bankSchema.safeParse(envelope ? envelope.questions : body);
    if (!parsed.success)
      return Response.json({ error: parsed.error.message }, { status: 400 });
    await saveQuestions(parsed.data, bankId);
    return Response.json({ saved: parsed.data.length, bankId });
  } catch (e) {
    return failure(e);
  }
}
