/* eslint-disable @next/next/no-img-element -- Remote game and player artwork uses the browser cache directly. */
import type { DesktopAdvice, DesktopMatch, DesktopPlayer, DesktopStatus } from "./desktop";
import type { StatlockerProfile } from "./lib/data/statlocker";
import { playerRank } from "./lib/player-rank";
import { scoreThreats } from "./lib/build-engine/threat-score";

type LiveHero = { id: number; name: string; images?: { icon_image_small_webp?: string } };

function playerRow(player: DesktopPlayer, heroes: Map<number, LiveHero>, profiles: Record<number, StatlockerProfile>, ownAccountId: number | null, index: number, threat?: { rank: number; weight: number }) {
  const hero = player.hero_id == null ? undefined : heroes.get(player.hero_id);
  const own = player.account_id != null && player.account_id === ownAccountId;
  const profile = player.account_id == null ? undefined : profiles[player.account_id];
  const rank = playerRank(profile?.estimatedRankNumber);
  const threatLabel = threat ? threat.rank === 1 ? "PRIMARY" : threat.rank <= 3 ? "HIGH" : threat.rank <= 5 ? "MEDIUM" : "LOW" : null;
  return <details className={`desktop-player-details${own ? " is-you" : ""}${threat ? " is-enemy" : ""}`} key={`${player.account_id ?? "bot"}-${player.hero_id ?? index}-${index}`}><summary className={`desktop-player-row${own ? " is-you" : ""}${threat ? " is-enemy" : ""}`}>
    <span className="desktop-player-portrait">{hero?.images?.icon_image_small_webp && <img className="desktop-hero-fallback" src={hero.images.icon_image_small_webp} alt="" />}{profile?.avatarUrl && <img className="desktop-player-avatar" src={profile.avatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</span>
    <span className="desktop-player-name"><strong>{player.account_id == null ? "BOT" : profile?.name || "Player"}</strong><small>{hero?.name ?? (player.hero_id == null ? "Unknown hero" : `Hero #${player.hero_id}`)}{own ? " · YOU" : ""}</small></span>
    <span className="desktop-player-rank" title={rank ? "Statlocker estimate · estimated rank" : "Statlocker estimated rank unavailable"}>{rank ? <><img src={rank.badgeUrl} alt="" /><b>{rank.label}</b></> : <small>RANK —</small>}</span>
    <span className="desktop-player-stat"><small>NET WORTH</small><b>{player.net_worth?.toLocaleString() ?? "—"}</b></span>
    <span className="desktop-player-stat"><small>K / D / A</small><b>{player.kills ?? "—"} / {player.deaths ?? "—"} / {player.assists ?? "—"}</b></span>
    {threat && <span className={`desktop-threat-chip threat-${threatLabel?.toLowerCase()}`} title={`Threat weight ${(threat.weight * 100).toFixed(0)}%`}><i />{threatLabel}</span>}
  </summary><div className="desktop-player-profile"><div><small>PROFILE</small><strong>{profile?.name || "Player"}</strong><span>{rank ? `Estimated rank · Statlocker · ${rank.label}` : "Rank unavailable"}</span></div><div><small>LIVE MATCH</small><strong>{player.kills ?? "—"} / {player.deaths ?? "—"} / {player.assists ?? "—"} KDA</strong><span>{player.net_worth?.toLocaleString() ?? "—"} net worth · {player.unspent_souls?.toLocaleString() ?? "—"} souls · {player.souls_per_minute?.toLocaleString() ?? "—"} SPM</span></div>{profile && <div><small>PLAYER DATA</small><strong>{profile.ppScore == null ? "PP —" : `PP ${profile.ppScore}`}</strong><span>{profile.region || "Region unavailable"}</span></div>}{threat && <p>{threat.rank === 1 ? "Primary threat" : `${threatLabel} threat`} · relative live net worth and K/D/A · threat weight ${(threat.weight * 100).toFixed(0)}%</p>}</div></details>;
}

export function DesktopLivePanel({ status, match, heroes, profiles, advice, recommendations = [], onOpenBuild }: {
  status: DesktopStatus;
  match: DesktopMatch | null;
  heroes: Map<number, LiveHero>;
  profiles: Record<number, StatlockerProfile>;
  advice: DesktopAdvice | null;
  recommendations?: Array<{ item: { id: number }; threatTargets?: number[] }>;
  onOpenBuild: () => void;
}) {
  const own = match?.players.find((player) => player.account_id != null && player.account_id === match.account_id);
  const allies = match?.players.filter((player) => own?.team != null && player.team === own.team) ?? [];
  const enemies = match?.players.filter((player) => own?.team != null && player.team != null && player.team !== own.team) ?? [];
  const threatScores = scoreThreats(enemies.flatMap((player) => player.hero_id == null ? [] : [{ heroId: player.hero_id, netWorth: player.net_worth, soulsPerMinute: player.souls_per_minute, kills: player.kills, deaths: player.deaths, assists: player.assists, statlockerPP: player.account_id == null ? null : profiles[player.account_id]?.ppScore }]), match?.game_time_s ?? null);
  const targetHeroId = advice?.recommended ? recommendations.find((entry) => entry.item.id === advice.recommended?.item_id)?.threatTargets?.[0] : undefined;
  const target = targetHeroId == null ? undefined : enemies.find((player) => player.hero_id === targetHeroId);
  const targetProfile = target?.account_id == null ? undefined : profiles[target.account_id];
  const live = status.in_game && !!match;
  return <section className="desktop-live-page" aria-label="Current match">
    <div className="desktop-live-heading"><div><small>COUNTERLOCK / CURRENT MATCH</small><h1>{live ? "Live match" : status.game_running ? "Deadlock is running" : "Ready for match"}</h1><p>{live ? "Player values read from your running Deadlock client." : status.game_running ? "Waiting for a local match and verified game memory." : "Launch Deadlock to start local match detection."}</p></div><span className={`desktop-live-indicator${live ? " active" : ""}`}>{live ? "● LIVE MEMORY" : "○ WAITING"}</span></div>
    <div className="desktop-live-overview"><div><small>{own?.account_id == null ? "YOUR HERO" : "YOU"}</small><strong>{own?.hero_id != null ? heroes.get(own.hero_id)?.name ?? `Hero #${own.hero_id}` : "—"}</strong><span>{own?.kills ?? "—"} / {own?.deaths ?? "—"} / {own?.assists ?? "—"} KDA</span></div><div><small>SOULS AVAILABLE</small><strong>{own?.unspent_souls?.toLocaleString() ?? "—"}</strong></div><div><small>NET WORTH</small><strong>{own?.net_worth?.toLocaleString() ?? "—"}</strong></div><div className="desktop-overview-time"><small>MATCH TIME</small><strong>{live && match.game_time_s != null ? `${Math.floor(match.game_time_s / 60)}:${String(match.game_time_s % 60).padStart(2, "0")}` : "—"}</strong></div></div>
    <div className="desktop-live-grid">
      <article className="desktop-live-card desktop-match-card"><header><h2>Match roster</h2><span>{match?.players.length ?? 0} PLAYERS</span></header>
        {live ? <><div className="desktop-team-heading">YOUR TEAM <span>{allies.length} PLAYERS</span></div><div className="desktop-player-list">{allies.map((player, index) => playerRow(player, heroes, profiles, match.account_id, index))}</div>
          <div className="desktop-team-heading enemy">ENEMY TEAM <span>{enemies.length} PLAYERS · RANKED BY LIVE THREAT</span></div><div className="desktop-player-list">{threatScores.map((threat, index) => { const player = enemies.find((entry) => entry.hero_id === threat.heroId)!; return playerRow(player, heroes, profiles, match.account_id, index, { rank: index + 1, weight: threat.weight }); })}</div></> : <div className="desktop-match-empty">{status.game_running ? "No live roster yet. Stay in the match while the local reader checks both teams." : "No match running."}</div>}
      </article>
      <aside className="desktop-threat-panel"><header><small>CURRENT THREATS</small><span>{threatScores.length ? `${threatScores.length} ENEMIES` : "AWAITING ROSTER"}</span></header>{threatScores.length ? threatScores.slice(0, 3).map((threat, index) => { const player = enemies.find((entry) => entry.hero_id === threat.heroId)!; const profile = player.account_id == null ? undefined : profiles[player.account_id]; const hero = heroes.get(threat.heroId); return <div className="desktop-threat-feature" key={`${threat.heroId}-${index}`}><b>0{index + 1}</b><span className="desktop-threat-avatar">{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : hero?.images?.icon_image_small_webp && <img src={hero.images.icon_image_small_webp} alt="" />}</span><div><strong>{profile?.name || "Player"}</strong><small>{hero?.name ?? `Hero #${threat.heroId}`} · {playerRank(profile?.estimatedRankNumber)?.label ?? "Rank —"}</small></div><em>{index === 0 ? "PRIMARY" : index === 1 ? "HIGH" : "HIGH"}<small>{(threat.weight * 100).toFixed(0)}% weight</small></em></div>}) : <p>Threat scores appear when enemy live stats are available.</p>}</aside>
    </div>
    <article className="desktop-live-advice"><div className="desktop-next-buy-icon">↗</div><div className="desktop-next-buy-copy"><small>NEXT BUY</small><h2>{advice?.recommended?.name ?? "Awaiting verified recommendation"}</h2>{advice?.recommended ? <><p>{advice.recommended.reason}</p><span>{target ? `VS ${targetProfile?.name || "Player"} · ${heroes.get(targetHeroId!)?.name ?? "Hero"}` : "VS ENEMY TEAM"} · ◈ {advice.recommended.cost.toLocaleString()}</span></> : <p>Current hero and enemy roster are needed for an item recommendation.</p>}</div><strong>{advice?.recommended?.affordable == null ? "SOULS UNKNOWN" : advice.recommended.affordable ? "BUY NOW" : "SAVE SOULS"}</strong><button type="button" onClick={onOpenBuild}>BUILD LAB →</button></article>
  </section>;
}
