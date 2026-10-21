"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp, getApps } from "@firebase/app";
import {
  getAuth,
  browserLocalPersistence,
  setPersistence,
  signOut,
  type User,
} from "@firebase/auth";
import {
  continueAsGuest,
  continueWithGoogle,
  authenticationError,
} from "../lib/client-auth";
import { Icon, StatCard, EmptyState, Modal, type IconName } from "../lib/ui";
import type { PublicQuestion } from "../lib/schema";
import { toggleSelection, remainingSeconds } from "../lib/exam";
import {
  SessionProgress,
  type SaveState,
  type Progress,
} from "../lib/session-progress";
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
  mode?: "review" | "timed" | null;
  examId?: string | null;
  topic?: string | null;
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
  progressRevision?: number;
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
    [theme, setTheme] = useState("dark"),
    [pendingStart, setPendingStart] = useState<null | {
      mode: "review" | "timed" | "practice";
      topic?: string;
      examId?: string;
    }>(null),
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
    [authReady, setAuthReady] = useState(false),
    [authBusy, setAuthBusy] = useState(false),
    [guest, setGuest] = useState(false),
    [confirmGuestSignOut, setConfirmGuestSignOut] = useState(false),
    [user, setUser] = useState<User | null>(null),
    [isAdmin, setIsAdmin] = useState(false),
    [adminBankId, setAdminBankId] = useState("ace-practice-1"),
    [adminText, setAdminText] = useState(""),
    [notice, setNotice] = useState(""),
    [seconds, setSeconds] = useState(0),
    [confirmSubmit, setConfirmSubmit] = useState(false),
    [feedbackOpen, setFeedbackOpen] = useState(false),
    [feedbackCategory, setFeedbackCategory] = useState("unclear_explanation"),
    [feedbackComment, setFeedbackComment] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const progressSaver = useRef<SessionProgress | null>(null);
  const submitting = useRef(false);
  function trackProgress(
    s: Session,
    progress: {
      answers: Record<string, string[]>;
      flags: string[];
      index: number;
    },
  ) {
    void progressSaver.current?.stop();
    setSaveState("saved");
    const saver = new SessionProgress(
      progress,
      s.progressRevision ?? 0,
      (payload) => api("sessions", "PATCH", { sessionId: s.id, ...payload }),
      (state) => {
        if (progressSaver.current === saver) setSaveState(state);
      },
    );
    progressSaver.current = saver;
  }
  function changeProgress(change: Partial<Progress>) {
    const next = { answers, flags, index, ...change };
    progressSaver.current?.update(next);
    if (change.answers !== undefined) setAnswers(change.answers);
    if (change.flags !== undefined) setFlags(change.flags);
    if (change.index !== undefined) setIndex(change.index);
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (progressSaver.current?.pending) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(
    () => () => {
      void progressSaver.current?.stop();
    },
    [],
  );
  const authPending = useRef(false);
  const previousUid = useRef<string | null>(null);
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
    let disposed = false;
    fetch("/api/config")
      .then((r) => r.json())
      .then(async (c) => {
        if (disposed) return;
        setCloud(c.cloud);
        setTheme(document.documentElement.dataset.theme ?? "dark");
        if (c.cloud) {
          const app = getApps()[0] ?? initializeApp(c.firebase);
          const auth = getAuth(app);
          await setPersistence(auth, browserLocalPersistence);
          if (disposed) return;
          unsubscribe = auth.onIdTokenChanged((u) => {
            if (disposed) return;
            if (previousUid.current !== (u?.uid ?? null)) {
              void progressSaver.current?.stop();
              progressSaver.current = null;
              setAttempts([]);
              setSavedSession(null);
              setSession(null);
              setResult(null);
              setAnswers({});
              setFlags([]);
              setCheckedReview({});
              setView("dashboard");
            }
            previousUid.current = u?.uid ?? null;
            setUser(u);
            setGuest(Boolean(u?.isAnonymous));
            setIsAdmin(false);
            setAuthReady(true);
            if (u && !u.isAnonymous) {
              void u
                .getIdTokenResult()
                .then((token) => {
                  if (
                    !disposed &&
                    auth.currentUser?.uid === u.uid &&
                    !u.isAnonymous
                  )
                    setIsAdmin(token.claims.admin === true);
                })
                .catch(() => {
                  if (!disposed)
                    setError(
                      "Could not verify account permissions. Please retry sign-in.",
                    );
                });
            }
          });
        } else {
          setIsAdmin(true);
          setAuthReady(true);
        }
        return Promise.all([fetch("/api/questions"), fetch("/api/exams")]);
      })
      .then(async (responses) => {
        if (!responses || disposed) return;
        const [questionResponse, examResponse] = responses;
        if (!questionResponse.ok) throw new Error("Could not load questions");
        if (!examResponse.ok) throw new Error("Could not load exam catalog");
        const [loadedBank, loadedExams] = await Promise.all([
          questionResponse.json(),
          examResponse.json(),
        ]);
        setBank(loadedBank);
        setExamCatalog(loadedExams);
      })
      .catch((e) => {
        if (!disposed) setError(e.message);
      })
      .finally(() => {
        if (!disposed) setReady(true);
      });
    const savedTheme = localStorage.getItem("ace-theme") ?? "dark";
    document.documentElement.dataset.theme = savedTheme;
    return () => {
      disposed = true;
      unsubscribe?.();
    };
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
  async function authenticate(method: "guest" | "google") {
    if (authPending.current || !authReady) return;
    authPending.current = true;
    setAuthBusy(true);
    setError("");
    setNotice("");
    try {
      const wasGuest = Boolean(getAuth().currentUser?.isAnonymous);
      const authenticated =
        method === "guest"
          ? await continueAsGuest(getAuth())
          : await continueWithGoogle(getAuth());
      setUser(authenticated);
      setGuest(authenticated.isAnonymous);
      if (wasGuest && !authenticated.isAnonymous)
        setNotice(
          "Your progress is now saved with Google. Your attempts and saved exams are unchanged.",
        );
    } catch (e) {
      setError(authenticationError(e));
    } finally {
      authPending.current = false;
      setAuthBusy(false);
    }
  }
  async function submit() {
    if (!session || submitting.current) return;
    submitting.current = true;
    await run(async () => {
      await progressSaver.current?.drain();
      const a = await api("attempts", "POST", {
        sessionId: session.id,
        answers,
        flags,
      });
      await progressSaver.current?.stop();
      progressSaver.current = null;
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
    if (session?.deadline && seconds === 0 && !busy) void submit();
  });
  async function start(
    mode: "review" | "timed" | "practice",
    topic?: string,
    examId?: string,
  ) {
    if (savedSession) {
      setPendingStart({ mode, topic, examId });
      return;
    }
    await begin(mode, topic, examId);
  }
  async function begin(
    mode: "review" | "timed" | "practice",
    topic?: string,
    examId?: string,
  ) {
    await run(async () => {
      const s = await api("exams", "POST", { mode, topic, examId });
      trackProgress(s, { answers: {}, flags: [], index: 0 });
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
      const saved = await progressSaver.current!.save("pause");
      setSavedSession(saved as ResumableSession);
      setSession(null);
      setConfirmSubmit(false);
      setView("dashboard");
      setNotice(
        "Exam paused. Your answers, flags, position, and remaining time are saved.",
      );
    });
  }
  async function resume() {
    if (!savedSession) return;
    await run(async () => {
      const resumed = await api("sessions", "POST", {
        sessionId: savedSession.id,
      });
      trackProgress(resumed, {
        answers: resumed.answers,
        flags: resumed.flags,
        index: resumed.index,
      });
      setSession(resumed);
      setAnswers(resumed.answers);
      setFlags(resumed.flags);
      setIndex(resumed.index);
      setCheckedReview({});
      setSeconds(
        resumed.deadline ? remainingSeconds(resumed.deadline, Date.now()) : 0,
      );
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
  const practicedIds = new Set(
    attempts.flatMap((attempt) =>
      attempt.review
        .filter((item) => item.selected.length)
        .map((item) => item.id),
    ),
  );
  const studied = bank.filter((question) =>
    practicedIds.has(question.id),
  ).length;
  const topicAnalytics = useMemo(
    () => summarizeTopics(topics, bank, attempts),
    [attempts, bank, topics],
  );
  const coverage = bank.length ? Math.round((studied / bank.length) * 100) : 0;
  const featuredExam = examCatalog.find((exam) => exam.available);
  const completedMocks = attempts.filter(
    (attempt) => attempt.mode === "timed",
  ).length;
  const legacyAttempts = attempts.some((attempt) => !attempt.mode);
  const signedIn = !cloud || Boolean(user);
  const navItems: {
    id: string;
    label: string;
    mobile: string;
    icon: IconName;
  }[] = [
    { id: "dashboard", label: "Dashboard", mobile: "Home", icon: "grid" },
    {
      id: "practice",
      label: "Topic Practice",
      mobile: "Practice",
      icon: "book",
    },
    { id: "mock", label: "Mock Exam", mobile: "Mock Exam", icon: "clock" },
    {
      id: "history",
      label: "Attempt history",
      mobile: "History",
      icon: "history",
    },
  ];
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ace-theme", next);
  }
  function openAttempt(attempt: Attempt) {
    setResult(attempt);
    setIncorrect(false);
    setView("review");
    window.scrollTo({ top: 0 });
  }
  const attemptLabel = (attempt: Attempt) =>
    attempt.topic
      ? `${attempt.topic} practice`
      : attempt.mode === "timed"
        ? "Mock exam"
        : attempt.mode === "review"
          ? "Review practice"
          : "Practice attempt";
  function activityList(items: Attempt[]) {
    return (
      <div className="activity-list">
        {items.map((attempt) => (
          <button
            className="activity-item"
            key={attempt.id}
            onClick={() => openAttempt(attempt)}
          >
            <span className="activity-icon">
              <Icon name={attempt.mode === "timed" ? "clock" : "book"} />
            </span>
            <span className="activity-copy">
              <strong>{attemptLabel(attempt)}</strong>
              <span>
                {new Date(attempt.submittedAt).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}{" "}
                · {attempt.review.length} questions
              </span>
            </span>
            <span className="activity-score">
              <strong>
                {attempt.percentage === null
                  ? "Ungraded"
                  : `${attempt.percentage}%`}
              </strong>
              <small>{attempt.expired ? "Time expired" : "Completed"}</small>
            </span>
            <Icon name="arrow" size={18} />
          </button>
        ))}
      </div>
    );
  }
  function topicGrid() {
    return (
      <div className="topics">
        {topicAnalytics.map((topic, position) => {
          const practiced = bank.filter(
            (question) =>
              question.topic === topic.topic && practicedIds.has(question.id),
          ).length;
          return (
            <article className="card topic-card" key={topic.topic}>
              <div className="topic-top">
                <span className="topic-icon">
                  <Icon
                    name={
                      (["cloud", "book", "grid", "clock"] as IconName[])[
                        position % 4
                      ]
                    }
                  />
                </span>
                <span className="muted">
                  {String(position + 1).padStart(2, "0")}
                </span>
              </div>
              <h3>{topic.topic}</h3>
              <p className="muted">{topic.questions} scenario questions</p>
              <div className="progress-label">
                <span>Study coverage</span>
                <span>
                  {practiced}/{topic.questions}
                </span>
              </div>
              <progress
                value={practiced}
                max={topic.questions || 1}
                aria-label={`${topic.topic} study coverage`}
              />
              <button
                className="text-button topic-action"
                disabled={busy || !signedIn}
                onClick={() => void start("practice", topic.topic)}
              >
                {practiced ? "Continue practice" : "Start practice"}
                <Icon name="arrow" size={17} />
                <span className="sr-only">{topic.topic}</span>
              </button>
            </article>
          );
        })}
      </div>
    );
  }
  const adminBanks = useMemo(
    () => [
      ...new Map(
        examCatalog.map((exam) => [exam.questionBankId, exam]),
      ).values(),
    ],
    [examCatalog],
  );
  return (
    <div className={`app-shell ${session ? "exam-active" : ""}`}>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="cloud" size={23} />
          </span>
          <span>
            ACE <small>Practice Lab</small>
          </span>
        </div>
        <div className="sidebar-label">WORKSPACE</div>
        <nav className="nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <button
              key={item.id}
              aria-label={item.label}
              disabled={!!session}
              className={`nav-link ${view === item.id ? "active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => {
                setView(item.id);
                window.scrollTo({ top: 0 });
              }}
            >
              <Icon name={item.icon} />
              <span className="desktop-label">{item.label}</span>
              <span className="mobile-label">{item.mobile}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="badge">
            <span className="status-dot" /> ASSOCIATE CLOUD ENGINEER
          </span>
          <p>
            Build skills.
            <br />
            Grow your cloud confidence.
          </p>
          <small>Independent learning, thoughtfully built.</small>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="mobile-brand">
            <Icon name="cloud" />{" "}
            <strong>
              ACE <span>Practice Lab</span>
            </strong>
          </div>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>
              {view === "exam"
                ? "Practice session"
                : view === "review"
                  ? "Results & review"
                  : (navItems.find((item) => item.id === view)?.label ??
                    "Question admin")}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="account-status">
              <span className="status-dot" />
              {cloud
                ? guest
                  ? "Guest workspace"
                  : user
                    ? "Google account"
                    : "Explore the lab"
                : "Local workspace"}
            </span>
            <details className="account-menu">
              <summary aria-label="Account and appearance">
                <Icon name="user" size={18} />
                <span className="desktop-label">
                  {guest
                    ? "Guest"
                    : (user?.displayName?.split(" ")[0] ?? "Account")}
                </span>
                <span aria-hidden="true">⌄</span>
              </summary>
              <div className="account-popover">
                <span className="menu-label">YOUR WORKSPACE</span>
                <strong>
                  {guest
                    ? "Guest account"
                    : (user?.displayName ?? "ACE Practice Lab")}
                </strong>
                <button
                  onClick={toggleTheme}
                  aria-label="Toggle light and dark mode"
                >
                  <Icon name="theme" />{" "}
                  {theme === "dark" ? "Light appearance" : "Dark appearance"}
                </button>
                {cloud && guest && (
                  <button
                    disabled={authBusy || busy || !!session}
                    onClick={() => void authenticate("google")}
                  >
                    <Icon name="cloud" />
                    {authBusy ? "Connecting…" : "Save My Progress with Google"}
                  </button>
                )}
                {cloud && user && (
                  <button
                    disabled={authBusy || busy || !!session}
                    onClick={() => {
                      if (guest) setConfirmGuestSignOut(true);
                      else
                        void run(async () => {
                          await signOut(getAuth());
                        });
                    }}
                  >
                    Sign out
                  </button>
                )}
                {isAdmin && (
                  <button
                    disabled={!!session}
                    onClick={() =>
                      void run(async () => {
                        setAdminBankId("ace-practice-1");
                        setAdminText(
                          JSON.stringify(
                            await api("admin?bankId=ace-practice-1"),
                            null,
                            2,
                          ),
                        );
                        setView("admin");
                      })
                    }
                  >
                    Question admin
                  </button>
                )}
              </div>
            </details>
          </div>
        </header>
        <main className="content" id="main-content" tabIndex={-1}>
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
          {ready && cloud && !user && (
            <section
              className="welcome-card"
              aria-label="Sign in"
              aria-busy={authBusy || !authReady}
            >
              <div className="welcome-copy">
                <span className="eyebrow">YOUR NEXT CLOUD MILESTONE</span>
                <h1>
                  Prepare smarter.
                  <br />
                  <span>Pass with confidence.</span>
                </h1>
                <p>
                  Practice real-world Google Cloud scenarios, track your
                  progress, and get exam-ready.
                </p>
                <div className="welcome-proof">
                  <span>
                    <Icon name="check" size={15} />
                    Scenario-based practice
                  </span>
                  <span>
                    <Icon name="check" size={15} />
                    Learn at your pace
                  </span>
                </div>
              </div>
              <div className="welcome-actions">
                <span className="welcome-icon">
                  <Icon name="cloud" size={30} />
                </span>
                <h2>Your cloud journey starts here.</h2>
                <button
                  className="primary"
                  disabled={!authReady || authBusy}
                  onClick={() => void authenticate("google")}
                >
                  <span className="google-mark" aria-hidden="true">
                    G
                  </span>
                  Continue with Google
                </button>
                <button
                  disabled={!authReady || authBusy}
                  onClick={() => void authenticate("guest")}
                >
                  Continue as Guest <Icon name="arrow" size={17} />
                </button>
                <p className="helper">
                  Explore without signing up. Link Google later to keep your
                  progress across devices.
                </p>
                {(!authReady || authBusy) && (
                  <p role="status">
                    {authBusy ? "Signing in…" : "Restoring your session…"}
                  </p>
                )}
              </div>
            </section>
          )}
          {cloud && guest && !session && (
            <div className="guest-banner">
              <span>
                <span className="badge">GUEST</span> Progress saved in this
                browser.
              </span>
              <button
                className="text-button"
                disabled={authBusy || busy}
                onClick={() => void authenticate("google")}
              >
                {authBusy ? "Connecting…" : "Save with Google"}
                <Icon name="arrow" size={15} />
              </button>
              <details>
                <summary>About guest progress</summary>
                <p>
                  Progress may become inaccessible if your anonymous account is
                  deleted, you lose this browser’s sign-in data, sign out, or
                  switch devices. Link Google to keep access across devices.
                </p>
              </details>
            </div>
          )}
          {confirmGuestSignOut && (
            <Modal
              title="Leave your guest account?"
              busy={authBusy || busy}
              onClose={() => setConfirmGuestSignOut(false)}
            >
              <p className="muted">
                Signing out may make your guest progress inaccessible. Link
                Google first to keep access.
              </p>
              <div className="dialog-actions">
                <button
                  onClick={() => setConfirmGuestSignOut(false)}
                  disabled={authBusy || busy}
                >
                  Keep guest session
                </button>
                <button
                  className="primary"
                  disabled={authBusy || busy}
                  onClick={() => {
                    setConfirmGuestSignOut(false);
                    void authenticate("google");
                  }}
                >
                  Save My Progress with Google
                </button>
                <button
                  className="danger-button"
                  disabled={authBusy || busy}
                  onClick={() =>
                    void run(async () => {
                      await signOut(getAuth());
                      setConfirmGuestSignOut(false);
                    })
                  }
                >
                  Sign out of guest account
                </button>
              </div>
            </Modal>
          )}
          {!ready ? (
            <p role="status">Loading your practice lab…</p>
          ) : (
            <>
              {view === "dashboard" && (
                <>
                  {signedIn && (
                    <header className="page-heading">
                      <div>
                        <span className="eyebrow">YOUR LEARNING WORKSPACE</span>
                        <h1>
                          {guest
                            ? "Make progress, one question at a time."
                            : "Welcome back."}
                        </h1>
                        <p className="muted">
                          Ready to continue your cloud journey?
                        </p>
                      </div>
                      <span className="badge certification-badge">
                        <Icon name="cloud" size={16} /> Google Cloud ACE
                      </span>
                    </header>
                  )}
                  {!signedIn && (
                    <div className="section-heading">
                      <h2>Inside your practice lab</h2>
                      <span className="muted">Explore. Practice. Improve.</span>
                    </div>
                  )}
                  <div className="metrics-grid">
                    <StatCard
                      label="Questions available"
                      value={bank.length}
                      note="Real-world cloud scenarios"
                      icon="book"
                    />
                    <StatCard
                      label="Questions practiced"
                      value={studied}
                      note="Unique questions answered"
                      icon="check"
                    />
                    <StatCard
                      label="Study coverage"
                      value={`${coverage}%`}
                      note={`${studied} of ${bank.length} explored`}
                      icon="grid"
                    />
                    <StatCard
                      label="Completed mock exams"
                      value={completedMocks}
                      note={
                        legacyAttempts
                          ? "New typed attempts only"
                          : "Timed attempts submitted"
                      }
                      icon="clock"
                    />
                  </div>
                  {savedSession && (
                    <section className="card resume-card">
                      <span className="resume-icon">
                        <Icon name="history" size={24} />
                      </span>
                      <div>
                        <span className="eyebrow">
                          PICK UP WHERE YOU LEFT OFF
                        </span>
                        <h2>Ready when you are.</h2>
                        <p className="muted">
                          {
                            Object.values(savedSession.answers).filter(
                              (answer) => answer.length,
                            ).length
                          }{" "}
                          of {savedSession.questions.length} answered ·{" "}
                          {savedSession.pausedRemainingSeconds != null
                            ? `${Math.ceil(savedSession.pausedRemainingSeconds / 60)} minutes remaining`
                            : savedSession.deadline
                              ? "Timer active"
                              : "Untimed practice"}
                        </p>
                      </div>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() => void resume()}
                      >
                        Resume exam <Icon name="arrow" size={17} />
                      </button>
                    </section>
                  )}
                  <div className="dashboard-columns">
                    <section className="mock-feature">
                      <div className="mock-feature-copy">
                        <span className="eyebrow">
                          <span className="status-dot" /> EXAM SIMULATION
                        </span>
                        <h2>
                          Ready for
                          <br />
                          the real exam?
                        </h2>
                        <p>
                          Practice under exam conditions
                          <br className="desktop-label" /> and build confidence.
                        </p>
                        <div className="exam-pills">
                          {featuredExam ? (
                            <>
                              <span>
                                <Icon name="book" size={15} />
                                {featuredExam.questionCount} questions
                              </span>
                              <span>
                                <Icon name="clock" size={15} />
                                {featuredExam.durationMinutes} minutes
                              </span>
                            </>
                          ) : (
                            <span>No exam available</span>
                          )}
                        </div>
                        <button
                          className="primary"
                          disabled={busy || !signedIn || !featuredExam}
                          onClick={() =>
                            void start("timed", undefined, featuredExam?.id)
                          }
                        >
                          Start Mock Exam <Icon name="arrow" size={17} />
                        </button>
                        <button
                          className="text-button"
                          onClick={() => setView("mock")}
                        >
                          Browse all exams
                        </button>
                      </div>
                      <div className="exam-visual" aria-hidden="true">
                        <div className="orbit orbit-one" />
                        <div className="orbit orbit-two" />
                        <span className="exam-visual-icon">
                          <Icon name="cloud" size={50} />
                        </span>
                        <span className="visual-label">
                          CLOUD ENGINEER
                          <br />
                          <strong>IN THE MAKING</strong>
                        </span>
                      </div>
                    </section>
                    <section className="card journey-card">
                      <div className="section-heading">
                        <h2>Your study rhythm</h2>
                        <Icon name="grid" size={18} />
                      </div>
                      <div
                        className="coverage-ring"
                        style={{
                          background: `conic-gradient(var(--accent) ${coverage}%, var(--border) 0)`,
                        }}
                      >
                        <div>
                          <strong>{coverage}%</strong>
                          <span>coverage</span>
                        </div>
                      </div>
                      <p>
                        {studied
                          ? "Every scenario builds your confidence."
                          : "Your next milestone starts with one question."}
                      </p>
                      <span className="muted">
                        {studied} practiced ·{" "}
                        {Math.max(0, bank.length - studied)} to explore
                      </span>
                      <button
                        className="text-button"
                        onClick={() => setView("practice")}
                      >
                        Find your next topic <Icon name="arrow" size={16} />
                      </button>
                    </section>
                  </div>
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">BUILD YOUR FOUNDATIONS</span>
                      <h2>Practice by topic</h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setView("practice")}
                    >
                      All topics <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  {topicGrid()}
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">YOUR LEARNING LOG</span>
                      <h2>Recent activity</h2>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setView("history")}
                    >
                      View history <Icon name="arrow" size={16} />
                    </button>
                  </div>
                  {attempts.length ? (
                    activityList(attempts.slice(0, 3))
                  ) : (
                    <EmptyState
                      title="A fresh start, full of possibility."
                      action={
                        <button onClick={() => setView("practice")}>
                          Explore topics <Icon name="arrow" size={16} />
                        </button>
                      }
                    >
                      Your completed sessions will appear here. Choose a topic
                      to get started.
                    </EmptyState>
                  )}
                </>
              )}
              {view === "practice" && (
                <>
                  <header className="page-heading">
                    <div>
                      <span className="eyebrow">FOCUSED LEARNING</span>
                      <h1>Small sessions. Strong foundations.</h1>
                      <p className="muted">
                        Choose a topic, check your answers, and learn as you go.
                      </p>
                    </div>
                    <span className="badge">
                      {topics.length} topics · {bank.length} questions
                    </span>
                  </header>
                  {!signedIn && (
                    <p className="banner">
                      Continue with Google or as a guest above to start
                      practicing.
                    </p>
                  )}
                  {topicGrid()}
                  <div className="grading-note">
                    <Icon name="check" size={17} />
                    <span>
                      {
                        bank.filter(
                          (question) => question.verification === "verified",
                        ).length
                      }{" "}
                      verified answer keys. Unverified questions track
                      completion and stay ungraded.
                    </span>
                  </div>
                </>
              )}
              {view === "mock" && (
                <>
                  <header className="page-heading">
                    <div>
                      <span className="eyebrow">EXAM READINESS</span>
                      <h1>Practice like it’s exam day.</h1>
                      <p className="muted">
                        Choose a full simulation or slow down with guided
                        review.
                      </p>
                    </div>
                  </header>
                  <div className="mode-picker" aria-label="Study mode">
                    <button
                      className={`mode-choice ${dashboardMode === "timed" ? "active" : ""}`}
                      aria-pressed={dashboardMode === "timed"}
                      onClick={() => setDashboardMode("timed")}
                    >
                      <Icon name="clock" />
                      <span>
                        <strong>Timed mode</strong>
                        <small>Exam conditions · countdown timer</small>
                      </span>
                    </button>
                    <button
                      className={`mode-choice ${dashboardMode === "review" ? "active" : ""}`}
                      aria-pressed={dashboardMode === "review"}
                      onClick={() => setDashboardMode("review")}
                    >
                      <Icon name="book" />
                      <span>
                        <strong>Review mode</strong>
                        <small>Untimed · learn with explanations</small>
                      </span>
                    </button>
                  </div>
                  <div className="exam-grid">
                    {examCatalog.map((exam, position) => (
                      <article className="card exam-tile" key={exam.id}>
                        <div className="topic-top">
                          <span className="topic-icon">
                            <Icon name="clock" />
                          </span>
                          <span className="muted">
                            EXAM {String(position + 1).padStart(2, "0")}
                          </span>
                        </div>
                        <h2>{exam.title}</h2>
                        <p className="muted">{exam.description}</p>
                        <div className="exam-pills">
                          <span>{exam.questionCount} questions</span>
                          <span>
                            {dashboardMode === "timed"
                              ? `${exam.durationMinutes} minutes`
                              : "Untimed"}
                          </span>
                        </div>
                        <button
                          className={position === 0 ? "primary" : ""}
                          disabled={busy || !exam.available || !signedIn}
                          onClick={() =>
                            void start(dashboardMode, undefined, exam.id)
                          }
                        >
                          {!exam.available
                            ? "Exam bank unavailable"
                            : dashboardMode === "timed"
                              ? "Start timed exam"
                              : "Start review"}
                          <Icon name="arrow" size={16} />
                        </button>
                      </article>
                    ))}
                  </div>
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
                  <div className="exam-layout">
                    <div>
                      <section className="card exam-card">
                        {cloud && user && (
                          <section
                            className="feedback-control"
                            aria-label="Question feedback"
                          >
                            <button
                              onClick={() => setFeedbackOpen((open) => !open)}
                            >
                              Report a problem with this question
                            </button>
                            {feedbackOpen && (
                              <div className="feedback-form">
                                <label htmlFor="feedback-category">
                                  What needs attention?
                                </label>
                                <select
                                  id="feedback-category"
                                  value={feedbackCategory}
                                  onChange={(event) =>
                                    setFeedbackCategory(event.target.value)
                                  }
                                >
                                  <option value="wrong_answer">
                                    Wrong answer
                                  </option>
                                  <option value="unclear_explanation">
                                    Explanation unclear
                                  </option>
                                  <option value="unclear_question">
                                    Question unclear
                                  </option>
                                  <option value="technical_issue">
                                    Technical issue
                                  </option>
                                </select>
                                <label htmlFor="feedback-comment">
                                  Optional note
                                </label>
                                <textarea
                                  id="feedback-comment"
                                  value={feedbackComment}
                                  maxLength={1000}
                                  onChange={(event) =>
                                    setFeedbackComment(event.target.value)
                                  }
                                />
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      await api("feedback", "POST", {
                                        questionId: q.id,
                                        category: feedbackCategory,
                                        comment: feedbackComment,
                                      });
                                      setFeedbackOpen(false);
                                      setFeedbackComment("");
                                      setNotice(
                                        "Thanks — your feedback was saved for review.",
                                      );
                                    })
                                  }
                                >
                                  Send feedback
                                </button>
                              </div>
                            )}
                          </section>
                        )}
                        <div className="row spread">
                          <span className="muted">
                            Select {q.selectionCount} answer
                            {q.selectionCount > 1 ? "s" : ""} · {q.verification}
                          </span>
                          <button
                            disabled={busy}
                            className={flags.includes(q.id) ? "flag" : ""}
                            onClick={() =>
                              changeProgress({
                                flags: flags.includes(q.id)
                                  ? flags.filter((id) => id !== q.id)
                                  : [...flags, q.id],
                              })
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
                            disabled={busy}
                            aria-pressed={(answers[q.id] ?? []).includes(o.id)}
                            className={
                              "option " +
                              ((answers[q.id] ?? []).includes(o.id)
                                ? "selected"
                                : "")
                            }
                            key={o.id}
                            onClick={() => {
                              changeProgress({
                                answers: {
                                  ...answers,
                                  [q.id]: toggleSelection(
                                    answers[q.id] ?? [],
                                    o.id,
                                    q.selectionCount,
                                  ),
                                },
                              });
                              setCheckedReview((old) => {
                                const next = { ...old };
                                delete next[q.id];
                                return next;
                              });
                            }}
                          >
                            <span className="option-letter">{o.id}</span>
                            <span>{o.text}</span>
                          </button>
                        ))}
                        {session.mode === "review" && (
                          <div className="review-check">
                            <button
                              className="primary"
                              disabled={busy || !answers[q.id]?.length}
                              onClick={() => void checkAnswer()}
                            >
                              {busy ? "Checking…" : "Check answer"}
                            </button>
                            {!answers[q.id]?.length && (
                              <span className="muted">
                                Select an answer first.
                              </span>
                            )}
                          </div>
                        )}
                        {checked && (
                          <section
                            className="answer-feedback"
                            aria-live="polite"
                          >
                            <div className="eyebrow">ANSWER REVIEW</div>
                            <h3>
                              {checked.status === "correct"
                                ? "Correct"
                                : checked.status === "incorrect"
                                  ? "Review this answer"
                                  : "Not yet verified"}
                            </h3>
                            <p className="explanation">
                              {checked.explanation ??
                                "This question has no verified explanation yet."}
                            </p>
                            {q.options.map((option) => (
                              <p
                                className={
                                  checked.correctOptionIds.includes(option.id)
                                    ? "option-rationale correct-answer"
                                    : "option-rationale"
                                }
                                key={option.id}
                              >
                                <strong>{option.id}</strong>
                                <span>
                                  {checked.optionExplanations[option.id] ??
                                    (checked.correctOptionIds.includes(
                                      option.id,
                                    )
                                      ? "Verified as a correct answer."
                                      : "No option-specific rationale has been verified for this distractor yet.")}
                                </span>
                              </p>
                            ))}
                            {checked.references.map((url) => (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                key={url}
                              >
                                Official Google Cloud reference ↗
                              </a>
                            ))}
                          </section>
                        )}
                        <p role="status" aria-live="polite">
                          {saveState === "saved"
                            ? "Progress saved"
                            : saveState === "saving"
                              ? "Saving progress…"
                              : saveState === "error"
                                ? "Progress not saved. Keep this page open and retry."
                                : "Changes not saved yet…"}
                          {saveState === "error" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void progressSaver.current
                                  ?.save()
                                  .catch(() => {})
                              }
                            >
                              Retry save
                            </button>
                          )}
                        </p>
                        <div className="exam-actions">
                          <button
                            disabled={busy || index === 0}
                            onClick={() => changeProgress({ index: index - 1 })}
                          >
                            Previous
                          </button>
                          <button
                            disabled={
                              busy || index === session.questions.length - 1
                            }
                            onClick={() => changeProgress({ index: index + 1 })}
                          >
                            Next
                          </button>
                          <button disabled={busy} onClick={() => void pause()}>
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
                    </div>
                    <aside
                      className="card exam-sidebar"
                      aria-label="Exam navigation"
                    >
                      <div className="navigator-label">
                        <strong>Question navigator</strong>
                        <span className="muted">Answered · Flagged</span>
                      </div>
                      <div className="numbers" aria-label="Question navigator">
                        {session.questions.map((item, i) => (
                          <button
                            disabled={busy}
                            aria-current={i === index ? "step" : undefined}
                            aria-label={`Go to question ${i + 1}${flags.includes(item.id) ? ", flagged" : ""}`}
                            className={
                              (flags.includes(item.id) ? "flag " : "") +
                              (i === index ? "selected" : "") +
                              (answers[item.id]?.length ? " answered" : "")
                            }
                            key={item.id}
                            onClick={() => changeProgress({ index: i })}
                          >
                            {i + 1}
                            {answers[item.id]?.length ? " ✓" : ""}
                            {flags.includes(item.id) ? " ⚑" : ""}
                          </button>
                        ))}
                      </div>
                      <p className="muted exam-note">
                        Pause & save stops the timer and lets you continue
                        later. Timed exams submit automatically when active time
                        reaches the deadline.
                      </p>
                    </aside>
                  </div>
                </>
              )}
              {view === "history" && (
                <>
                  <header className="page-heading">
                    <div>
                      <span className="eyebrow">YOUR LEARNING LOG</span>
                      <h1>Your attempts</h1>
                      <p className="muted">
                        Progress worth looking back on. Review every step.
                      </p>
                    </div>
                    <span className="badge">{attempts.length} completed</span>
                  </header>
                  {attempts.length ? (
                    activityList(attempts)
                  ) : (
                    <EmptyState
                      title="Your story starts here."
                      action={
                        <button
                          className="primary"
                          onClick={() => setView("practice")}
                        >
                          Start practicing
                        </button>
                      }
                    >
                      Complete a session to see your scores, explanations, and
                      progress.
                    </EmptyState>
                  )}
                  {legacyAttempts && (
                    <p className="helper">
                      Older attempts have no saved exam type and are labeled
                      “Practice attempt.” No type or score is inferred.
                    </p>
                  )}
                </>
              )}
              {view === "review" && result && (
                <>
                  <header className="page-heading">
                    <div>
                      <div className="eyebrow">ATTEMPT REVIEW</div>
                      <h1>
                        {result.percentage === null
                          ? "Practice completed"
                          : `${result.percentage}% verified score`}
                      </h1>
                      <p className="muted">
                        {result.correct}/{result.graded} verified answers
                        correct · {result.ungraded} ungraded questions
                        {result.expired
                          ? " · Late submission: answers excluded from scoring"
                          : ""}
                      </p>
                    </div>
                  </header>
                  <div className="grid results-grid">
                    <section className="card score-card">
                      <div className="score-ring">
                        <strong>{result.percentage ?? "—"}</strong>
                        <span>
                          {result.percentage === null ? "ungraded" : "%"}
                        </span>
                      </div>
                      <p className="muted">Verified performance</p>
                    </section>
                    <section className="card">
                      <div className="muted">Correct</div>
                      <div className="stat">{result.correct}</div>
                      <p className="muted">
                        of {result.graded} verified questions
                      </p>
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
                    <section className="card">
                      <div className="muted">Incorrect</div>
                      <div className="stat">
                        {
                          result.review.filter(
                            (item) => item.status === "incorrect",
                          ).length
                        }
                      </div>
                      <p className="muted">verified answers to revisit</p>
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
                    <button
                      className="primary"
                      onClick={() => setView("practice")}
                    >
                      Start another practice session{" "}
                      <Icon name="arrow" size={16} />
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
                        <details className="card review-card" key={r.id}>
                          <summary>
                            <span
                              className={`badge ${r.status === "correct" ? "success-badge" : ""}`}
                            >
                              {r.status}
                            </span>
                            <span>{item?.prompt}</span>
                            <span aria-hidden="true">+</span>
                          </summary>
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
                        </details>
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
                            await api(
                              `admin?bankId=${encodeURIComponent(bankId)}`,
                            ),
                            null,
                            2,
                          ),
                        );
                      })
                    }
                  >
                    {adminBanks.map((exam) => (
                      <option
                        key={exam.questionBankId}
                        value={exam.questionBankId}
                      >
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
            <Modal
              title="Finish this attempt?"
              busy={busy}
              onClose={() => setConfirmSubmit(false)}
            >
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
            </Modal>
          )}
          {pendingStart && (
            <Modal
              title="You have a saved session"
              busy={busy}
              onClose={() => setPendingStart(null)}
            >
              <p className="muted">
                Resume your saved exam to keep working on it. Starting a new
                session replaces its resume shortcut; completed attempts stay in
                your history.
              </p>
              <div className="dialog-actions">
                <button onClick={() => setPendingStart(null)}>
                  Keep saved session
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    setPendingStart(null);
                    void resume();
                  }}
                >
                  Resume saved exam
                </button>
                <button
                  onClick={() => {
                    const next = pendingStart;
                    setPendingStart(null);
                    void begin(next.mode, next.topic, next.examId);
                  }}
                >
                  Start new session
                </button>
              </div>
            </Modal>
          )}
        </main>
      </div>
    </div>
  );
}
