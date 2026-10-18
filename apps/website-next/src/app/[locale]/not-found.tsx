import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ minHeight: "70svh", display: "grid", placeItems: "center", padding: "48px 16px", textAlign: "center" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center" }}>
        <p style={{ fontSize: "4rem", fontWeight: 500, color: "var(--teal)" }}>404</p>
        <p>Esta página no existe. This page doesn&apos;t exist.</p>
        <Link href="/" style={{ color: "var(--teal)" }}>
          noisia.ai
        </Link>
      </div>
    </main>
  );
}
