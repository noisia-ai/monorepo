export function isLocalAuthOverrideEnabled(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    env.NOISIA_ENABLE_LOCAL_AUTH_OVERRIDE === "true" &&
    env.NOISIA_LOCAL_AUTH_EMAIL?.trim() &&
    env.NODE_ENV !== "production" &&
    env.VERCEL_ENV !== "production" &&
    env.RAILWAY_ENVIRONMENT !== "production"
  );
}
