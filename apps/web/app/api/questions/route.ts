export const dynamic = "force-dynamic";
import { questions, failure } from "../../../lib/server";
import { publicQuestion } from "../../../lib/schema";
export async function GET() {
  try {
    return Response.json((await questions()).map(publicQuestion));
  } catch (e) {
    return failure(e);
  }
}
