"use client";

import { ArrowRight, Check } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useState } from "react";
import { z } from "zod";

const contactSchema = z.object({
  firstName: z.string().trim().min(2, "Escribe tu nombre."),
  lastName: z.string().trim().min(2, "Escribe tu apellido."),
  email: z.string().trim().email("Usa un email válido."),
  phone: z
    .string()
    .trim()
    .min(1, "Escribe tu teléfono.")
    .refine((value) => value.replace(/\D/g, "").length >= 8, "Usa un teléfono con al menos 8 dígitos."),
  message: z.string().trim().min(12, "Cuéntanos un poco más para poder responder bien."),
  terms: z.literal(true, {
    errorMap: () => ({ message: "Acepta los términos y condiciones para continuar." })
  })
});

type ContactFormData = z.infer<typeof contactSchema>;
type ContactFormValues = Omit<ContactFormData, "terms"> & { terms: boolean };
type FieldName = keyof ContactFormValues;
type FieldErrors = Partial<Record<FieldName, string>>;

const initialForm: ContactFormValues = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  message: "",
  terms: false
};

export function ContactForm() {
  const [form, setForm] = useState<ContactFormValues>(initialForm);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");

  function updateField<K extends FieldName>(field: K, value: ContactFormValues[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
    if (status === "error") setStatus("idle");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const parsed = contactSchema.safeParse(form);
    if (!parsed.success) {
      const nextErrors: FieldErrors = {};
      parsed.error.issues.forEach((issue) => {
        const field = issue.path[0] as FieldName | undefined;
        if (field && !nextErrors[field]) nextErrors[field] = issue.message;
      });
      setErrors(nextErrors);
      return;
    }

    setStatus("submitting");
    try {
      const response = await fetch("/api/contacto", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data)
      });

      if (!response.ok) throw new Error("Contact request failed");

      setStatus("success");
      setForm(initialForm);
      setErrors({});
    } catch {
      setStatus("error");
    }
  }

  const submitting = status === "submitting";

  return (
    <form className="contact-form contact-form--full solid-panel" noValidate onSubmit={handleSubmit}>
      <div className="contact-form__grid">
        <Field label="Nombre" name="firstName" error={errors.firstName}>
          <input
            aria-invalid={Boolean(errors.firstName)}
            aria-describedby={errors.firstName ? "contact-firstName-error" : undefined}
            autoComplete="given-name"
            id="contact-firstName"
            name="firstName"
            onChange={(event) => updateField("firstName", event.target.value)}
            placeholder="Tu nombre"
            type="text"
            value={form.firstName}
          />
        </Field>

        <Field label="Apellido" name="lastName" error={errors.lastName}>
          <input
            aria-invalid={Boolean(errors.lastName)}
            aria-describedby={errors.lastName ? "contact-lastName-error" : undefined}
            autoComplete="family-name"
            id="contact-lastName"
            name="lastName"
            onChange={(event) => updateField("lastName", event.target.value)}
            placeholder="Tu apellido"
            type="text"
            value={form.lastName}
          />
        </Field>
      </div>

      <div className="contact-form__grid">
        <Field label="Email" name="email" error={errors.email}>
          <input
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "contact-email-error" : undefined}
            autoComplete="email"
            id="contact-email"
            inputMode="email"
            name="email"
            onChange={(event) => updateField("email", event.target.value)}
            placeholder="tu@empresa.com"
            type="email"
            value={form.email}
          />
        </Field>

        <Field label="Teléfono" name="phone" error={errors.phone}>
          <input
            aria-invalid={Boolean(errors.phone)}
            aria-describedby={errors.phone ? "contact-phone-error" : undefined}
            autoComplete="tel"
            id="contact-phone"
            inputMode="tel"
            name="phone"
            onChange={(event) => updateField("phone", event.target.value)}
            placeholder="+52 55 0000 0000"
            type="tel"
            value={form.phone}
          />
        </Field>
      </div>

      <Field label="Mensaje" name="message" error={errors.message}>
        <textarea
          aria-invalid={Boolean(errors.message)}
          aria-describedby={errors.message ? "contact-message-error" : undefined}
          id="contact-message"
          name="message"
          onChange={(event) => updateField("message", event.target.value)}
          placeholder="Cuéntanos qué decisión quieres tomar, qué mercado estás mirando y qué señal ya tienes."
          rows={6}
          value={form.message}
        />
      </Field>

      <label className={`contact-form__terms ${errors.terms ? "is-invalid" : ""}`} htmlFor="contact-terms">
        <input
          aria-invalid={Boolean(errors.terms)}
          aria-describedby={errors.terms ? "contact-terms-error" : undefined}
          checked={form.terms}
          id="contact-terms"
          name="terms"
          onChange={(event) => updateField("terms", event.target.checked)}
          type="checkbox"
        />
        <span>Acepto términos y condiciones y autorizo que Noisia me contacte sobre esta solicitud.</span>
      </label>
      {errors.terms ? (
        <span className="contact-form__error" id="contact-terms-error" role="alert">
          {errors.terms}
        </span>
      ) : null}

      <div className="contact-form__footer">
        <button className="button button--primary" disabled={submitting} type="submit">
          {submitting ? "Enviando..." : "Mandar mensaje"}
          {!submitting ? <ArrowRight size={17} strokeWidth={1.8} /> : null}
        </button>
        {status === "success" ? (
          <p className="contact-form__status contact-form__status--success" role="status">
            <Check size={15} strokeWidth={2.2} />
            Mensaje recibido. Te escribiremos pronto.
          </p>
        ) : null}
        {status === "error" ? (
          <p className="contact-form__status contact-form__status--error" role="alert">
            No pudimos enviar el mensaje. Escríbenos a hola@noisia.ai.
          </p>
        ) : null}
      </div>
    </form>
  );
}

function Field({
  children,
  error,
  label,
  name
}: {
  children: ReactNode;
  error?: string;
  label: string;
  name: FieldName;
}) {
  return (
    <label className="contact-form__field" htmlFor={`contact-${name}`}>
      <span>{label}</span>
      {children}
      {error ? (
        <span className="contact-form__error" id={`contact-${name}-error`} role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
