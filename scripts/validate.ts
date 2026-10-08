import bank from "../data/questions.json";
import { bankSchema } from "../apps/web/lib/schema";
const qs = bankSchema.parse(bank);
if (qs.length !== 81) throw new Error("Expected 81 source questions");
console.log(
  `Validated ${qs.length} questions (${qs.filter((q) => q.verification === "verified").length} verified)`,
);
