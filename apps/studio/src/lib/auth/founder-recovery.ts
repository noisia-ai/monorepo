export type FounderRecoverySubject = {
  email: string;
  kindeEmail: string;
  kindeId: string;
  primaryRole: string;
  userType: string;
  organizationId: string | null;
  status: string;
};

export type FounderRecoveryConfig = {
  environment: string | undefined;
  service: string | undefined;
  enabled: string | undefined;
  email: string | undefined;
  expiresAt: string | undefined;
};

/** One-time, explicitly configured recovery for an already authenticated founder. */
export function founderRecoveryAllowed(
  subject: FounderRecoverySubject,
  config: FounderRecoveryConfig,
  now: Date = new Date()
) {
  const email = subject.email.trim().toLowerCase();
  const allowedEmail = config.email?.trim().toLowerCase();
  const expiry = Date.parse(config.expiresAt ?? "");
  return config.environment === "dev-test"
    && config.service === "mfp-studio"
    && config.enabled === "true"
    && Boolean(allowedEmail && allowedEmail.endsWith("@noisia.ai"))
    && email === allowedEmail
    && subject.kindeEmail.trim().toLowerCase() === email
    && Boolean(subject.kindeId && !subject.kindeId.startsWith("local:"))
    && subject.primaryRole === "client_viewer"
    && subject.userType === "client"
    && subject.organizationId === null
    && subject.status === "active"
    && Number.isFinite(expiry)
    && expiry > now.getTime()
    && expiry <= now.getTime() + 24 * 60 * 60 * 1000;
}

export function founderRecoveryConfigFromEnvironment(): FounderRecoveryConfig {
  return {
    environment: process.env.RAILWAY_ENVIRONMENT_NAME,
    service: process.env.RAILWAY_SERVICE_NAME,
    enabled: process.env.NOISIA_FOUNDER_RECOVERY_ENABLED,
    email: process.env.NOISIA_FOUNDER_RECOVERY_EMAIL,
    expiresAt: process.env.NOISIA_FOUNDER_RECOVERY_EXPIRES_AT
  };
}
