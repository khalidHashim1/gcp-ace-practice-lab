import {
  GoogleAuthProvider,
  signInAnonymously,
  signInWithPopup,
  linkWithPopup,
  type Auth,
} from "@firebase/auth";

/** Wait for persisted credentials before deciding whether to create an identity. */
export async function continueAsGuest(auth: Auth) {
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  return (await signInAnonymously(auth)).user;
}

/** Never sign into a different UID when upgrading: conflicts leave the guest intact. */
export async function continueWithGoogle(auth: Auth) {
  await auth.authStateReady();
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  const current = auth.currentUser;
  const credential = current?.isAnonymous
    ? await linkWithPopup(current, provider)
    : await signInWithPopup(auth, provider);
  // Linking can mutate the existing User object without an auth-state event.
  await credential.user.getIdToken(true);
  return credential.user;
}

export function authenticationError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "auth/operation-not-allowed":
    case "auth/admin-restricted-operation":
      return "This sign-in method is disabled. The project owner must enable it in Firebase Authentication. You can try Continue with Google.";
    case "auth/credential-already-in-use":
    case "auth/email-already-in-use":
    case "auth/account-exists-with-different-credential":
      return "This Google account already belongs to another account. You are still signed in as a guest, and neither account's progress has been changed. Keep using this guest session or try a different Google account. Accounts are not merged automatically.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "Google sign-in was cancelled. Your current session and saved progress are unchanged.";
    case "auth/network-request-failed":
      return "Could not connect to Firebase. Check your connection and try again.";
    case "auth/too-many-requests":
    case "auth/quota-exceeded":
      return "Sign-in is temporarily unavailable due to request limits. Please try again later.";
    case "auth/web-storage-unsupported":
      return "Your browser cannot save this sign-in session. Enable site storage and try again.";
    case "auth/unauthorized-domain":
      return "Google sign-in is not configured for this domain. Please contact the project owner.";
    default:
      return "Authentication failed. Please try again. Your saved progress has not been deleted.";
  }
}
