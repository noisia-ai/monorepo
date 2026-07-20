const SSL_DISABLED_VALUES = new Set(["0", "false", "no", "off", "disable", "disabled"]);
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const ALLOWED_REMOTE_DATABASE_TARGETS = new Set(["staging", "throwaway", "preview"]);

export function getDatabaseSslConfig() {
  const value = process.env.DATABASE_SSL?.trim().toLowerCase();

  if (value && SSL_DISABLED_VALUES.has(value)) {
    return false;
  }

  return { rejectUnauthorized: false };
}

export function isLocalDatabaseUrl(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    return LOCAL_DATABASE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export function databaseUrlLooksProductionLike(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    const searchable = [
      parsed.hostname,
      parsed.pathname.replace(/^\//, ""),
      parsed.username
    ].join(" ").toLowerCase();
    return /(^|[^a-z0-9])(prod|production)([^a-z0-9]|$)/.test(searchable);
  } catch {
    return false;
  }
}

export function requireRemoteDatabaseTarget(databaseUrl: string, operation: string) {
  if (isLocalDatabaseUrl(databaseUrl)) return;

  const target = process.env.NOISIA_REMOTE_DATABASE_TARGET?.trim().toLowerCase();
  if (target && ALLOWED_REMOTE_DATABASE_TARGETS.has(target)) {
    if (databaseUrlLooksProductionLike(databaseUrl)) {
      throw new Error(
        [
          `Refusing to run ${operation} because DATABASE_URL contains production-like environment markers.`,
          "Use an isolated staging, throwaway or preview database URL for Data OS shadow runs."
        ].join(" ")
      );
    }
    return;
  }

  const parsed = new URL(databaseUrl);
  throw new Error(
    [
      `Refusing to run ${operation} against a non-local database without a confirmed remote target.`,
      `Host: ${parsed.hostname}`,
      "Set NOISIA_REMOTE_DATABASE_TARGET=staging, throwaway or preview after confirming DATABASE_URL is not production."
    ].join(" ")
  );
}

function requireSafeDatabaseTarget(
  databaseUrl: string,
  options: { operation: string; allowRemoteEnv: string }
) {
  if (isLocalDatabaseUrl(databaseUrl)) return;

  if (process.env[options.allowRemoteEnv] !== "true") {
    const parsed = new URL(databaseUrl);
    throw new Error(
      [
        `Refusing to run ${options.operation} against a non-local database.`,
        `Host: ${parsed.hostname}`,
        `Set ${options.allowRemoteEnv}=true only for an isolated staging/throwaway database after confirming the target.`
      ].join(" ")
    );
  }

  requireRemoteDatabaseTarget(databaseUrl, options.operation);
}

export function requireSafeDatabaseReadTarget(
  databaseUrl: string,
  options: { operation: string; allowRemoteEnv: string }
) {
  requireSafeDatabaseTarget(databaseUrl, options);
}

export function requireSafeDatabaseWriteTarget(
  databaseUrl: string,
  options: { operation: string; allowRemoteEnv: string }
) {
  requireSafeDatabaseTarget(databaseUrl, options);
}
