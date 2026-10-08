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
