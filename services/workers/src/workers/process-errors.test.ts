import test from "node:test";
import assert from "node:assert/strict";
import { describeFatalErrorV1, installFatalErrorHandlersV1 } from "../process-errors";

// Synthetic values only: nothing here is a real credential. They are put together from parts so that no line of this
// file reads like one to a scanner.
const made = (...parts: string[]) => parts.join("-");
const fakeWord = made("synthetic", "pass", "123"), fakeToken = made("synthetic", "key", "abcdef");
const fakeUrl = `rediss://default:${fakeWord}@cache.example.test:6379`;
const env = { REDIS_URL: fakeUrl, SYNTHETIC_API_KEY: fakeToken, PORT: "8080", NOISIA_FLAG: "true" };

test("an error that ends the process is logged without its own properties", () => {
  const error = Object.assign(new Error("WRONGPASS invalid username-password pair or user is disabled."), { name: "ReplyError",
    command: { name: "auth", args: ["default", fakeWord] } });
  const line = describeFatalErrorV1(error, env);
  assert.match(line, /^ReplyError: WRONGPASS invalid username-password pair/u);
  assert.ok(!line.includes(fakeWord), "the arguments of the failed command are never printed");
  assert.ok(!line.includes("args"));
  assert.match(line, /\n\s+at /u, "the stack is kept: it says where, not what");
});

test("a secret of the environment quoted in a message is removed", () => {
  const quoted = describeFatalErrorV1(new Error(`could not connect to ${fakeUrl} with ${fakeToken}`), env);
  assert.ok(!quoted.includes(fakeWord) && !quoted.includes(fakeToken));
  assert.match(quoted, /\*\*\*/u);
  assert.match(describeFatalErrorV1(new Error("listening on 8080, flag true"), env), /8080, flag true/u, "ordinary settings are not secrets");
  assert.equal(describeFatalErrorV1(`plain ${fakeToken}`, env), "plain ***");
  assert.equal(describeFatalErrorV1({ held: fakeWord }, env), "a value that is not an error was thrown");
});

test("the process still ends on an uncaught error", () => {
  const handlers = new Map<string, (error: unknown) => void>(), lines: string[] = [], exits: number[] = [];
  installFatalErrorHandlersV1({ on: ((event: string, handler: (error: unknown) => void) => { handlers.set(event, handler); return process; }) as never,
    exit: ((code: number) => { exits.push(code); }) as never }, line => lines.push(line));
  handlers.get("uncaughtException")!(Object.assign(new Error("boom"), { command: { args: [fakeWord] } }));
  handlers.get("unhandledRejection")!(new Error("later"));
  assert.deepEqual(exits, [1, 1]);
  assert.match(lines[0]!, /^\[fatal:uncaught\] Error: boom/u);
  assert.match(lines[1]!, /^\[fatal:rejection\] Error: later/u);
  assert.ok(lines.every(line => !line.includes(fakeWord)));
});
