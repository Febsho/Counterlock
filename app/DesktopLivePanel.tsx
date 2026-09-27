/* eslint-disable @next/next/no-img-element -- Remote game and player artwork uses the browser cache directly. */
import { useEffect, useState } from "react";
import type { DesktopAdvice, DesktopMatch, DesktopPlayer, DesktopStatus } from "./desktop";
import type { StatlockerProfile } from "./lib/data/statlocker";
import { playerRank } from "./lib/player-rank";
import { scoreThreats } from "./lib/build-engine/threat-score";
import { enemyTeamProfile } from "./lib/match-intelligence/team-profile";
import { inferLaneIntent, laneState } from "./lib/match-intelligence/lane";
import { cachedJson } from "./lib/data/cache";
import type { HeroAbilityEvidence } from "./lib/build-engine/hero-threats";

type LiveHero = { id: number; name: string; images?: { icon_image_small_webp?: string } };
type LiveItem = { id: number; name: string; class_name?: string; shop_image_webp?: string };
type LiveAbilityAsset = HeroAbilityEvidence;
const API = "https://api.deadlock-api.com/v1";

function classTokenHash(value: string) {
  const bytes = new TextEncoder().encode(value);
  let hash = (0x31415926 ^ bytes.length) >>> 0;
  let offset = 0;
  while (offset + 4 <= bytes.length) {
    let key = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true);
    key = Math.imul(key, 0x5bd1e995) >>> 0;
    key = (key ^ (key >>> 24)) >>> 0;
    key = Math.imul(key, 0x5bd1e995) >>> 0;
    hash = (Math.imul(hash, 0x5bd1e995) ^ key) >>> 0;
    offset += 4;
  }
  const tail = bytes.subarray(offset);
  if (tail.length >= 3) hash ^= tail[2] << 16;
  if (tail.length >= 2) hash ^= tail[1] << 8;
  if (tail.length >= 1) { hash ^= tail[0]; hash = Math.imul(hash, 0x5bd1e995) >>> 0; }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995) >>> 0;
  return (hash ^ (hash >>> 15)) >>> 0;
}

