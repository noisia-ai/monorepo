import Link from "next/link";

import { Icon } from "@/components/ui/Icon";
import { displayRole } from "@/lib/auth/roles";

type SessionBadgeUser = {
  email: string;
  fullName: string | null;
  primaryRole: string;
};

type SessionBadgeProps = {
  user: SessionBadgeUser;
  compact?: boolean;
};

export function SessionBadge({ user, compact = false }: SessionBadgeProps) {
  const label = user.fullName || user.email;

  return (
    <div className={`session-badge${compact ? " session-badge--compact" : ""}`}>
      <div className="session-badge-avatar" aria-hidden="true">
        {initials(label)}
      </div>
      <div className="session-badge-main">
        <span className="session-badge-name">{label}</span>
        <span className="session-badge-role">
          <Icon name="tag" size={11} />
          {displayRole(user.primaryRole)}
        </span>
      </div>
      <Link className="session-badge-logout" href="/api/auth/logout">
        Salir
      </Link>
    </div>
  );
}

function initials(value: string) {
  const parts = value
    .replace(/@.*/, "")
    .split(/[.\s_-]+/)
    .filter(Boolean);

  return (parts[0]?.[0] ?? "N").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}
