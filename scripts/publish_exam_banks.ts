/**
 * Publish a verified question pool and immutable 60-question ACE exam forms.
 *
 * The source JSON stays private: this script only writes to Firestore. Do not
 * add the input file to Git. Usage:
 *   GOOGLE_CLOUD_PROJECT=... node --import tsx scripts/publish_exam_banks.ts PATH/TO/test-bank-verified.json
 */
import { readFile } from "node:fs/promises";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { bankSchema, examCatalogSchema } from "../apps/web/lib/schema";

function ids(prefix: string, first: number) {
  return Array.from(
    { length: 60 },
    (_, offset) => `${prefix}-${String(first + offset).padStart(3, "0")}`,
  );
}
async function main() {
  const source = process.argv[2];
  if (!source)
    throw new Error(
      "Usage: publish_exam_banks.ts PATH/TO/test-bank-verified.json",
    );
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId) throw new Error("GOOGLE_CLOUD_PROJECT is required");

  const pool = bankSchema.parse(JSON.parse(await readFile(source, "utf8")));
  if (
    pool.length < 300 ||
    pool.some((question) => question.verification !== "verified")
  )
    throw new Error(
      "The published pool requires at least 300 verified questions",
    );

  const catalog = examCatalogSchema.parse([
  {
    id: "ace-practice-1",
    title: "Practice exam 01",
    description: "A fixed, full-length Associate Cloud Engineer simulation.",
    questionBankId: "ace-practice-1",
    questionCount: 60,
    durationMinutes: 120,
    questionIds: ids("ace", 1),
  },
  ...Array.from({ length: 5 }, (_, index) => ({
    id: `ace-practice-${index + 2}`,
    title: `Practice exam ${String(index + 2).padStart(2, "0")}`,
    description: "A fixed, full-length Associate Cloud Engineer simulation.",
    questionBankId: "ace-verified-test-bank",
    questionCount: 60,
    durationMinutes: 120,
    questionIds: ids("testbank", index * 60 + 1),
  })),
  ]);

  const app =
    getApps()[0] ??
    initializeApp({ credential: applicationDefault(), projectId });
  const firestore = getFirestore(app);
  await firestore
    .doc("question-banks/ace-verified-test-bank")
    .set({ questions: pool });
  await firestore.doc("config/exams").set({ exams: catalog });
  console.log(
    JSON.stringify({
      publishedPoolQuestions: pool.length,
      exams: catalog.map((exam) => ({
        id: exam.id,
        questions: exam.questionIds.length,
      })),
      reserveQuestions: pool.length - 300,
    }),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
