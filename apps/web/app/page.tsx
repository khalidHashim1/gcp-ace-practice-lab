"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps } from "@firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  type User,
} from "@firebase/auth";
import type { PublicQuestion } from "../lib/schema";
import { toggleSelection, remainingSeconds } from "../lib/exam";
import { summarizeTopics } from "../lib/analytics";
type Review = {
  id: string;
  selected: string[];
  status: string;
  correctOptionIds: string[];
  explanation: string | null;
  optionExplanations: Record<string, string>;
  references: string[];
};
type Attempt = {
  id: string;
  submittedAt: number;
  percentage: number | null;
  correct: number;
  graded: number;
  ungraded: number;
  expired: boolean;
  flags: string[];
  topics: Record<string, { correct: number; graded: number; ungraded: number }>;
  review: Review[];
  questions: PublicQuestion[];
};
type Session = {
  id: string;
  questions: PublicQuestion[];
  deadline: number | null;
  mode: "review" | "timed";
};
type ResumableSession = Session & {
  answers: Record<string, string[]>;
  flags: string[];
  index: number;
  paused: boolean;
  pausedRemainingSeconds: number | null;
};
type ExamCatalogItem = {
  id: string;
  title: string;
  description: string;
  questionBankId: string;
  questionCount: number;
  durationMinutes: number;
  available: boolean;
};
export default function Home() {
  const [bank, setBank] = useState<PublicQuestion[]>([]),
    [examCatalog, setExamCatalog] = useState<ExamCatalogItem[]>([]),
    [attempts, setAttempts] = useState<Attempt[]>([]),
    [view, setView] = useState("dashboard"),
    [session, setSession] = useState<Session | null>(null),
    [dashboardMode, setDashboardMode] = useState<"review" | "timed">("timed"),
    [checkedReview, setCheckedReview] = useState<Record<string, Review>>({}),
    [savedSession, setSavedSession] = useState<ResumableSession | null>(null),
    [answers, setAnswers] = useState<Record<string, string[]>>({}),
    [flags, setFlags] = useState<string[]>([]),
    [index, setIndex] = useState(0),
    [result, setResult] = useState<Attempt | null>(null),
    [incorrect, setIncorrect] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [cloud, setCloud] = useState(false),
    [user, setUser] = useState<User | null>(null),
    [isAdmin, setIsAdmin] = useState(false),
    [adminBankId, setAdminBankId] = useState("ace-practice-1"),
    [adminText, setAdminText] = useState(""),
    [notice, setNotice] = useState(""),
    [seconds, setSeconds] = useState(0),
    [confirmSubmit, setConfirmSubmit] = useState(false);
  const submitting = useRef(false);
  async function api(path: string, method = "GET", body?: unknown) {
    const token = user ? await user.getIdToken() : null;
    const response = await fetch("/api/" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "Request failed");
    return data;
  }
  useEffect(() => {
    let unsubscribe: undefined | (() => void);
    fetch("/api/config")
      .then((r) => r.json())
      .then((c) => {
        setCloud(c.cloud);
        if (c.cloud) {
          const app = getApps()[0] ?? initializeApp(c.firebase);
          unsubscribe = getAuth(app).onAuthStateChanged(async (u) => {
            setUser(u);
            setIsAdmin(Boolean(u && (await u.getIdTokenResult()).claims.admin));
          });
        } else setIsAdmin(true);
        return Promise.all([fetch("/api/questions"), fetch("/api/exams")]);
      })
      .then(async ([questionResponse, examResponse]) => {
        if (!questionResponse.ok) throw new Error("Could not load questions");
        if (!examResponse.ok) throw new Error("Could not load exam catalog");
        const [loadedBank, loadedExams] = await Promise.all([
          questionResponse.json(),
          examResponse.json(),
        ]);
        setBank(loadedBank);
        setExamCatalog(loadedExams);
      })
      .catch((e) => setError(e.message))
      .finally(() => setReady(true));
    document.documentElement.dataset.theme =
      localStorage.getItem("ace-theme") ?? "light";
    return () => unsubscribe?.();
  }, []);
  useEffect(() => {
    if (!ready || (cloud && !user)) return;
    let active = true;
    (async () => {
      try {
        const token = user ? await user.getIdToken() : null;
        const r = await fetch("/api/attempts", {
          headers: token ? { Authorization: "Bearer " + token } : {},
        });
        if (!r.ok) throw new Error("Could not load history");
        if (active) setAttempts(await r.json());
        const saved = await fetch("/api/sessions", {
          headers: token ? { Authorization: "Bearer " + token } : {},
        });
        if (!saved.ok) throw new Error("Could not load saved exam");
        if (active) setSavedSession(await saved.json());
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : "History error");
      }
    })();
    return () => {
      active = false;
    };
  }, [ready, cloud, user]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!session || submitting.current) return;
    submitting.current = true;
    await run(async () => {
      const a = await api("attempts", "POST", {
        sessionId: session.id,
        answers,
        flags,
      });
      setResult(a);
      setIncorrect(false);
      setAttempts((old) => [a, ...old.filter((v) => v.id !== a.id)]);
      setView("review");
      setSession(null);
      setSavedSession(null);
      setConfirmSubmit(false);
    });
    submitting.current = false;
  }
  useEffect(() => {
    if (!session?.deadline) return;
    const tick = () => {
      setSeconds(remainingSeconds(session.deadline!, Date.now()));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session]);
  useEffect(() => {
    if (
      session?.deadline &&
      seconds === 0 &&
      Date.now() >= session.deadline &&
      !busy
    )
      void submit();
  });
  async function start(
    mode: "review" | "timed",
    topic?: string,
    examId?: string,
  ) {
    await run(async () => {
      const s = await api("exams", "POST", { mode, topic, examId });
      setSession(s);
      setSavedSession(null);
      setSeconds(s.deadline ? remainingSeconds(s.deadline, Date.now()) : 0);
      setAnswers({});
      setFlags([]);
      setIndex(0);
      setCheckedReview({});
      setView("exam");
    });
  }
  async function pause() {
    if (!session) return;
    await run(async () => {
      const saved = await api("sessions", "PATCH", {
        sessionId: session.id,
        answers,
        flags,
        index,
      });
      setSavedSession(saved);
      setSession(null);
      setConfirmSubmit(false);
      setView("dashboard");
      setNotice("Exam paused. Your answers, flags, position, and remaining time are saved.");
    });
  }
  async function resume() {
    if (!savedSession) return;
    await run(async () => {
      const resumed = await api("sessions", "POST", {
        sessionId: savedSession.id,
      });
      setSession(resumed);
      setAnswers(resumed.answers);
      setFlags(resumed.flags);
      setIndex(resumed.index);
      setCheckedReview({});
      setSeconds(resumed.deadline ? remainingSeconds(resumed.deadline, Date.now()) : 0);
      setSavedSession(null);
      setView("exam");
    });
  }
  async function checkAnswer() {
    if (!session || !q) return;
    await run(async () => {
      const review = await api("sessions", "PUT", {
        sessionId: session.id,
        questionId: q.id,
        answers,
      });
      setCheckedReview((old) => ({ ...old, [q.id]: review }));
    });
  }
  const topics = useMemo(() => [...new Set(bank.map((q) => q.topic))], [bank]);
  const q = session?.questions[index];
  const checked = q ? checkedReview[q.id] : undefined;
  const answeredCount = session
    ? Object.values(answers).filter((selection) => selection.length).length
    : 0;
  const studied = new Set(
    attempts.flatMap((a) =>
      a.review.filter((r) => r.selected.length).map((r) => r.id),
    ),
  ).size;
  const topicAnalytics = useMemo(
    () => summarizeTopics(topics, bank, attempts),
    [attempts, bank, topics],
  );
  const scoredTopics = topicAnalytics.filter(
    (item) => item.percentage !== null,
  );
  const strongest = [...scoredTopics].sort(
    (a, b) => (b.percentage ?? 0) - (a.percentage ?? 0),
  )[0];
  const weakest = [...scoredTopics].sort(
    (a, b) => (a.percentage ?? 0) - (b.percentage ?? 0),
  )[0];
  const adminBanks = useMemo(
    () => [
      ...new Map(
        examCatalog.map((exam) => [exam.questionBankId, exam]),
      ).values(),
    ],
    [examCatalog],
  );
  return (
    <main className="shell">
      <nav className="nav" aria-label="Primary navigation">
        <div className="brand">
          <span>ACE</span> / Practice Lab
        </div>
        {["dashboard", "history"].map((v) => (
          <button
            className={view === v ? "nav-link active" : "nav-link"}
            key={v}
            disabled={!!session}
            onClick={() => setView(v)}
          >
            {v === "dashboard" ? "Dashboard" : "Attempt history"}
          </button>
        ))}
        {isAdmin && (
          <button
            disabled={!!session}
            onClick={() =>
              run(async () => {
                const bankId = "ace-practice-1";
                setAdminBankId(bankId);
                setAdminText(
                  JSON.stringify(await api(`admin?bankId=${bankId}`), null, 2),
                );
                setView("admin");
              })
            }
          >
            Question admin
          </button>
        )}
        <button
          aria-label="Toggle light and dark mode"
          onClick={() => {
            const theme =
              document.documentElement.dataset.theme === "dark"
                ? "light"
                : "dark";
            document.documentElement.dataset.theme = theme;
            localStorage.setItem("ace-theme", theme);
          }}
        >
          Light / Dark
        </button>
        {cloud && (
          <button
            disabled={!!session}
            onClick={() =>
              run(async () => {
                if (user) {
                  await signOut(getAuth());
                  setAttempts([]);
                } else
                  await signInWithPopup(getAuth(), new GoogleAuthProvider());
              })
            }
          >
            {user ? "Sign out" : "Google sign-in"}
          </button>
        )}
      </nav>
      {error && (
        <div role="alert" className="error">
          {error}
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      {notice && (
        <div role="status" className="banner">
          {notice}
        </div>
      )}
      {!ready ? (
        <p role="status">Loading your practice lab…</p>
      ) : (
        <>
          {view === "dashboard" && (
            <>
              <header className="hero dashboard-hero">
                <div>
                  <div className="eyebrow">
                    GOOGLE CLOUD • ASSOCIATE CLOUD ENGINEER
                  </div>
                  <h1>Pass your cloud exam with confidence.</h1>
                  <p className="muted">
                    Take realistic 60-question mock exams, drill the skills that
                    matter, and make every study session count.
                  </p>
                </div>
                <div className="hero-orbit" aria-hidden="true">
                  <span>ACE</span>
                  <small>ready</small>
                </div>
              </header>
              <div className="grid metrics-grid">
                <section className="card metric-card">
                  <span className="metric-icon">◈</span>
                  <div>
                    <div className="muted">Question bank</div>
                    <div className="stat">{bank.length}</div>
                    <span>Scenario-based cloud decisions</span>
                  </div>
                </section>
                <section className="card metric-card">
                  <span className="metric-icon">◔</span>
                  <div>
                    <div className="muted">Study coverage</div>
                    <div className="stat">
                      {bank.length
                        ? Math.round((studied / bank.length) * 100)
                        : 0}
                      %
                    </div>
                    <progress value={studied} max={bank.length || 1} />
                    <small className="muted">
                      {studied} of {bank.length} explored
                    </small>
                  </div>
                </section>
                <section className="card metric-card">
                  <span className="metric-icon">✓</span>
                  <div>
                    <div className="muted">Completed attempts</div>
                    <div className="stat">{attempts.length}</div>
                    <span>
                      {cloud
                        ? "Synced to your account"
                        : "Available in local development"}
                    </span>
                  </div>
                </section>
              </div>
              <div className="banner">
                <strong>Transparent grading.</strong>{" "}
                {bank.filter((q) => q.verification === "verified").length}{" "}
                verified answer keys. Questions without a verified key stay
                ungraded; completion is tracked separately from score.
              </div>
              <section className="mode-picker" aria-label="Study mode">
                <button
                  className={dashboardMode === "review" ? "mode-choice active" : "mode-choice"}
                  onClick={() => setDashboardMode("review")}
                >
                  <strong>Review mode</strong>
                  <span>Untimed · check each answer and study its explanation</span>
                </button>
                <button
                  className={dashboardMode === "timed" ? "mode-choice active" : "mode-choice"}
                  onClick={() => setDashboardMode("timed")}
                >
                  <strong>Timed mode</strong>
                  <span>60 questions · 120 minutes · exam simulation</span>
                </button>
              </section>
              {dashboardMode === "timed" && <section
                className="exam-library"
                aria-labelledby="exam-library-title"
              >
                <div className="section-heading">
                  <div>
                    <div className="eyebrow">EXAM SIMULATION</div>
                    <h2 id="exam-library-title">Mock exam library</h2>
                  </div>
                  <span className="muted">
                    Every exam · 60 questions · 120 minutes
                  </span>
                </div>
                <div className="exam-grid">
                  {examCatalog.map((exam, position) => (
                    <article
                      className={
                        position === 0 ? "exam-tile featured-exam" : "exam-tile"
                      }
                      key={exam.id}
                    >
                      <div className="exam-number">
                        {String(position + 1).padStart(2, "0")}
                      </div>
                      <div className="eyebrow">
                        {position === 0
                          ? "RECOMMENDED FIRST"
                          : "FULL SIMULATION"}
                      </div>
                      <h3>{exam.title}</h3>
                      <p>{exam.description}</p>
                      <div className="exam-details">
                        <span>{exam.questionCount} questions</span>
                        <span>{exam.durationMinutes} minutes</span>
                      </div>
                      <button
                        className={position === 0 ? "primary" : "exam-start"}
                        disabled={busy || !exam.available || (cloud && !user)}
                        onClick={() => start("timed", undefined, exam.id)}
                      >
                        {exam.available
                          ? "Start exam"
                          : "Exam bank unavailable"}{" "}
                        <span aria-hidden="true">→</span>
                      </button>
                    </article>
                  ))}
                </div>
              </section>}
              {savedSession && (
                <section className="card saved-exam" aria-labelledby="saved-exam-title">
                  <div>
                    <div className="eyebrow">SAVED EXAM</div>
                    <h2 id="saved-exam-title">Ready when you are.</h2>
                    <p className="muted">
                      {Object.values(savedSession.answers).filter((answer) => answer.length).length} of {savedSession.questions.length} answered
                      {savedSession.pausedRemainingSeconds !== null
                        ? ` · ${Math.ceil(savedSession.pausedRemainingSeconds / 60)} minutes remaining`
                        : savedSession.deadline
                          ? " · timer resumes when you continue"
                          : " · untimed practice"}
                    </p>
                  </div>
                  <button className="primary" disabled={busy} onClick={() => void resume()}>
                    Resume exam →
                  </button>
                </section>
              )}
              {dashboardMode === "review" && <><div className="section-heading">
                <div>
                  <div className="eyebrow">REVIEW MODE</div>
                  <h2>Choose a topic to study</h2>
                </div>
                <span className="muted">Untimed · check answers as you go</span>
              </div>
              <div className="topics">
                {topicAnalytics.map(({ topic, questions, percentage }) => (
                  <button
                    className="topic"
                    key={topic}
                    disabled={busy || (cloud && !user)}
                    onClick={() => start("review", topic)}
                  >
                    <span className="topic-icon" aria-hidden="true">
                      {topic === "Compute"
                        ? "◫"
                        : topic === "Networking"
                          ? "⌁"
                          : topic === "Storage"
                            ? "▣"
                            : "◇"}
                    </span>
                    <span className="topic-copy">
                      <strong>{topic}</strong>
                      <br />
                      <small className="muted">
                        {questions} questions
                        {percentage !== null
                          ? ` · ${percentage}% verified score`
                          : " · untimed"}
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
              </>}
              {attempts.length > 0 && (
                <section className="insights card">
                  <div>
                    <div className="eyebrow">YOUR INSIGHTS</div>
                    <h2>Keep your practice intentional.</h2>
                  </div>
                  <div className="insight-grid">
                    <p>
                      <strong>Strongest</strong>
                      <br />
                      {strongest
                        ? `${strongest.topic} · ${strongest.percentage}%`
                        : "Not enough graded data yet"}
                    </p>
                    <p>
                      <strong>Practice next</strong>
                      <br />
                      {weakest
                        ? `${weakest.topic} · ${weakest.percentage}%`
                        : "Complete a session to unlock suggestions"}
                    </p>
                    <button onClick={() => setView("history")}>
                      View attempt history →
                    </button>
                  </div>
                </section>
              )}
              {cloud && !user && (
                <p className="muted">
                  Sign in with Google to start and save your progress.
                </p>
              )}
            </>
          )}
          {view === "exam" && session && q && (
            <>
              <div className="exam-header">
                <div>
                  <div className="eyebrow">{q.topic}</div>
                  <h2>
                    Question {index + 1} of {session.questions.length}
                  </h2>
                </div>
                <strong
                  className={session.deadline ? "timer" : "timer untimed"}
                >
                  {session.deadline
                    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`
                    : "Untimed practice"}
                </strong>
              </div>
              <div className="progress-label">
                <span>{answeredCount} answered</span>
                <span>
                  {session.questions.length - answeredCount} remaining
                </span>
              </div>
              <progress
                value={answeredCount}
                max={session.questions.length}
                aria-label={`${answeredCount} of ${session.questions.length} questions answered`}
              />
              <section className="card exam-card">
                <div className="row spread">
                  <span className="muted">
                    Select {q.selectionCount} answer
                    {q.selectionCount > 1 ? "s" : ""} · {q.verification}
                  </span>
                  <button
                    className={flags.includes(q.id) ? "flag" : ""}
                    onClick={() =>
                      setFlags(
                        flags.includes(q.id)
                          ? flags.filter((id) => id !== q.id)
                          : [...flags, q.id],
                      )
                    }
                  >
                    {flags.includes(q.id)
                      ? "Flagged for review"
                      : "Flag for review"}
                  </button>
                </div>
                <p className="question">{q.prompt}</p>
                {q.options.map((o) => (
                  <button
                    aria-pressed={(answers[q.id] ?? []).includes(o.id)}
                    className={
                      "option " +
                      ((answers[q.id] ?? []).includes(o.id) ? "selected" : "")
                    }
                    key={o.id}
                    onClick={() =>
                      {
                        setAnswers({
                          ...answers,
                          [q.id]: toggleSelection(
                            answers[q.id] ?? [],
                            o.id,
                            q.selectionCount,
                          ),
                        });
                        setCheckedReview((old) => {
                          const next = { ...old };
                          delete next[q.id];
                          return next;
                        });
                      }
                    }
                  >
                    <span className="option-letter">{o.id}</span>
                    <span>{o.text}</span>
                  </button>
                ))}
                {session.mode === "review" && (
                  <div className="review-check">
                    <button
                      className="primary"
                      disabled={busy || !(answers[q.id]?.length)}
                      onClick={() => void checkAnswer()}
                    >
                      {busy ? "Checking…" : "Check answer"}
                    </button>
                    {!answers[q.id]?.length && (
                      <span className="muted">Select an answer first.</span>
                    )}
                  </div>
                )}
                {checked && (
                  <section className="answer-feedback" aria-live="polite">
                    <div className="eyebrow">ANSWER REVIEW</div>
                    <h3>{checked.status === "correct" ? "Correct" : checked.status === "incorrect" ? "Review this answer" : "Not yet verified"}</h3>
                    <p className="explanation">
                      {checked.explanation ?? "This question has no verified explanation yet."}
                    </p>
                    {q.options.map((option) => (
                      <p
                        className={checked.correctOptionIds.includes(option.id) ? "option-rationale correct-answer" : "option-rationale"}
                        key={option.id}
                      >
                        <strong>{option.id}</strong>
                        <span>
                          {checked.optionExplanations[option.id] ??
                            (checked.correctOptionIds.includes(option.id)
                              ? "Verified as a correct answer."
                              : "No option-specific rationale has been verified for this distractor yet.")}
                        </span>
                      </p>
                    ))}
                    {checked.references.map((url) => (
                      <a href={url} target="_blank" rel="noreferrer" key={url}>
                        Official Google Cloud reference ↗
                      </a>
                    ))}
                  </section>
                )}
                <div className="row spread">
                  <button
                    disabled={index === 0}
                    onClick={() => setIndex(index - 1)}
                  >
                    Previous
                  </button>
                  <button
                    disabled={index === session.questions.length - 1}
                    onClick={() => setIndex(index + 1)}
                  >
                    Next
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void pause()}
                  >
                    {busy ? "Saving…" : "Pause & save"}
                  </button>
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => setConfirmSubmit(true)}
                  >
                    {busy ? "Submitting…" : "Finish & review"}
                  </button>
                </div>
              </section>
              <div className="navigator-label">
                <strong>Question navigator</strong>
                <span className="muted">Answered · Flagged</span>
              </div>
              <div className="numbers" aria-label="Question navigator">
                {session.questions.map((item, i) => (
                  <button
                    aria-label={`Go to question ${i + 1}${flags.includes(item.id) ? ", flagged" : ""}`}
                    className={
                      (flags.includes(item.id) ? "flag " : "") +
                      (i === index ? "selected" : "") +
                      (answers[item.id]?.length ? " answered" : "")
                    }
                    key={item.id}
                    onClick={() => setIndex(i)}
                  >
                    {i + 1}
                    {answers[item.id]?.length ? " ✓" : ""}
                    {flags.includes(item.id) ? " ⚑" : ""}
                  </button>
                ))}
              </div>
              <p className="muted exam-note">
                Pause & save stops the timer and lets you continue later. Timed
                exams submit automatically when active time reaches the deadline.
              </p>
            </>
          )}
          {view === "history" && (
            <>
              <div className="hero">
                <h1>Your attempts</h1>
                <p className="muted">
                  Open an attempt to review selections and verified
                  explanations.
                </p>
              </div>
              {!attempts.length ? (
                <div className="card">
                  No attempts yet. Start a practice session from the dashboard.
                </div>
              ) : (
                attempts.map((a) => (
                  <button
                    className="option"
                    key={a.id}
                    onClick={() => {
                      setResult(a);
                      setIncorrect(false);
                      setView("review");
                    }}
                  >
                    {new Date(a.submittedAt).toLocaleString()} ·{" "}
                    {a.percentage === null ? "Ungraded" : a.percentage + "%"} ·{" "}
                    {a.review.length} questions →
                  </button>
                ))
              )}
            </>
          )}
          {view === "review" && result && (
            <>
              <header className="hero">
                <div className="eyebrow">ATTEMPT REVIEW</div>
                <h1>
                  {result.percentage === null
                    ? "Practice completed"
                    : `${result.percentage}% verified score`}
                </h1>
                <p className="muted">
                  {result.correct}/{result.graded} verified answers correct ·{" "}
                  {result.ungraded} ungraded questions
                  {result.expired
                    ? " · Late submission: answers excluded from scoring"
                    : ""}
                </p>
              </header>
              <div className="grid results-grid">
                <section className="card score-card">
                  <div className="score-ring">
                    <strong>{result.percentage ?? "—"}</strong>
                    <span>{result.percentage === null ? "ungraded" : "%"}</span>
                  </div>
                  <p className="muted">Verified performance</p>
                </section>
                <section className="card">
                  <div className="muted">Correct</div>
                  <div className="stat">{result.correct}</div>
                  <p className="muted">of {result.graded} verified questions</p>
                </section>
                <section className="card">
                  <div className="muted">Completion</div>
                  <div className="stat">
                    {
                      result.review.filter((item) => item.selected.length)
                        .length
                    }
                    /{result.review.length}
                  </div>
                  <p className="muted">questions answered</p>
                </section>
                {Object.entries(result.topics).map(([t, s]) => (
                  <div className="card" key={t}>
                    <strong>{t}</strong>
                    <p>
                      {s.graded
                        ? `${s.correct}/${s.graded} correct`
                        : "No verified keys"}
                    </p>
                    <small className="muted">{s.ungraded} ungraded</small>
                  </div>
                ))}
              </div>
              <div className="row" style={{ margin: "24px 0" }}>
                <button onClick={() => setIncorrect(!incorrect)}>
                  {incorrect
                    ? "Show all questions"
                    : "Review incorrect answers"}
                </button>
                <button onClick={() => setView("dashboard")}>
                  Back to dashboard
                </button>
              </div>
              {incorrect &&
                !result.review.some((r) => r.status === "incorrect") && (
                  <div className="banner">
                    No verified incorrect answers in this attempt. Ungraded
                    answers cannot be classified as correct or incorrect.
                  </div>
                )}
              {result.review
                .filter((r) => !incorrect || r.status === "incorrect")
                .map((r) => {
                  const item = result.questions.find((q) => q.id === r.id);
                  return (
                    <section
                      className="card"
                      key={r.id}
                      style={{ marginBottom: 16 }}
                    >
                      <div className="eyebrow">
                        {r.status}
                        {result.flags.includes(r.id) ? " · FLAGGED" : ""}
                      </div>
                      <p className="question">{item?.prompt}</p>
                      <div className="review-options">
                        {item?.options.map((o) => (
                          <p
                            className={
                              (r.selected.includes(o.id)
                                ? "selected-answer "
                                : "") +
                              (r.correctOptionIds.includes(o.id)
                                ? "correct-answer"
                                : "")
                            }
                            key={o.id}
                          >
                            <strong>{o.id}</strong>
                            <span>{o.text}</span>
                            {r.selected.includes(o.id) && (
                              <small>Your answer</small>
                            )}
                            {r.correctOptionIds.includes(o.id) && (
                              <small>Correct answer</small>
                            )}
                          </p>
                        ))}
                      </div>
                      <p className="explanation">
                        {r.explanation ??
                          "No verified answer or explanation has been added for this question."}
                      </p>
                      {r.references.map((url) => (
                        <p key={url}>
                          <a href={url} target="_blank" rel="noreferrer">
                            Official Google Cloud reference ↗
                          </a>
                        </p>
                      ))}
                    </section>
                  );
                })}
            </>
          )}
          {view === "admin" && (
            <>
              <header className="hero">
                <h1>Question management</h1>
                <p className="muted">
                  Edit or import validated JSON. Verified keys require an
                  explanation and official reference.
                </p>
              </header>
              <div className="banner">
                {cloud
                  ? "Admin claim verified on the server."
                  : "Local development: admin enabled. Production API rejects local mode."}
              </div>
              <label htmlFor="question-bank-select">Question bank</label>
              <select
                id="question-bank-select"
                value={adminBankId}
                onChange={(event) =>
                  run(async () => {
                    const bankId = event.target.value;
                    setAdminBankId(bankId);
                    setAdminText(
                      JSON.stringify(
                        await api(`admin?bankId=${encodeURIComponent(bankId)}`),
                        null,
                        2,
                      ),
                    );
                  })
                }
              >
                {adminBanks.map((exam) => (
                  <option key={exam.questionBankId} value={exam.questionBankId}>
                    {exam.questionBankId === "ace-practice-1"
                      ? "Exam 1 question bank"
                      : `${exam.title} question pool`}
                  </option>
                ))}
              </select>
              <label htmlFor="bank">Question bank JSON</label>
              <textarea
                id="bank"
                value={adminText}
                onChange={(e) => setAdminText(e.target.value)}
              />
              <div className="row">
                <input
                  aria-label="Import question JSON"
                  type="file"
                  accept="application/json,.json"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (f) setAdminText(await f.text());
                  }}
                />
                <button
                  onClick={() => {
                    const blob = new Blob([adminText], {
                      type: "application/json",
                    });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "question-bank.json";
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Download JSON
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      const saved = await api("admin", "PUT", {
                        bankId: adminBankId,
                        questions: JSON.parse(adminText),
                      });
                      if (adminBankId === "ace-practice-1")
                        setBank(await api("questions"));
                      setNotice(
                        `Saved ${saved.saved} validated questions to this bank.`,
                      );
                    })
                  }
                >
                  Validate & save
                </button>
              </div>
            </>
          )}
        </>
      )}
      <footer>
        ACE Practice Lab · Independent study project · Not affiliated with
        Google · {cloud ? "Cloud mode" : "Local development mode"}
      </footer>
      {confirmSubmit && session && (
        <div className="dialog-backdrop" role="presentation">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-title"
          >
            <div className="eyebrow">READY TO SUBMIT?</div>
            <h2 id="submit-title">Finish this attempt?</h2>
            <p className="muted">
              You have answered {answeredCount} of {session.questions.length}{" "}
              questions.{" "}
              {session.questions.length - answeredCount
                ? `${session.questions.length - answeredCount} unanswered question${session.questions.length - answeredCount === 1 ? "" : "s"} will be submitted blank.`
                : "All questions have an answer."}
            </p>
            <div className="row">
              <button onClick={() => setConfirmSubmit(false)}>
                Keep reviewing
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => void submit()}
              >
                {busy ? "Submitting…" : "Submit & view results"}
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
