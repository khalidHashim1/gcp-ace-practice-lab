import { describe, it, expect } from "vitest";
import { score, toggleSelection, remainingSeconds } from "../apps/web/lib/exam";
import { bankSchema, publicQuestion } from "../apps/web/lib/schema";
import source from "../data/questions.json";
const bank = bankSchema.parse(source);
const verified = {
  ...bank[0],
  verification: "verified" as const,
  selectionCount: 2,
  correctOptionIds: ["A", "C"],
  explanation: "Verified test fixture",
  references: ["https://cloud.google.com/docs"],
};
describe("question import", () => {
  it("has 81 sequential complete source questions", () => {
    expect(bank).toHaveLength(81);
    expect(bank.map((q) => q.number)).toEqual(
      Array.from({ length: 81 }, (_, i) => i + 1),
    );
    expect(bank.every((q) => q.verification === "ungraded")).toBe(true);
  });
  it("rejects unsupported verification and incomplete keys", () => {
    expect(() =>
      bankSchema.parse([{ ...verified, explanation: null }]),
    ).toThrow();
    expect(() => bankSchema.parse([bank[0], bank[0]])).toThrow();
  });
  it("strips keys from quiz payload", () => {
    expect(publicQuestion(verified)).not.toHaveProperty("correctOptionIds");
    expect(publicQuestion(verified)).not.toHaveProperty("explanation");
  });
});
describe("scoring", () => {
  it("does not fabricate a score for ungraded questions", () => {
    expect(score(bank, {}).percentage).toBeNull();
    expect(score(bank, {}).ungraded).toBe(81);
  });
  it("requires an exact unordered multiple selection", () => {
    expect(score([verified], { [verified.id]: ["C", "A"] }).percentage).toBe(
      100,
    );
    for (const answers of [["A"], ["A", "B"], ["A", "A"], []])
      expect(score([verified], { [verified.id]: answers }).correct).toBe(0);
  });
  it("separates topic counts and ungraded denominator", () => {
    const result = score([verified, bank[1]], { [verified.id]: ["A", "C"] });
    expect(result.graded).toBe(1);
    expect(result.ungraded).toBe(1);
    expect(result.percentage).toBe(100);
  });
});
describe("exam controls", () => {
  it("replaces single choice and limits multiple choices", () => {
    expect(toggleSelection(["A"], "B", 1)).toEqual(["B"]);
    expect(toggleSelection(["A", "B"], "C", 2)).toEqual(["A", "B"]);
    expect(toggleSelection(["A", "B"], "A", 2)).toEqual(["B"]);
  });
  it("clamps expired timers", () => {
    expect(remainingSeconds(1000, 2000)).toBe(0);
    expect(remainingSeconds(2001, 1000)).toBe(2);
  });
});

describe("five-option bank", () => {
  const five = bank[51];
  const keyed = {
    ...five,
    verification: "verified" as const,
    correctOptionIds: ["B", "E"],
    explanation: "Synthetic test key, not the protected bank",
    references: ["https://cloud.google.com/docs"],
  };
  it("restores separate E options on both choose-two questions", () => {
    for (const n of [52, 73]) {
      expect(bank[n - 1].options.map((o) => o.id)).toEqual([
        "A",
        "B",
        "C",
        "D",
        "E",
      ]);
      expect(bank[n - 1].selectionCount).toBe(2);
      expect(bank[n - 1].options[3].text).not.toMatch(/\. E /);
    }
  });
  it("accepts E only when that option exists and rejects duplicate option IDs", () => {
    expect(bankSchema.parse([keyed])).toHaveLength(1);
    expect(() =>
      bankSchema.parse([
        {
          ...bank[0],
          verification: "verified",
          correctOptionIds: ["E"],
          explanation: "fixture",
          references: keyed.references,
        },
      ]),
    ).toThrow();
    expect(() =>
      bankSchema.parse([
        { ...keyed, options: [...five.options.slice(0, 4), five.options[0]] },
      ]),
    ).toThrow();
    expect(() =>
      bankSchema.parse([{ ...bank[0], selectionCount: 5 }]),
    ).toThrow();
  });
  it("scores E choose-two answers as an exact unordered set", () => {
    expect(score([keyed, bank[0]], { [keyed.id]: ["E", "B"] }).percentage).toBe(
      100,
    );
    for (const selection of [
      ["E"],
      ["A"],
      ["E", "E"],
      ["A", "B"],
      ["A", "E", "B"],
    ]) {
      expect(score([keyed], { [keyed.id]: selection }).correct).toBe(0);
    }
    const safe = publicQuestion(keyed);
    expect(safe).not.toHaveProperty("references");
    expect(safe).not.toHaveProperty("explanation");
    expect(safe).not.toHaveProperty("correctOptionIds");
    expect(safe.options).toHaveLength(5);
  });
});

describe("partial exam grading", () => {
  const single = {
    ...verified,
    id: "single-fixture",
    selectionCount: 1,
    correctOptionIds: ["B"],
  };
  const another = { ...single, id: "another-fixture" };
  it("grades single and choose-two questions with ungraded questions excluded", () => {
    const result = score([single, verified, bank[1]], {
      [single.id]: ["B"],
      [verified.id]: ["A"],
    });
    expect(result).toMatchObject({
      correct: 1,
      graded: 2,
      ungraded: 1,
      percentage: 50,
    });
    expect(result.review.map((r) => r.status)).toEqual([
      "correct",
      "incorrect",
      "ungraded",
    ]);
  });
  it("counts missing verified answers as incorrect and preserves exact percentages", () => {
    const result = score([single, another, verified, bank[1]], {
      [single.id]: ["B"],
    });
    expect(result.graded).toBe(3);
    expect(result.ungraded).toBe(1);
    expect(result.percentage).toBe((1 / 3) * 100);
    expect(result.review[1].status).toBe("incorrect");
    expect(result.review[2].selected).toEqual([]);
    expect(score([single, verified, bank[1]], {}).percentage).toBe(0);
  });
});
