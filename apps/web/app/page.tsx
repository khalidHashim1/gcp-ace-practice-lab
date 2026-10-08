"use client";
import { useEffect, useState, useRef } from "react";
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
type Review = {
  id: string;
  selected: string[];
  status: string;
  correctOptionIds: string[];
  explanation: string | null;
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
};
export default function Home() {
  const [bank, setBank] = useState<PublicQuestion[]>([]),
    [attempts, setAttempts] = useState<Attempt[]>([]),
    [view, setView] = useState("dashboard"),
    [session, setSession] = useState<Session | null>(null),
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
    [adminText, setAdminText] = useState(""),
    [notice, setNotice] = useState(""),
    [seconds, setSeconds] = useState(0);
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
        return fetch("/api/questions");
      })
      .then((r) => {
        if (!r.ok) throw new Error("Could not load questions");
        return r.json();
      })
      .then(setBank)
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
  async function start(mode: "practice" | "mock", topic?: string) {
    await run(async () => {
      const s = await api("exams", "POST", { mode, topic });
      setSession(s);
      setSeconds(s.deadline ? remainingSeconds(s.deadline, Date.now()) : 0);
      setAnswers({});
      setFlags([]);
      setIndex(0);
      setView("exam");
    });
  }
  const topics = [...new Set(bank.map((q) => q.topic))];
  const q = session?.questions[index];
  const studied = new Set(
    attempts.flatMap((a) =>
      a.review.filter((r) => r.selected.length).map((r) => r.id),
    ),
  ).size;
  return (
    <main className="shell">
      <nav className="nav">
        <div className="brand">
          <span>ACE</span> / Practice Lab
        </div>
        {["dashboard", "history"].map((v) => (
          <button key={v} disabled={!!session} onClick={() => setView(v)}>
            {v === "dashboard" ? "Dashboard" : "Attempt history"}
          </button>
        ))}
        {isAdmin && (
          <button
            disabled={!!session}
            onClick={() =>
              run(async () => {
                setAdminText(JSON.stringify(await api("admin"), null, 2));
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
              <header className="hero">
                <div className="eyebrow">
                  GOOGLE CLOUD • ASSOCIATE CLOUD ENGINEER
                </div>
                <h1>
                  Build confidence.
                  <br />
                  Practice with purpose.
                </h1>
                <p className="muted">
                  Scenario-based learning, focused practice, and a clear view of
                  your progress.
                </p>
              </header>
              <div className="grid">
                <section className="card">
                  <div className="muted">Question bank</div>
                  <div className="stat">{bank.length}</div>
                  <span>Real-world cloud scenarios</span>
                </section>
                <section className="card">
                  <div className="muted">Study coverage</div>
                  <div className="stat">
                    {bank.length
                      ? Math.round((studied / bank.length) * 100)
                      : 0}
                    %
                  </div>
                  <progress value={studied} max={bank.length || 1} />
                </section>
                <section className="card">
                  <div className="muted">Completed attempts</div>
                  <div className="stat">{attempts.length}</div>
                  <span>
                    {cloud
                      ? "Synced to your account"
                      : "Saved locally on this server"}
                  </span>
                </section>
              </div>
              <div className="banner">
                <strong>Transparent grading.</strong>{" "}
                {bank.filter((q) => q.verification === "verified").length}{" "}
                graded questions ·{" "}
                {bank.filter((q) => q.verification === "ungraded").length}{" "}
                ungraded questions. Scores use only verified questions;
                choose-two questions require both correct selections.
              </div>
              <div className="card row spread">
                <div>
                  <h2>Full mock exam</h2>
                  <p className="muted">
                    All {bank.length} questions · 120 minutes · randomized order
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={busy || (cloud && !user)}
                  onClick={() => start("mock")}
                >
                  Start timed exam
                </button>
              </div>
              <h2>Practice by topic</h2>
              <div className="topics">
                {topics.map((t) => (
                  <button
                    className="topic"
                    key={t}
                    disabled={busy || (cloud && !user)}
                    onClick={() => start("practice", t)}
                  >
                    <span>
                      {t}
                      <br />
                      <small className="muted">
                        {bank.filter((q) => q.topic === t).length} questions ·
                        untimed
                      </small>
                    </span>
                    <span>→</span>
                  </button>
                ))}
              </div>
              {cloud && !user && (
                <p className="muted">
                  Sign in with Google to start and save your progress.
                </p>
              )}
            </>
          )}
          {view === "exam" && session && q && (
            <>
              <div className="hero row spread">
                <div>
                  <div className="eyebrow">{q.topic}</div>
                  <h2>
                    Question {index + 1} of {session.questions.length}
                  </h2>
                </div>
                <strong>
                  {session.deadline
                    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} remaining`
                    : "Untimed practice"}
                </strong>
              </div>
              <progress
                value={
                  Object.keys(answers).filter((k) => answers[k].length).length
                }
                max={session.questions.length}
              />
              <section className="card">
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
                      setAnswers({
                        ...answers,
                        [q.id]: toggleSelection(
                          answers[q.id] ?? [],
                          o.id,
                          q.selectionCount,
                        ),
                      })
                    }
                  >
                    <strong>{o.id}.</strong> {o.text}
                  </button>
                ))}
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
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        confirm(
                          "Submit this attempt? Unanswered questions will be included.",
                        )
                      )
                        void submit();
                    }}
                  >
                    {busy ? "Submitting…" : "Finish & review"}
                  </button>
                </div>
              </section>
              <div className="numbers">
                {session.questions.map((item, i) => (
                  <button
                    aria-label={`Go to question ${i + 1}${flags.includes(item.id) ? ", flagged" : ""}`}
                    className={
                      (flags.includes(item.id) ? "flag " : "") +
                      (i === index ? "selected" : "")
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
              <p className="muted">
                Keep this tab open. Timed exams submit automatically at the
                deadline.
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
                    {a.percentage === null
                      ? "Ungraded"
                      : a.percentage.toLocaleString("en", {
                          maximumFractionDigits: 2,
                        }) + "%"}{" "}
                    · {a.review.length} questions →
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
                    : `${result.percentage.toLocaleString("en", { maximumFractionDigits: 2 })}% verified score`}
                </h1>
                <p className="muted">
                  {result.correct}/{result.graded} verified answers correct ·{" "}
                  {result.ungraded} ungraded questions
                  {result.expired
                    ? " · Late submission: answers excluded from scoring"
                    : ""}
                </p>
              </header>
              <div className="grid">
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
                      {item?.options.map((o) => (
                        <p key={o.id}>
                          <strong>
                            {o.id}
                            {r.selected.includes(o.id) ? " [selected]" : ""}
                            {r.correctOptionIds.includes(o.id)
                              ? " [correct]"
                              : ""}
                            .
                          </strong>{" "}
                          {o.text}
                        </p>
                      ))}
                      <p className="muted">
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
                      const saved = await api(
                        "admin",
                        "PUT",
                        JSON.parse(adminText),
                      );
                      setBank(await api("questions"));
                      setNotice(`Saved ${saved.saved} validated questions.`);
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
    </main>
  );
}
