"use client";

import { useState } from "react";
import { Check } from "iconoir-react";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { LOGO_RATIO } from "@/components/brand/Logo";
import type { TeamKey, TeamOutput } from "@/content/pages/situations";
import styles from "./situation.module.css";

/** One segmented control of teams; each shows its question and a card of what it receives. */
export function TeamOutputs({ teams, names, labels }: { teams: TeamOutput[]; names: Record<TeamKey, string>; labels: { asks: string; gets: string; title: string } }) {
  const [active, setActive] = useState(0);
  return (
    <div className={styles.teams}>
      <div className={styles.teamsControl}>
        <SegmentedControl options={teams.map((t) => ({ key: t.team, label: names[t.team] }))} active={active} onChange={setActive} label={labels.title} />
      </div>
      <div className={styles.stack}>
        {teams.map((team, i) => (
          <div key={team.team} className={`${styles.layer} ${styles.teamPanel}`} data-active={i === active} aria-hidden={i !== active}>
            <div className={styles.teamAsk}>
              <p className={styles.teamLabel}>{labels.asks}</p>
              <p className={styles.teamQuestion}>{team.question}</p>
            </div>
            <div className={styles.teamCard}>
              <p className={styles.teamLabel}>{labels.gets}</p>
              <p className={styles.teamOutput}>{team.output}</p>
              <ul className={styles.teamItems}>
                {team.items.map((item) => (
                  <li key={item}>
                    <Check aria-hidden /> {item}
                  </li>
                ))}
              </ul>
              {/* eslint-disable-next-line @next/next/no-img-element -- small static logo */}
              <img src="/brand/noisia.svg" alt="" width={84} height={Math.round(84 / LOGO_RATIO)} className={styles.teamLogo} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
