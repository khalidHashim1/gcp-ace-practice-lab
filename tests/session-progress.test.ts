import { afterEach, expect, it, vi } from "vitest";
import {
  SessionProgress,
  type Progress,
} from "../apps/web/lib/session-progress";
const initial: Progress = { answers: {}, flags: [], index: 0 };
const edited: Progress = { answers: { q1: ["B"] }, flags: ["q1"], index: 3 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());
it("debounces rapid answers, flags and position into the latest snapshot", async () => {
  vi.useFakeTimers();
  const send = vi.fn().mockResolvedValue({ progressRevision: 1 });
  const notify = vi.fn();
  const saver = new SessionProgress(initial, 0, send, notify);
  for (let index = 0; index < 20; index++) saver.update({ ...edited, index });
  expect(send).not.toHaveBeenCalled();
  expect(saver.pending).toBe(true);
  await vi.advanceTimersByTimeAsync(500);
  expect(send).toHaveBeenCalledExactlyOnceWith({
    ...edited,
    index: 19,
    action: "save",
    progressRevision: 0,
  });
  expect(saver.pending).toBe(false);
  expect(notify).toHaveBeenLastCalledWith("saved");
});
it("serializes overlapping saves and never confirms changes made during a request", async () => {
  vi.useFakeTimers();
  const first = deferred<{ progressRevision: number }>();
  const send = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ progressRevision: 2 });
  const notify = vi.fn();
  const saver = new SessionProgress(initial, 0, send, notify);
  saver.update(edited);
  await vi.advanceTimersByTimeAsync(500);
  saver.update({ ...edited, answers: { q1: ["C"] }, index: 8 });
  await vi.advanceTimersByTimeAsync(500);
  expect(send).toHaveBeenCalledTimes(1);
  first.resolve({ progressRevision: 1 });
  await Promise.resolve();
  expect(saver.pending).toBe(true);
  await vi.advanceTimersByTimeAsync(500);
  expect(send).toHaveBeenLastCalledWith({
    ...edited,
    answers: { q1: ["C"] },
    index: 8,
    action: "save",
    progressRevision: 1,
  });
  expect(saver.pending).toBe(false);
});
it("failed autosave stays unprotected until an explicit retry succeeds", async () => {
  const send = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ progressRevision: 1 });
  const notify = vi.fn();
  const saver = new SessionProgress(initial, 0, send, notify);
  saver.update(edited);
  await expect(saver.save()).rejects.toThrow("offline");
  expect(saver.pending).toBe(true);
  expect(notify).toHaveBeenLastCalledWith("error");
  await saver.save();
  expect(saver.pending).toBe(false);
  expect(notify).toHaveBeenLastCalledWith("saved");
});
it("Pause & Save waits for an active save then persists the latest edits", async () => {
  const first = deferred<{ progressRevision: number }>();
  const send = vi
    .fn()
    .mockReturnValueOnce(first.promise)
    .mockResolvedValueOnce({ progressRevision: 2 });
  const saver = new SessionProgress(initial, 0, send, vi.fn());
  saver.update(edited);
  const saving = saver.save();
  saver.update({ ...edited, index: 9 });
  const pausing = saver.save("pause");
  first.resolve({ progressRevision: 1 });
  await saving;
  await pausing;
  expect(send).toHaveBeenLastCalledWith({
    ...edited,
    index: 9,
    action: "pause",
    progressRevision: 1,
  });
  expect(saver.pending).toBe(false);
});
it("closing a session cancels queued saves", async () => {
  vi.useFakeTimers();
  const send = vi.fn();
  const saver = new SessionProgress(initial, 0, send, vi.fn());
  saver.update(edited);
  await saver.stop();
  await vi.advanceTimersByTimeAsync(1000);
  expect(send).not.toHaveBeenCalled();
});