function playerRow(player: DesktopPlayer, heroes: Map<number, LiveHero>, profiles: Record<number, StatlockerProfile>, itemById: Map<number, LiveItem>, itemByToken: Map<number, LiveItem>, ownAccountId: number | null, index: number, threat?: { rank: number; weight: number }) {
  const hero = player.hero_id == null ? undefined : heroes.get(player.hero_id);
  const own = player.account_id != null && player.account_id === ownAccountId;
  const profile = player.account_id == null ? undefined : profiles[player.account_id];
  const rank = playerRank(profile?.estimatedRankNumber);
  const threatLabel = threat ? threat.rank === 1 ? "PRIMARY" : threat.rank <= 3 ? "HIGH" : threat.rank <= 5 ? "MEDIUM" : "LOW" : null;
  const visibleItems = [...new Map([...(player.items ?? []).flatMap((id) => { const item = itemById.get(id); return item ? [[item.id, item] as const] : []; }), ...(player.owned_item_class_tokens ?? []).flatMap((token) => { const item = itemByToken.get(token); return item ? [[item.id, item] as const] : []; })]).values()];
  return <details className={`desktop-player-details${own ? " is-you" : ""}${threat ? " is-enemy" : ""}`} key={`${player.account_id ?? "bot"}-${player.hero_id ?? index}-${index}`}><summary className={`desktop-player-row${own ? " is-you" : ""}${threat ? " is-enemy" : ""}`}>
    <span className="desktop-player-portrait">{hero?.images?.icon_image_small_webp && <img className="desktop-hero-fallback" src={hero.images.icon_image_small_webp} alt="" />}{profile?.avatarUrl && <img className="desktop-player-avatar" src={profile.avatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} />}</span>
    <span className="desktop-player-name"><strong>{player.account_id == null ? "BOT" : profile?.name || `Player ${player.account_id}`}</strong><small>{hero?.name ?? (player.hero_id == null ? "Unknown hero" : `Hero #${player.hero_id}`)}{own ? " · YOU" : ""}</small>{visibleItems.length > 0 && <span className="desktop-player-items">{visibleItems.map((item) => <span key={item.id} title={item.name}>{item.shop_image_webp ? <img src={item.shop_image_webp} alt={item.name} /> : item.name}</span>)}</span>}</span>
    <span className="desktop-player-rank" title={rank ? "Statlocker estimate · estimated rank" : "Statlocker estimated rank unavailable"}>{rank ? <><img src={rank.badgeUrl} alt="" /><b>{rank.label}</b></> : <small>RANK —</small>}</span>
    <span className="desktop-player-stat"><small>NET WORTH</small><b>{player.net_worth?.toLocaleString() ?? "—"}</b></span>
    <span className="desktop-player-stat"><small>K / D / A</small><b>{player.kills ?? "—"} / {player.deaths ?? "—"} / {player.assists ?? "—"}</b></span>
    {threat && <span className={`desktop-threat-chip threat-${threatLabel?.toLowerCase()}`} title={`Threat weight ${(threat.weight * 100).toFixed(0)}%`}><i />{threatLabel}</span>}
  </summary><div className="desktop-player-profile"><div><small>PROFILE</small><strong>{profile?.name || (player.account_id == null ? "BOT" : `Player ${player.account_id}`)}</strong><span>{rank ? `Estimated rank · Statlocker · ${rank.label}` : "Rank unavailable"}</span></div><div><small>LIVE MATCH</small><strong>{player.kills ?? "—"} / {player.deaths ?? "—"} / {player.assists ?? "—"} KDA</strong><span>{player.net_worth?.toLocaleString() ?? "—"} net worth · {player.unspent_souls?.toLocaleString() ?? "—"} souls · {player.souls_per_minute?.toLocaleString() ?? "—"} SPM</span></div>{profile && <div><small>PLAYER DATA</small><strong>{profile.ppScore == null ? "PP —" : `PP ${profile.ppScore}`}</strong><span>{profile.region || "Region unavailable"}</span></div>}<div className="desktop-player-inventory"><small>CURRENT ITEMS</small><span>{player.items == null && player.owned_item_class_tokens == null ? "Inventory unavailable from this data source" : [...new Map([...(player.items ?? []).flatMap((id) => { const item = itemById.get(id); return item ? [[item.id, item] as const] : []; }), ...(player.owned_item_class_tokens ?? []).flatMap((token) => { const item = itemByToken.get(token); return item ? [[item.id, item] as const] : []; })]).values()].map((item) => <span className="desktop-live-item" key={item.id} title={item.name}>{item.shop_image_webp ? <img src={item.shop_image_webp} alt="" /> : item.name}</span>)}</span></div>{threat && <p>{threat.rank === 1 ? "Primary threat" : `${threatLabel} threat`} · relative live net worth and K/D/A · threat weight ${(threat.weight * 100).toFixed(0)}%</p>}</div></details>;
}

