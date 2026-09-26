import type { DesktopAdvice, DesktopMatch, DesktopPlayer, DesktopStatus } from "./desktop";

type LiveHero = { id: number; name: string; images?: { icon_image_small_webp?: string } };

function playerRow(player: DesktopPlayer, heroes: Map<number, LiveHero>, ownAccountId: number | null, index: number) {
  const hero = player.hero_id == null ? undefined : heroes.get(player.hero_id);
  const own = player.account_id != null && player.account_id === ownAccountId;
  return <div className={`desktop-player-row${own ? " is-you" : ""}`} key={`${player.account_id ?? "bot"}-${player.hero_id ?? index}-${index}`}>
    <span className="desktop-player-portrait">{hero?.images?.icon_image_small_webp ? <img src={hero.images.icon_image_small_webp} alt="" /> : hero?.name.slice(0, 1) ?? "?"}</span>
    <span className="desktop-player-name"><strong>{hero?.name ?? (player.hero_id == null ? "Unknown hero" : `Hero #${player.hero_id}`)}</strong><small>{own ? "YOU" : player.account_id == null ? "BOT" : "PLAYER"}</small></span>
    <span className="desktop-player-stat"><small>NET WORTH</small><b>{player.net_worth?.toLocaleString() ?? "—"}</b></span>
    <span className="desktop-player-stat"><small>K / D / A</small><b>{player.kills ?? "—"} / {player.deaths ?? "—"} / {player.assists ?? "—"}</b></span>
  </div>;
}

export function DesktopLivePanel({ status, match, heroes, advice, onOpenBuild }: {
  status: DesktopStatus;
  match: DesktopMatch | null;
  heroes: Map<number, LiveHero>;
  advice: DesktopAdvice | null;
  onOpenBuild: () => void;
}) {
  const own = match?.players.find((player) => player.account_id != null && player.account_id === match.account_id);
  const allies = match?.players.filter((player) => own?.team != null && player.team === own.team) ?? [];
  const enemies = match?.players.filter((player) => own?.team != null && player.team != null && player.team !== own.team) ?? [];
  const live = status.in_game && !!match;
  return <section className="desktop-live-page" aria-label="Current match">
    <div className="desktop-live-heading"><div><small>COUNTERLOCK / CURRENT MATCH</small><h1>{live ? "Live match" : status.game_running ? "Deadlock is running" : "Ready for match"}</h1><p>{live ? "Player values read from your running Deadlock client." : status.game_running ? "Waiting for a local match and verified game memory." : "Launch Deadlock to start local match detection."}</p></div><span className={`desktop-live-indicator${live ? " active" : ""}`}>{live ? "● LIVE MEMORY" : "○ WAITING"}</span></div>
    <div className="desktop-live-grid">
      <article className="desktop-live-card desktop-your-stats"><header><h2>Your stats</h2><span>{own?.hero_id != null ? heroes.get(own.hero_id)?.name ?? `Hero #${own.hero_id}` : "—"}</span></header>
        <div className="desktop-stat-feature"><small>UNSPENT SOULS</small><strong>{own?.unspent_souls?.toLocaleString() ?? "—"}</strong></div>
        <div className="desktop-stat-feature"><small>TOTAL NET WORTH</small><strong>{own?.net_worth?.toLocaleString() ?? "—"}</strong></div>
        <div className="desktop-stat-triplet"><div><small>KILLS</small><strong>{own?.kills ?? "—"}</strong></div><div><small>DEATHS</small><strong>{own?.deaths ?? "—"}</strong></div><div><small>ASSISTS</small><strong>{own?.assists ?? "—"}</strong></div></div>
        <p className="desktop-stat-note">Unspent souls come from your live hero pawn currency. Net worth remains total earned value; rank and personal win rate are not available from memory.</p>
      </article>
      <article className="desktop-live-card desktop-match-card"><header><h2>Current match</h2><span>{match?.players.length ?? 0} PLAYERS DETECTED</span></header>
        {live ? <><div className="desktop-team-heading">YOUR TEAM <span>{allies.length} PLAYERS</span></div><div className="desktop-player-list">{allies.map((player, index) => playerRow(player, heroes, match.account_id, index))}</div>
          <div className="desktop-team-heading enemy">ENEMY TEAM <span>{enemies.length} PLAYERS</span></div><div className="desktop-player-list">{enemies.map((player, index) => playerRow(player, heroes, match.account_id, index))}</div></> : <div className="desktop-match-empty">{status.game_running ? "No live roster yet. Stay in the test match while the memory reader checks both teams." : "No match running."}</div>}
      </article>
    </div>
    <article className="desktop-live-card desktop-live-advice"><div><small>COUNTERLOCK ADVISOR</small><h2>{advice?.recommended?.name ?? "Build advice appears with a verified matchup"}</h2><p>{advice?.recommended?.reason ?? "Current hero and enemy roster are needed for a live recommendation."}</p></div><button type="button" onClick={onOpenBuild}>OPEN BUILD LAB →</button></article>
  </section>;
}
