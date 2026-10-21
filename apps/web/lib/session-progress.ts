export type Progress = {
  answers: Record<string, string[]>;
  flags: string[];
  index: number;
};
export type SaveState = "saved" | "pending" | "saving" | "error";
type Saved = { progressRevision: number };

/** One request at a time; edits during a request remain pending until acknowledged. */
export class SessionProgress {
  private latest: Progress;
  private confirmed: string;
  private revision: number;
  private timer?: ReturnType<typeof setTimeout>;
  private running?: Promise<Saved>;
  private stopped = false;
  private failed = false;

  constructor(
    initial: Progress,
    revision: number,
    private send: (
      progress: Progress & {
        action: "save" | "pause";
        progressRevision: number;
      },
    ) => Promise<Saved>,
    private notify: (state: SaveState) => void,
  ) {
    this.latest = initial;
    this.confirmed = JSON.stringify(initial);
    this.revision = revision;
  }
  get pending() {
    return (
      JSON.stringify(this.latest) !== this.confirmed ||
      !!this.running ||
      this.failed
    );
  }
  update(progress: Progress) {
    if (this.stopped) return;
    this.latest = progress;
    clearTimeout(this.timer);
    this.notify(this.pending ? "pending" : "saved");
    if (this.pending)
      this.timer = setTimeout(() => void this.save().catch(() => {}), 500);
  }
  async save(action: "save" | "pause" = "save"): Promise<Saved> {
    clearTimeout(this.timer);
    if (this.running) {
      await this.running;
      return this.save(action);
    }
    if (this.stopped) throw new Error("Session closed");
    if (action === "save" && !this.pending)
      return { progressRevision: this.revision };
    const snapshot = this.latest;
    this.notify("saving");
    const request = this.send({
      ...snapshot,
      action,
      progressRevision: this.revision,
    });
    this.running = request;
    try {
      const saved = await request;
      this.revision = saved.progressRevision;
      this.confirmed = JSON.stringify(snapshot);
      this.failed = false;
      if (action === "pause") this.stopped = true;
      this.notify(
        this.pending && JSON.stringify(this.latest) !== this.confirmed
          ? "pending"
          : "saved",
      );
      return saved;
    } catch (error) {
      this.failed = true;
      this.notify("error");
      throw error;
    } finally {
      this.running = undefined;
      if (
        !this.failed &&
        !this.stopped &&
        JSON.stringify(this.latest) !== this.confirmed
      )
        this.timer = setTimeout(() => void this.save().catch(() => {}), 500);
    }
  }
  async drain() {
    clearTimeout(this.timer);
    await this.running?.catch(() => {});
    clearTimeout(this.timer);
  }
  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.running?.catch(() => {});
  }
}