export function DesktopLivePanel({ status, match, heroes, profiles, items = [], advice, recommendations = [], laneOpponentId, laneName, onOpenBuild }: {
  status: DesktopStatus;
  match: DesktopMatch | null;
  heroes: Map<number, LiveHero>;
  profiles: Record<number, StatlockerProfile>;
  items?: LiveItem[];
  advice: DesktopAdvice | null;
  recommendations?: Array<{ item: { id: number }; threatTargets?: number[]; coveredEnemyIds?: number[] }>;
  laneOpponentId?: number;
  laneName?: string;
  onOpenBuild: () => void;
}) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const itemByToken = new Map(items.filter((item) => item.class_name).map((item) => [classTokenHash(item.class_name!), item]));
  const own = match?.players.find((player) => player.account_id != null && player.account_id === match.account_id);
  const laneEnemy = laneOpponentId == null ? undefined : match?.players.find(player => player.hero_id===laneOpponentId);
  const lanePosition = laneState(own?.net_worth??null,[laneEnemy?.net_worth??null]);
  const laneIntent = inferLaneIntent(lanePosition,own?.deaths??0);
  const allies = match?.players.filter((player) => own?.team != null && player.team === own.team) ?? [];
  const enemies = match?.players.filter((player) => own?.team != null && player.team != null && player.team !== own.team) ?? [];
  const rosterHeroIds = [...new Set([...allies, ...enemies].flatMap((player) => player.hero_id == null ? [] : [player.hero_id]))];
  const rosterAbilityKey = rosterHeroIds.join(",");
  const [mechanicEvidenceState, setMechanicEvidenceState] = useState<{ key: string; evidence: Map<number, HeroAbilityEvidence[]> }>({ key: "", evidence: new Map() });
  const mechanicEvidence = mechanicEvidenceState.key === rosterAbilityKey ? mechanicEvidenceState.evidence : new Map<number, HeroAbilityEvidence[]>();
  useEffect(() => {
    let active = true;
    const ids = rosterAbilityKey ? rosterAbilityKey.split(",").map(Number) : [];
    if (!ids.length) return () => { active = false; };
    void Promise.allSettled(ids.map((id) => cachedJson<LiveAbilityAsset[]>(`${API}/assets/items/by-hero-id/${id}?language=english`, 24 * 60 * 60 * 1000))).then((results) => {
      if (!active) return;
      const next = new Map<number, HeroAbilityEvidence[]>();
      results.forEach((result, index) => { if (result.status === "fulfilled") next.set(ids[index], result.value); });
      setMechanicEvidenceState({ key: rosterAbilityKey, evidence: next });
    });
    return () => { active = false; };
  }, [rosterAbilityKey]);
  const threatScores = scoreThreats(enemies.flatMap((player) => player.hero_id == null ? [] : [{ heroId: player.hero_id, netWorth: player.net_worth, soulsPerMinute: player.souls_per_minute, kills: player.kills, deaths: player.deaths, assists: player.assists, statlockerPP: player.account_id == null ? null : profiles[player.account_id]?.ppScore }]), match?.game_time_s ?? null);
  const targetHeroId = advice?.recommended ? recommendations.find((entry) => entry.item.id === advice.recommended?.item_id)?.threatTargets?.[0] : undefined;
  const target = targetHeroId == null ? undefined : enemies.find((player) => player.hero_id === targetHeroId);
  const targetProfile = target?.account_id == null ? undefined : profiles[target.account_id];
  const coveredIds = advice?.recommended ? recommendations.find(entry=>entry.item.id===advice.recommended?.item_id)?.coveredEnemyIds??[] : [];
  const coveredNames = coveredIds.map(id=>heroes.get(id)?.name??`Hero #${id}`);
  const teamProfile = enemyTeamProfile(enemies.flatMap(player => player.hero_id == null ? [] : [{heroId:player.hero_id,netWorth:player.net_worth,soulsPerMinute:player.souls_per_minute,kills:player.kills,deaths:player.deaths,assists:player.assists,statlockerPP:player.account_id==null?null:profiles[player.account_id]?.ppScore}]), mechanicEvidence);
  const alliedProfile = enemyTeamProfile(allies.flatMap(player => player.hero_id == null ? [] : [{heroId:player.hero_id,netWorth:player.net_worth,soulsPerMinute:player.souls_per_minute,kills:player.kills,deaths:player.deaths,assists:player.assists,statlockerPP:player.account_id==null?null:profiles[player.account_id]?.ppScore}]), mechanicEvidence);
  const pressureRows = [{label:"Weapon",value:teamProfile.weaponDamage},{label:"Spirit",value:teamProfile.spiritDamage},{label:"Burst",value:Math.max(teamProfile.weaponBurst,teamProfile.spiritBurst)},{label:"CC",value:Math.max(teamProfile.hardCc,teamProfile.softCc)},{label:"Sustain",value:Math.max(teamProfile.healing,teamProfile.sustain)},{label:"Mobility",value:teamProfile.mobility}];
  const alliedPressureRows = [{label:"Weapon",value:alliedProfile.weaponDamage},{label:"Spirit",value:alliedProfile.spiritDamage},{label:"Burst",value:Math.max(alliedProfile.weaponBurst,alliedProfile.spiritBurst)},{label:"CC",value:Math.max(alliedProfile.hardCc,alliedProfile.softCc)},{label:"Sustain",value:Math.max(alliedProfile.healing,alliedProfile.sustain)},{label:"Mobility",value:alliedProfile.mobility}];
  const teamStrengths = alliedPressureRows.filter((row) => row.value >= .65).sort((a, b) => b.value - a.value).slice(0, 3);
  const teamCoverageGaps = alliedPressureRows.filter((row) => row.value <= .3).sort((a, b) => a.value - b.value).slice(0, 3);
  const live = status.in_game && !!match;
  return <section className="desktop-live-page" aria-label="Current match">
    <div className="desktop-live-heading"><div><small>COUNTERLOCK / CURRENT MATCH</small><h1>{live ? "Live match" : status.game_running ? "Deadlock is running" : "Ready for match"}</h1><p>{live ? status.provider === "attached" ? "Live values read from local game memory; updates poll every 1–2 seconds." : `Match data source: ${status.provider}. Public API snapshots can trail the game.` : status.game_running ? "Waiting for a local match and verified game memory." : "Launch Deadlock to start local match detection."}</p></div><span className={`desktop-live-indicator${live ? " active" : ""}`}>{live ? `● LIVE · ${status.provider.toUpperCase()}` : "○ WAITING"}</span></div>
    <div className="desktop-live-overview"><div><small>{own?.account_id == null ? "YOUR HERO" : "YOU"}</small><strong>{own?.hero_id != null ? heroes.get(own.hero_id)?.name ?? `Hero #${own.hero_id}` : "—"}</strong><span>{own?.kills ?? "—"} / {own?.deaths ?? "—"} / {own?.assists ?? "—"} KDA</span></div><div><small>SOULS AVAILABLE</small><strong>{own?.unspent_souls?.toLocaleString() ?? "—"}</strong></div><div><small>NET WORTH</small><strong>{own?.net_worth?.toLocaleString() ?? "—"}</strong></div><div className="desktop-overview-time"><small>MATCH TIME</small><strong>{live && match.game_time_s != null ? `${Math.floor(match.game_time_s / 60)}:${String(match.game_time_s % 60).padStart(2, "0")}` : "—"}</strong></div></div>
    <div className="desktop-live-grid">
      <article className="desktop-live-card desktop-match-card"><header><h2>Match roster</h2><span>{match?.players.length ?? 0} PLAYERS</span></header>
        {live ? <><div className="desktop-team-heading">YOUR TEAM <span>{allies.length} PLAYERS</span></div><div className="desktop-player-list">{allies.map((player, index) => playerRow(player, heroes, profiles, itemById, itemByToken, match.account_id, index))}</div>
          <div className="desktop-team-heading enemy">ENEMY TEAM <span>{enemies.length} PLAYERS · RANKED BY LIVE THREAT</span></div><div className="desktop-player-list">{threatScores.map((threat, index) => { const player = enemies.find((entry) => entry.hero_id === threat.heroId)!; return playerRow(player, heroes, profiles, itemById, itemByToken, match.account_id, index, { rank: index + 1, weight: threat.weight }); })}</div></> : <div className="desktop-match-empty">{status.game_running ? "No live roster yet. Stay in the match while the local reader checks both teams." : "No match running."}</div>}
      </article>
      <aside className="desktop-threat-panel"><header><small>CURRENT THREATS</small><span>{threatScores.length ? `${threatScores.length} ENEMIES` : "AWAITING ROSTER"}</span></header>{threatScores.length ? threatScores.slice(0, 3).map((threat, index) => { const player = enemies.find((entry) => entry.hero_id === threat.heroId)!; const profile = player.account_id == null ? undefined : profiles[player.account_id]; const hero = heroes.get(threat.heroId); return <div className="desktop-threat-feature" key={`${threat.heroId}-${index}`}><b>0{index + 1}</b><span className="desktop-threat-avatar">{profile?.avatarUrl ? <img src={profile.avatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : hero?.images?.icon_image_small_webp && <img src={hero.images.icon_image_small_webp} alt="" />}</span><div><strong>{profile?.name || (player.account_id == null ? "Player" : `Player ${player.account_id}`)}</strong><small>{hero?.name ?? `Hero #${threat.heroId}`} · {playerRank(profile?.estimatedRankNumber)?.label ?? "Rank —"}</small></div><em>{index === 0 ? "PRIMARY" : index === 1 ? "HIGH" : "HIGH"}<small>{(threat.weight * 100).toFixed(0)}% weight</small></em></div>}) : <p>Threat scores appear when enemy live stats are available.</p>}</aside>
    </div>
    <section className="team-pressure"><header><small>ENEMY TEAM PROFILE</small><span>THREAT PROFILE</span></header>{pressureRows.map(row=><div key={row.label}><span>{row.label}</span><i><b style={{width:`${Math.round(row.value*100)}%`}} /></i><strong>{row.value>=.75?"HIGH":row.value>=.45?"MEDIUM":"LOW"}</strong></div>)}{teamProfile.confidence<.25&&<small className="profile-evidence">Limited hero-mechanics evidence</small>}</section>
    <section className="team-pressure allied-team-pressure"><header><small>YOUR TEAM COMPOSITION</small><span>HERO MECHANICS PROFILE</span></header>{alliedPressureRows.map(row=><div key={row.label}><span>{row.label}</span><i><b style={{width:`${Math.round(row.value*100)}%`}} /></i><strong>{row.value>=.75?"HIGH":row.value>=.45?"MEDIUM":"LOW"}</strong></div>)}{alliedProfile.confidence<.25&&<small className="profile-evidence">Limited hero-mechanics evidence. Bars show the current roster’s known ability profile; live item effects are not included.</small>}{live&&allies.length>0&&<div className="team-composition-read"><article><small>DOCUMENTED STRENGTHS</small><p>{teamStrengths.map((row)=>row.label).join(" · ")||"No strong roster signal supported"}</p></article><article><small>POTENTIAL GAPS</small><p>{alliedProfile.confidence>=.45?teamCoverageGaps.map((row)=>row.label).join(" · ")||"No clear low-signal categories":"Ability evidence is too limited to identify gaps"}</p></article><small>Ability text coverage: {Math.round(alliedProfile.confidence*100)}%. Gaps indicate low documented signals, not proof that the team lacks that mechanic.</small></div>}</section>
    {live && (match?.game_time_s??0)<600 && laneEnemy?.hero_id!=null && <article className="lane-plan-card"><small>LANE PLAN · {laneName&&laneName!=="unknown"?`${laneName.toUpperCase()} LANE`:"LANE UNKNOWN"}</small><strong>vs {profiles[laneEnemy.account_id??-1]?.name??"Opponent"} · {heroes.get(laneEnemy.hero_id)?.name??`Hero #${laneEnemy.hero_id}`}</strong><span>STATE: {lanePosition==="unknown"?"UNKNOWN":lanePosition.toUpperCase()} · GOAL: {laneIntent}{laneIntent==="SURVIVE"?" + FARM":""}</span><p>Early recommendations use same-lane evidence where available and taper off after 10 minutes.</p></article>}
    <article className="desktop-live-advice"><div className="desktop-next-buy-icon">↗</div><div className="desktop-next-buy-copy"><small>NEXT BUY</small><h2>{advice?.recommended?.name ?? "Awaiting verified recommendation"}</h2>{advice?.recommended ? <><p>{advice.recommended.reason}</p><span>{target ? `VS ${targetProfile?.name || "Player"} · ${heroes.get(targetHeroId!)?.name ?? "Hero"}` : "VS ENEMY TEAM"} · ◈ {advice.recommended.cost.toLocaleString()}</span>{coveredNames.length>0&&<span className="next-buy-coverage"><b>COVERS</b> {coveredNames.join(" · ")}</span>}</> : <p>Current hero and enemy roster are needed for an item recommendation.</p>}</div><strong>{advice?.recommended?.affordable == null ? "SOULS UNKNOWN" : advice.recommended.affordable ? "BUY NOW" : "SAVE SOULS"}</strong><button type="button" onClick={onOpenBuild}>BUILD LAB →</button></article>
  </section>;
}
