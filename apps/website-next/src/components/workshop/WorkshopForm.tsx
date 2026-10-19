"use client";

import { useState, type FormEvent } from "react";
import { useLocale } from "next-intl";
import type { WorkshopForm as Copy } from "@/content/pages/workshop";
import styles from "./WorkshopForm.module.css";

type Status = "idle" | "sending" | "done" | "error";

export function WorkshopForm({ copy }: { copy: Copy }) {
  const locale = useLocale();
  const [status, setStatus] = useState<Status>("idle");
  // If delivery fails, the error turns into an email with everything the reader already wrote.
  const [mailto, setMailto] = useState("mailto:hola@noisia.ai");

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const lines = Object.entries(data)
      .filter(([key, value]) => key !== "website" && String(value).trim())
      .map(([key, value]) => `${key}: ${String(value)}`);
    setMailto(`mailto:hola@noisia.ai?subject=${encodeURIComponent(`Taller: ${String(data.company ?? "")}`)}&body=${encodeURIComponent(lines.join("\n"))}`);
    try {
      const response = await fetch("/api/taller", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, locale })
      });
      setStatus(response.ok ? "done" : "error");
    } catch {
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <div className={styles.done} role="status">
        {copy.success}
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate={false}>
      <label className={styles.field}>
        <span>{copy.question}</span>
        <textarea name="question" required minLength={8} rows={4} aria-describedby="question-hint" />
        <small id="question-hint">{copy.questionHint}</small>
      </label>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{copy.name}</span>
          <input name="name" required minLength={2} autoComplete="name" />
        </label>
        <label className={styles.field}>
          <span>{copy.email}</span>
          <input name="email" type="email" required autoComplete="email" inputMode="email" />
        </label>
      </div>
      <div className={styles.row}>
        <label className={styles.field}>
          <span>{copy.company}</span>
          <input name="company" required autoComplete="organization" />
        </label>
        <label className={styles.field}>
          <span>{copy.role}</span>
          <input name="role" autoComplete="organization-title" />
        </label>
      </div>
      <label className={styles.field}>
        <span>{copy.market}</span>
        <input name="market" />
      </label>
      <fieldset className={styles.field}>
          <legend>{copy.when}</legend>
          <div className={styles.options}>
            {copy.whenOptions.map((option) => (
              <label key={option} className={styles.option}>
                <input type="radio" name="when" value={option} />
                <span>{option}</span>
              </label>
            ))}
          </div>
        </fieldset>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className={styles.honeypot} aria-hidden />
      <button type="submit" className={styles.submit} disabled={status === "sending"}>
        {status === "sending" ? copy.sending : copy.submit}
      </button>
      {status === "error" ? (
        <p className={styles.error} role="alert">
          <a href={mailto} style={{ color: "inherit" }}>
            {copy.error}
          </a>
        </p>
      ) : null}
      <p className={styles.privacy}>{copy.privacy}</p>
    </form>
  );
}
