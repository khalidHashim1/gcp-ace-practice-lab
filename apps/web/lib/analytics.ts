export type TopicAttempt = {
  topics: Record<
    string,
    { correct: number; graded: number; ungraded: number }
  >;
};

export function summarizeTopics(
  topics: string[],
  questions: { topic: string }[],
  attempts: TopicAttempt[],
) {
  return topics.map((topic) => {
    const totals = attempts.reduce(
      (current, attempt) => {
        const score = attempt.topics[topic];
        return score
          ? {
              correct: current.correct + score.correct,
              graded: current.graded + score.graded,
              ungraded: current.ungraded + score.ungraded,
            }
          : current;
      },
      { correct: 0, graded: 0, ungraded: 0 },
    );
    return {
      topic,
      questions: questions.filter((question) => question.topic === topic).length,
      ...totals,
      percentage: totals.graded
        ? Math.round((totals.correct / totals.graded) * 100)
        : null,
    };
  });
}
