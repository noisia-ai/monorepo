const SSL_DISABLED_VALUES = new Set(["0", "false", "no", "off", "disable", "disabled"]);
const LOCAL_DATABASE_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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

export function requireSafeDatabaseWriteTarget(
  databaseUrl: string,
  options: { operation: string; allowRemoteEnv: string }
) {
  if (isLocalDatabaseUrl(databaseUrl) || process.env[options.allowRemoteEnv] === "true") {
    return;
  }

  const parsed = new URL(databaseUrl);
  throw new Error(
    [
      `Refusing to run ${options.operation} against a non-local database.`,
      `Host: ${parsed.hostname}`,
      `Set ${options.allowRemoteEnv}=true only for an isolated staging/throwaway database after confirming the target.`
    ].join(" ")
  );
}
