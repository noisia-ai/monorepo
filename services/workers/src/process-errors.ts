/**
 * What may be logged of an error that ends the process.
 *
 * Node prints an uncaught error with every property it carries. A Redis error
 * carries the command it failed on, and for AUTH the arguments of that command
 * are the password. So only the kind, the message and the stack are logged,
 * with any secret of the environment removed from them.
 */
function secretsOf(env: NodeJS.ProcessEnv): string[] {
  const found = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!value || !/(?:URL|URI|KEY|TOKEN|SECRET|PASSWORD|DSN)$/u.test(name)) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(value)) {
      // A connection string: its password, and the whole string in case it is quoted back.
      try { const url = new URL(value); if (url.password) { found.add(url.password); found.add(decodeURIComponent(url.password)); } } catch { /* not a URL after all */ }
      if (value.includes("@")) found.add(value);
    } else if (value.length >= 8) found.add(value);
  }
  return [...found].filter(secret => secret.length >= 4).sort((left, right) => right.length - left.length);
}
export function describeFatalErrorV1(error: unknown, env: NodeJS.ProcessEnv = process.env): string {
  const secrets = secretsOf(env), clean = (value: string) => secrets.reduce((text, secret) => text.split(secret).join("***"), value);
  if (!(error instanceof Error)) return clean(typeof error === "string" ? error : "a value that is not an error was thrown").slice(0, 600);
  const head = `${error.name}: ${error.message}`;
  const frames = (error.stack ?? "").split("\n").filter(line => /^\s+at /u.test(line)).slice(0, 12).join("\n");
  return clean(frames ? `${head.slice(0, 600)}\n${frames}` : head.slice(0, 600));
}
/** Ends the process on an uncaught error, as before, without printing the error's own properties. */
export function installFatalErrorHandlersV1(target: Pick<NodeJS.Process, "on" | "exit"> = process, log: (line: string) => void = line => console.error(line)) {
  const fatal = (kind: string) => (error: unknown) => { log(`[fatal:${kind}] ${describeFatalErrorV1(error)}`); target.exit(1); };
  target.on("uncaughtException", fatal("uncaught"));
  target.on("unhandledRejection", fatal("rejection"));
}
