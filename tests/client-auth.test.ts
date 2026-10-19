import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Auth, User } from "@firebase/auth";
const sdk = vi.hoisted(() => ({ anonymous: vi.fn(), google: vi.fn(), link: vi.fn(), parameters: vi.fn() }));
vi.mock("@firebase/auth", () => ({
  GoogleAuthProvider: class { setCustomParameters = sdk.parameters; },
  signInAnonymously: sdk.anonymous,
  signInWithPopup: sdk.google,
  linkWithPopup: sdk.link,
}));
import { continueAsGuest, continueWithGoogle, authenticationError } from "../apps/web/lib/client-auth";
function fixture(user: Partial<User> | null = null) {
  return { currentUser: user, authStateReady: vi.fn().mockResolvedValue(undefined) } as unknown as Auth;
}
beforeEach(() => vi.clearAllMocks());
describe("guest Firebase client authentication", () => {
  it("creates a guest with the native SDK only when no restored account exists", async () => {
    const user = { uid: "guest", isAnonymous: true };
    const auth = fixture();
    sdk.anonymous.mockResolvedValue({ user });
    expect(await continueAsGuest(auth)).toBe(user);
    expect(auth.authStateReady).toHaveBeenCalledOnce();
    expect(sdk.anonymous).toHaveBeenCalledWith(auth);
  });
  it.each([true, false])("reuses restored users (anonymous=%s) without creating accounts", async (isAnonymous) => {
    const auth = fixture({ uid: "persisted", isAnonymous });
    expect(await continueAsGuest(auth)).toBe(auth.currentUser);
    expect(sdk.anonymous).not.toHaveBeenCalled();
  });
  it("waits for persistence restoration before creating an account", async () => {
    const auth = fixture();
    auth.authStateReady = vi.fn(async () => { Object.assign(auth, { currentUser: { uid: "restored" } }); });
    expect((await continueAsGuest(auth)).uid).toBe("restored");
    expect(sdk.anonymous).not.toHaveBeenCalled();
  });
  it("links Google to the guest UID and refreshes its token without signing into another account", async () => {
    const user = { uid: "guest", isAnonymous: true, getIdToken: vi.fn().mockResolvedValue("linked-token") };
    const auth = fixture(user);
    sdk.link.mockResolvedValue({ user });
    expect((await continueWithGoogle(auth)).uid).toBe("guest");
    expect(sdk.link).toHaveBeenCalledWith(user, expect.anything());
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(sdk.google).not.toHaveBeenCalled();
    expect(sdk.parameters).toHaveBeenCalledWith({ prompt: "select_account" });
  });
  it("preserves the normal Google popup flow", async () => {
    const user = { uid: "google", getIdToken: vi.fn().mockResolvedValue("token") };
    sdk.google.mockResolvedValue({ user });
    expect(await continueWithGoogle(fixture())).toBe(user);
    expect(sdk.link).not.toHaveBeenCalled();
  });
  it.each(["auth/credential-already-in-use", "auth/account-exists-with-different-credential", "auth/email-already-in-use"])("keeps guest identity on conflict: %s", async (code) => {
    const auth = fixture({ uid: "guest", isAnonymous: true });
    sdk.link.mockRejectedValue({ code });
    await expect(continueWithGoogle(auth)).rejects.toEqual({ code });
    expect(auth.currentUser?.uid).toBe("guest");
    expect(sdk.google).not.toHaveBeenCalled();
    expect(authenticationError({ code })).toContain("neither account's progress has been changed");
  });
  it.each([
    ["auth/operation-not-allowed", "disabled"],
    ["auth/admin-restricted-operation", "disabled"],
    ["auth/popup-blocked", "blocked"],
    ["auth/popup-closed-by-user", "cancelled"],
    ["auth/network-request-failed", "connection"],
    ["auth/too-many-requests", "limits"],
    ["auth/unauthorized-domain", "domain"],
    ["auth/web-storage-unsupported", "storage"],
    ["unknown", "Authentication failed"],
  ])("explains %s", (code, message) => expect(authenticationError({ code })).toContain(message));
});
