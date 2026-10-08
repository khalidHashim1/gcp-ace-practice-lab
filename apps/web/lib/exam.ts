import type { Question } from "./schema";
export function score(
  questions: Question[],
  answers: Record<string, string[]>,
) {
  let correct = 0,
    graded = 0;
  const topics: Record<
    string,
    { correct: number; graded: number; ungraded: number }
  > = {};
  const review = questions.map((q) => {
    const selected = answers[q.id] ?? [];
    const verified = q.verification === "verified";
    const ok =
      verified &&
      selected.length === q.correctOptionIds.length &&
      new Set(selected).size === selected.length &&
      q.correctOptionIds.every((id) => selected.includes(id));
    topics[q.topic] ??= { correct: 0, graded: 0, ungraded: 0 };
    if (verified) {
      graded++;
      topics[q.topic].graded++;
      if (ok) {
        correct++;
        topics[q.topic].correct++;
      }
    } else topics[q.topic].ungraded++;
    return {
      id: q.id,
      selected,
      status: verified ? (ok ? "correct" : "incorrect") : "ungraded",
      correctOptionIds: verified ? q.correctOptionIds : [],
      explanation: verified ? q.explanation : null,
      references: verified ? q.references : [],
    };
  });
  return {
    correct,
    graded,
    ungraded: questions.length - graded,
    percentage: graded ? Math.round((correct / graded) * 100) : null,
    topics,
    review,
  };
}
export function toggleSelection(
  current: string[],
  option: string,
  count: number,
) {
  if (current.includes(option)) return current.filter((v) => v !== option);
  return count === 1
    ? [option]
    : current.length < count
      ? [...current, option]
      : current;
}
export function remainingSeconds(deadline: number, now: number) {
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}
