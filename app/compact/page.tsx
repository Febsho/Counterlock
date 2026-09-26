"use client";

import { useEffect, useState } from "react";
import { desktopAvailable, getDesktopMatch, getDesktopStatus, getRecommendations, onDesktopMatch, onDesktopStatus, onRecommendations, type DesktopAdvice, type DesktopMatch, type DesktopStatus } from "../desktop";

export default function CompactView() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [match, setMatch] = useState<DesktopMatch | null>(null);
  const [advice, setAdvice] = useState<DesktopAdvice | null>(null);
  useEffect(() => {
    if (!desktopAvailable()) return;
    let alive = true;
    const unlisten: Array<() => void> = [];
    void Promise.all([getDesktopStatus(), getDesktopMatch(), getRecommendations()]).then(([nextStatus, nextMatch, nextAdvice]) => {
      if (alive) { setStatus(nextStatus); setMatch(nextMatch); setAdvice(nextAdvice); }
    });
    void onDesktopStatus((next) => { if (alive) setStatus(next); }).then((stop) => { if (alive) unlisten.push(stop); else stop(); });
    void onDesktopMatch((next) => { if (alive) setMatch(next); }).then((stop) => { if (alive) unlisten.push(stop); else stop(); });
    void onRecommendations((next) => { if (alive) setAdvice(next); }).then((stop) => { if (alive) unlisten.push(stop); else stop(); });
    return () => { alive = false; unlisten.forEach((stop) => stop()); };
  }, []);
  const player = match?.players.find((entry) => entry.account_id != null && entry.account_id === match.account_id);
  return <main className="compact-view">
    <header><strong>COUNTERLOCK</strong><span>{status?.game_running ? "● LIVE" : "○ IDLE"}</span></header>
    <div className="compact-body">
      <small>{status?.in_game ? `MATCH ${status.match_id ?? "UNKNOWN"}` : "NO LIVE MATCH"}</small>
      <strong>{player?.hero_id != null ? `Hero #${player.hero_id}` : "Waiting for hero"}</strong>
      <p>{player?.net_worth != null ? `${player.net_worth.toLocaleString()} total net worth` : "Net worth unavailable from current source"}</p>
      <div className="compact-next"><small>NEXT BUY</small><strong>{advice?.recommended?.name ?? "Awaiting verified recommendation"}</strong>
        {advice?.recommended && <><span>{advice.recommended.cost.toLocaleString()} souls · {advice.recommended.affordable == null ? "Affordability unknown" : advice.recommended.affordable ? "Affordable" : "Save souls"}</span><p>{advice.recommended.reason}</p></>}</div>
      <small>{match?.source ?? status?.provider ?? "No telemetry"}</small>
    </div>
  </main>;
}
