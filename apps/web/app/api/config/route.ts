export const dynamic = "force-dynamic";
export function GET() {
  return Response.json({
    cloud: process.env.DATA_MODE === "firestore",
    firebase:
      process.env.DATA_MODE === "firestore"
        ? {
            apiKey: process.env.FIREBASE_API_KEY,
            authDomain: process.env.FIREBASE_AUTH_DOMAIN,
            projectId: process.env.GOOGLE_CLOUD_PROJECT,
            appId: process.env.FIREBASE_APP_ID,
          }
        : null,
  });
}
