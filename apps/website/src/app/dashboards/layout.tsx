import type { Metadata } from "next";
import "./dashboards.css";

export const metadata: Metadata = {
  title: {
    default: "Dashboards | Noisia",
    template: "%s · Dashboards | Noisia",
  },
  description: "Workspace operativo Noisia.",
  robots: { index: false, follow: false },
};

export default function DashboardsLayout({ children }: { children: React.ReactNode }) {
  return <div className="db-root">{children}</div>;
}
