/* eslint-disable @next/next/no-img-element -- Remote game and player artwork uses the browser cache directly. */
"use client";

import { useEffect, useState } from "react";
import { desktopAvailable, getDesktopMatch, getDesktopStatus, getRecommendations, onDesktopMatch, onDesktopStatus, onRecommendations, type DesktopAdvice, type DesktopMatch, type DesktopStatus } from "../desktop";
import { fetchStatlockerProfiles, type StatlockerProfile } from "../lib/data/statlocker";
import { playerRank } from "../lib/player-rank";
import { scoreThreats } from "../lib/build-engine/threat-score";

type Hero = { id: number; name: string; images?: { icon_image_small_webp?: string } };

export default function CompactView() {
  const [status, setStatus] = useState<DesktopStatus | null>(null);
  const [match, setMatch] = useState<DesktopMatch | null>(null);
  const [advice, setAdvice] = useState<DesktopAdvice | null>(null);
  const [profiles, setProfiles] = useState<Record<number, StatlockerProfile>>({});
  const [heroes, setHeroes] = useState<Map<number, Hero>>(new Map());
  const rosterKey = match?.players.map((entry) => entry.account_id).filter((id): id is number => id != null).sort((a, b) => a - b).filter((id, index, ids) => index === 0 || id !== ids[index - 1]).join(",") ?? "";
  useEffect(() => {
    let active = true;
    void fetch("https://api.deadlock-api.com/v1/assets/heroes?only_active=true").then((response) => response.json()).then((rows: Hero[]) => { if (active && Array.isArray(rows)) setHeroes(new Map(rows.map((hero) => [hero.id, hero]))); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!rosterKey) return;
    let active = true;
    void fetchStatlockerProfiles(rosterKey.split(",").map(Number)).then((result) => { if (active) setProfiles((current) => ({ ...current, ...Object.fromEntries(result.profiles.map((profile) => [profile.accountId, profile])) })); });
    return () => { active = false; };
  }, [rosterKey]);
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
  const enemies = player?.team == null ? [] : (match?.players.filter((entry) => entry.team != null && entry.team !== player.team && entry.hero_id != null) ?? []);
  const threats = scoreThreats(enemies.map((entry) => ({ heroId: entry.hero_id!, netWorth: entry.net_worth, kills: entry.kills, deaths: entry.deaths, assists: entry.assists })), match?.game_time_s ?? null);
  const primaryThreat = threats[0] ? enemies.find((entry) => entry.hero_id === threats[0].heroId) : undefined;
  const identity = player?.account_id == null ? undefined : profiles[player.account_id];
  const heroName = player?.hero_id == null ? "Waiting for hero" : heroes.get(player.hero_id)?.name ?? `Hero #${player.hero_id}`;
  const rank = playerRank(identity?.estimatedRankNumber);
  return <main className="compact-view">
    <header><strong><i>CL</i> COUNTERLOCK</strong><span>{status?.in_game ? "● LIVE MATCH" : status?.game_running ? "● DEADLOCK" : "○ IDLE"}</span></header>
    <div className="compact-body">
      <section className="compact-identity"><span className="compact-avatar">{identity?.avatarUrl ? <img src={identity.avatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}</span><div><small>YOU · {identity?.name || (player?.account_id == null ? "Player" : "Loading profile")}</small><strong>{heroName}</strong><span className="compact-rank" title={rank ? "Estimated rank · Statlocker" : "Rank unavailable"}>{rank && <img src={rank.badgeUrl} alt="" />}{rank?.label ?? "Rank —"}</span></div><b>{match?.game_time_s == null ? "—" : `${Math.floor(match.game_time_s / 60)}:${String(match.game_time_s % 60).padStart(2, "0")}`}</b></section>
      <section className="compact-next"><header><small>NEXT BUY</small><span>◈ {player?.unspent_souls?.toLocaleString() ?? "—"} SOULS</span></header><strong>{advice?.recommended?.name ?? "Awaiting verified recommendation"}</strong>{advice?.recommended && <><span>{advice.recommended.cost.toLocaleString()} · {advice.recommended.affordable == null ? "Affordability unknown" : advice.recommended.affordable ? "BUY NOW" : "SAVE SOULS"}</span><p>{advice.recommended.reason}</p></>}</section>
      <section className="compact-threat"><small>TOP THREAT</small>{primaryThreat ? <><div><span>{profiles[primaryThreat.account_id ?? -1]?.avatarUrl ? <img src={profiles[primaryThreat.account_id ?? -1].avatarUrl!} alt="" /> : null}</span><strong>{profiles[primaryThreat.account_id ?? -1]?.name || "Player"}<small>{heroes.get(primaryThreat.hero_id!)?.name ?? `Hero #${primaryThreat.hero_id}`} · {playerRank(profiles[primaryThreat.account_id ?? -1]?.estimatedRankNumber)?.label ?? "Rank —"}</small></strong><b>{(threats[0].weight * 100).toFixed(0)}%</b></div><p>{primaryThreat.net_worth?.toLocaleString() ?? "—"} NW · {primaryThreat.kills ?? "—"}/{primaryThreat.deaths ?? "—"}/{primaryThreat.assists ?? "—"} KDA</p></> : <p>Enemy roster unavailable</p>}</section>
      <footer><span>{match?.source ?? status?.provider ?? "No telemetry"}</span><b>{player?.net_worth?.toLocaleString() ?? "—"} NW</b></footer>
    </div>
  </main>;
}
