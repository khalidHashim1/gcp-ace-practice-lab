import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import source from "../data/questions.json";
import { questions, saveQuestions } from "../apps/web/lib/server";
import { publicQuestion } from "../apps/web/lib/schema";

describe("server-only private seed", () => {
  it("loads a validated private seed and lets admin persistence take precedence", async () => {
    const file = path.join(process.env.LOCAL_DATA_DIR!, "seed.protected.json");
    const fixture = [
      {
        ...source[0],
        verification: "verified",
        correctOptionIds: ["D"],
        explanation: "Synthetic fixture",
        references: ["https://cloud.google.com/docs"],
      },
    ];
    await fs.writeFile(file, JSON.stringify(fixture));
    process.env.QUESTION_BANK_PATH = file;
    const loaded = await questions();
    expect(loaded[0].verification).toBe("verified");
    expect(publicQuestion(loaded[0])).not.toHaveProperty("correctOptionIds");
    await saveQuestions([source[0]]);
    expect((await questions())[0].verification).toBe("ungraded");
    await fs.unlink(path.join(process.env.LOCAL_DATA_DIR!, "questions.json"));
    await fs.writeFile(file, "[]");
    await expect(questions()).rejects.toThrow();
    process.env.QUESTION_BANK_PATH = file + ".missing";
    await expect(questions()).rejects.toThrow();
    delete process.env.QUESTION_BANK_PATH;
  });
});
