import { initializeApp, applicationDefault } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
async function main() {
  const uid = process.argv[2];
  if (!uid || !process.env.GOOGLE_CLOUD_PROJECT)
    throw new Error("Provide a Firebase UID and GOOGLE_CLOUD_PROJECT");
  initializeApp({
    credential: applicationDefault(),
    projectId: process.env.GOOGLE_CLOUD_PROJECT,
  });
  const auth = getAuth();
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...user.customClaims, admin: true });
  console.log(
    "Admin claim updated. Sign out and back in to refresh the token.",
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Admin update failed");
  process.exitCode = 1;
});
