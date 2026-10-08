export const dynamic = "force-dynamic";
import {
  readJson,
  identity,
  questions,
  saveQuestions,
  failure,
} from "../../../lib/server";
import { bankSchema } from "../../../lib/schema";
export async function GET(r: Request) {
  try {
    if (!(await identity(r)).admin) throw new Error("FORBIDDEN");
    return Response.json(await questions());
  } catch (e) {
    return failure(e);
  }
}
export async function PUT(r: Request) {
  try {
    if (!(await identity(r)).admin) throw new Error("FORBIDDEN");
    const parsed = bankSchema.safeParse(await readJson(r));
    if (!parsed.success)
      return Response.json({ error: parsed.error.message }, { status: 400 });
    await saveQuestions(parsed.data);
    return Response.json({ saved: parsed.data.length });
  } catch (e) {
    return failure(e);
  }
}
