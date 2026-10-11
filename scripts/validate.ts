import bank from "../data/questions.json";
import { bankSchema } from "../apps/web/lib/schema";
import { readFileSync } from "node:fs";
const qs = bankSchema.parse(
  process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : bank,
);
if (qs.length !== 81) throw new Error("Expected 81 source questions");
if (
  qs.map((q) => q.number).join(",") !==
  Array.from({ length: 81 }, (_, i) => i + 1).join(",")
)
  throw new Error("Expected sequential question numbers");
if (!process.argv[2] && qs.some((q) => q.verification !== "ungraded"))
  throw new Error("Public seed must not contain private answer keys");
console.log(
  `Validated ${qs.length} questions (${qs.filter((q) => q.verification === "verified").length} verified)`,
);
