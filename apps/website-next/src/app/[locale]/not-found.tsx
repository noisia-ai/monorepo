import { useLocale } from "next-intl";
import { Link } from "@/i18n/navigation";

const copy = {
  es: { title: "Esta página no existe.", back: "Volver al inicio" },
  en: { title: "This page doesn't exist.", back: "Back to home" }
};

export default function NotFound() {
  const t = copy[useLocale() === "en" ? "en" : "es"];
  return (
    <main style={{ minHeight: "70svh", display: "grid", placeItems: "center", padding: "48px 16px", textAlign: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
        <p style={{ fontSize: "4rem", fontWeight: 500, color: "var(--teal)" }}>404</p>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 400 }}>{t.title}</h1>
        <Link href="/" style={{ color: "var(--teal-text)" }}>
          {t.back}
        </Link>
      </div>
    </main>
  );
}
