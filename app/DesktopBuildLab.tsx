import type { DesktopAdvice, DesktopMatch, DesktopStatus } from "./desktop";
import { scoreThreats } from "./lib/build-engine/threat-score";

type Hero = { id: number; name: string; images?: { icon_image_small_webp?: string } };
type Item = { id: number; name: string; cost: number | null; item_slot_type: string | null; shop_image_webp?: string };
type Entry = { item: Item & { item_tier?: number | null }; enemyRates: Array<{ heroId: number; lift: number }>; threatTargets?: number[]; teamBuyTime: number; carryBuyTime: number; teamRate: number; carryRate: number; baselineRate: number; teamMatches: number; carryMatches: number };
type Plan = { early: Entry[]; mid: Entry[]; late: Entry[]; weapon: Entry[]; vitality: Entry[]; spirit: Entry[]; flex: Entry[]; purchaseOrder: Entry[]; corePath: Entry[]; adaptiveCounters: Entry[]; situational: Entry[]; sellSuggestions: Array<{ sell: Entry; replacement: Entry; reason?: string }> };

export function DesktopBuildLab({ status, match, heroes, items, lang, plan, cost, remainingCost, ownedItemIds, liveOwnedItemIds, onToggleOwned, onSave, onLoad, presetMessage, buyTarget, advice, recommendations }: {
  status: DesktopStatus;
  match: DesktopMatch | null;
  heroes: Map<number, Hero>;
  items: Item[];
  lang: "en" | "de";
  plan: Plan;
  cost: number;
  remainingCost: number;
  ownedItemIds: number[];
  liveOwnedItemIds: number[];
  onToggleOwned: (id: number) => void;
  onSave: () => void;
  onLoad: () => void;
  presetMessage: string | null;
  buyTarget: "team" | "carry";
  advice: DesktopAdvice | null;
  recommendations: Entry[];
}) {
  const de = lang === "de";
  const live = status.in_game && !!match;
  const own = live ? match.players.find((player) => player.account_id != null && player.account_id === match.account_id) : null;
  const enemies = own?.team == null ? [] : match!.players.filter((player) => player.team != null && player.team !== own.team && player.hero_id != null);
  const rankedThreats = scoreThreats(enemies.map((player) => ({ heroId: player.hero_id!, netWorth: player.net_worth,
    soulsPerMinute: match?.game_time_s && player.net_worth != null ? player.net_worth / Math.max(1, match.game_time_s / 60) : null,
    kills: player.kills, deaths: player.deaths, assists: player.assists })), match?.game_time_s ?? null);
  const candidates = plan.purchaseOrder.filter((entry) => !ownedItemIds.includes(entry.item.id));
  const current = live && own?.hero_id != null && enemies.length > 0
    ? candidates.find((entry) => entry.item.id === advice?.recommended?.item_id) ?? recommendations.find((entry) => entry.item.id === advice?.recommended?.item_id) ?? null
    : null;
  const currentIndex = current ? plan.purchaseOrder.findIndex((entry) => entry.item.id === current.item.id) : -1;
  const alternatives = (currentIndex >= 0 ? plan.purchaseOrder.slice(currentIndex + 1) : plan.purchaseOrder).filter((entry) => !ownedItemIds.includes(entry.item.id) && entry.item.id !== current?.item.id).slice(0, 3);
  const itemById = new Map(items.map((item) => [item.id, item]));
  const locale = de ? "de-DE" : "en-US";
  const icon = (id: number) => { const url = itemById.get(id)?.shop_image_webp; return url ? <img src={url} alt="" /> : <span>◆</span>; };
  const displayItem = (entry: Entry) => {
    const time = buyTarget === "team" ? entry.teamBuyTime : entry.carryBuyTime;
    const rate = buyTarget === "team" ? entry.teamRate : entry.carryRate;
    const samples = buyTarget === "team" ? entry.teamMatches : entry.carryMatches;
    const lift = (rate - entry.baselineRate) * 100;
    return { time, rate, samples, lift, reason: `${de ? "Matchup-Wert" : "Matchup lift"} ${lift >= 0 ? "+" : ""}${lift.toFixed(1)} pp · ${samples.toLocaleString(locale)} ${de ? "Matches" : "matches"} · ${de ? "Ø Kauf" : "Avg. buy"} ${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}` };
  };

  return <section className="desktop-build-page" aria-label="Build Lab">
    <header className="desktop-build-intro"><div><small>COUNTERLOCK / BUILD LAB</small><h1>{de ? "Dein nächster Build" : "Your next build"}</h1><p>{de ? "Kaufempfehlungen für deinen Helden und das erkannte Gegnerteam." : "Item advice for your hero and the detected enemy team."}</p></div><span className={`desktop-live-indicator${live ? " active" : ""}`}>{live ? "● LIVE MATCH" : "○ WAITING FOR MATCH"}</span></header>
    <div className="desktop-build-layout">
      <div className="desktop-build-main">
        <article className="desktop-build-feature"><div className="desktop-build-overline"><span>01 / {de ? "NÄCHSTER KAUF" : "NEXT BUY"}</span><span>{current ? "MATCH ADVICE" : "AWAITING MATCH"}</span></div>
          {current ? <><div className="desktop-build-feature-body"><div className="desktop-build-item-icon">{icon(current.item.id)}</div><div><small>{current.item.item_slot_type ?? "ITEM"} · {advice?.recommended?.priority ? `#${advice.recommended.priority}` : "MATCH ADVICE"}</small><h2>{current.item.name}</h2><p>{advice?.recommended?.reason ?? displayItem(current).reason}</p><small>{de ? "Stichprobenkonfidenz" : "Evidence confidence"}: {current.teamMatches >= 2000 ? (de ? "hoch" : "high") : current.teamMatches >= 250 ? (de ? "mittel" : "medium") : (de ? "begrenzt" : "limited")}</small></div><strong>◈ {(current.item.cost ?? 0).toLocaleString(locale)}</strong></div><div className="desktop-build-footnote">{de ? "Live-Shop-Seelen werden aus dem Spielspeicher gelesen. Inventar und Shop-Seelen werden live aus dem Spielspeicher gelesen; zusätzliche Käufe kannst du unten markieren." : "Live shop souls are read from game memory. Live inventory and shop souls are read from game memory; you can still mark additional purchases below."}</div></> : <div className="desktop-build-await"><strong>{de ? "Build erscheint mit dem Match" : "Build appears with your match"}</strong><p>{de ? "Starte ein Match und warte, bis dein Held und mindestens ein Gegner aus dem Spiel erkannt wurden. Danach berechnen wir passende Items." : "Start a match and wait for your hero and at least one enemy to be detected from the game. Matching items will appear here."}</p></div>}</article>
        {current && <section className="desktop-build-role-grid" aria-label={de ? "Build-Empfehlung nach Rolle" : "Build recommendations by role"}>{([
          { key: "core", label: de ? "CORE-PFAD" : "CORE PATH", entries: plan.corePath },
          { key: "counter", label: "ADAPTIVE COUNTERS", entries: plan.adaptiveCounters },
          { key: "situational", label: de ? "SITUATIV" : "SITUATIONAL", entries: plan.situational },
        ] as const).map((group) => <section key={group.key}><small>{group.label}</small>{group.entries.length ? group.entries.slice(0, 4).map((entry) => { const targetId = entry.threatTargets?.[0] ?? entry.enemyRates[0]?.heroId; return <div key={entry.item.id}><span>{entry.item.name}</span><b>{targetId ? heroes.get(targetId)?.name ?? entry.item.item_slot_type : entry.item.item_slot_type}</b></div>; }) : <p>{de ? "Noch keine Items" : "No items yet"}</p>}</section>)}</section>}
        {current && <section className="desktop-build-options"><div className="desktop-build-section-title"><div><small>02 / {de ? "WEITERE OPTIONEN" : "OTHER OPTIONS"}</small><h2>{de ? "Danach in Betracht ziehen" : "Consider next"}</h2></div><span>{alternatives.length} ITEMS</span></div><div className="desktop-build-option-list">{alternatives.map((entry, index) => <article className="desktop-build-option" key={entry.item.id}><b>{String(index + 2).padStart(2, "0")}</b><div className="desktop-build-option-icon">{icon(entry.item.id)}</div><div><strong>{entry.item.name}</strong><small>{displayItem(entry).reason}</small></div><span>◈ {(entry.item.cost ?? 0).toLocaleString(locale)}</span></article>)}</div></section>}
        <section className="desktop-full-build">
          <header className="desktop-full-build-head"><div><small>03 / {de ? "KOMPLETTER BUILD" : "FULL BUILD"}</small><h2>{de ? "Dein Kaufpfad" : "Your purchase path"}</h2><p>{de ? "16 Items vom frühen Spiel bis zum Endgame." : "16 items from the early game through endgame."}</p></div><div className="desktop-build-presets"><button type="button" onClick={onSave}>{de ? "BUILD SPEICHERN" : "SAVE BUILD"}</button><button type="button" onClick={onLoad}>{de ? "BUILD LADEN" : "LOAD BUILD"}</button>{presetMessage && <small>{presetMessage}</small>}</div></header>
          <div className="desktop-full-build-summary"><div><small>{de ? "GESAMTKOSTEN" : "TOTAL COST"}</small><strong>◈ {cost.toLocaleString(locale)}</strong></div><div><small>{de ? "NOCH OFFEN" : "REMAINING"}</small><strong>◈ {remainingCost.toLocaleString(locale)}</strong></div><div><small>{de ? "BUILD-CHECK" : "BUILD CHECK"}</small><strong>{plan.purchaseOrder.length}/16 {new Set(plan.purchaseOrder.map((entry) => entry.item.id)).size === plan.purchaseOrder.length ? "✓" : ""}</strong></div></div>
          <div className="desktop-full-build-inventory">{([{ key: "weapon", title: de ? "WAFFE" : "WEAPON", entries: plan.weapon }, { key: "vitality", title: de ? "VITALITÄT" : "VITALITY", entries: plan.vitality }, { key: "spirit", title: "SPIRIT", entries: plan.spirit }, { key: "flex", title: "FLEX", entries: plan.flex }] as const).map((group) => <section key={group.key}><small>{group.title}</small><div>{group.entries.map((entry) => <span key={entry.item.id} title={entry.item.name}>{icon(entry.item.id)}</span>)}</div></section>)}</div>
          <div className="desktop-purchase-stages">{([{ id: "early", label: "EARLY GAME", entries: plan.early }, { id: "mid", label: "MID GAME", entries: plan.mid }, { id: "late", label: "LATE GAME", entries: plan.late }] as const).map((stage, stageIndex) => <section className={`desktop-purchase-stage ${stage.id}`} key={stage.id}><header><span>0{stageIndex + 1}</span><strong>{stage.label}</strong><small>{stage.entries.length} ITEMS</small></header><div>{stage.entries.map((entry) => { const order = plan.purchaseOrder.findIndex((item) => item.item.id === entry.item.id) + 1; const owned = ownedItemIds.includes(entry.item.id); const targetHero = entry.enemyRates[0] ? heroes.get(entry.enemyRates[0].heroId) : undefined; return <article className={owned ? "owned" : ""} key={entry.item.id}><button type="button" onClick={() => onToggleOwned(entry.item.id)} aria-pressed={owned} disabled={liveOwnedItemIds.includes(entry.item.id)}><b>{String(order).padStart(2, "0")}</b><span className="desktop-purchase-icon">{icon(entry.item.id)}</span><span className="desktop-purchase-copy"><strong>{entry.item.name}</strong><small>{entry.item.item_slot_type ?? "ITEM"} · T{entry.item.item_tier ?? "—"}</small></span><span className="desktop-purchase-cost">{owned ? "✓" : `◈ ${(entry.item.cost ?? 0).toLocaleString(locale)}`}</span></button>{targetHero && <small className="desktop-purchase-target">{de ? "GEGEN" : "VS"} {targetHero.name}</small>}</article>; })}</div></section>)}</div>
          <section className="desktop-sell-plan"><header><small>↻</small><div><strong>{de ? "VERKAUFSPLAN" : "SELL PLAN"}</strong><span>{de ? "Nur bei positivem Upgrade- oder Ersatzwert" : "Only when an upgrade or replacement adds value"}</span></div></header>{plan.sellSuggestions.length ? plan.sellSuggestions.map(({ sell, replacement, reason }) => <div className="desktop-sell-pair" key={`${sell.item.id}-${replacement.item.id}`}><span>{sell.item.name}</span><b>→</b><strong>{replacement.item.name}</strong><small>{reason === "upgrade_obsolete" ? (de ? "Upgrade macht den Slot frei" : "Upgrade replaces component") : (de ? "Höherer aktueller Matchwert" : "Higher current match value")}</small></div>) : <p>{de ? "Noch keine passenden Upgrades" : "No matching upgrades yet"}</p>}</section>
        </section>
      </div>
      <aside className="desktop-build-context"><small>{de ? "MATCH-KONTEXT" : "MATCH CONTEXT"}</small><h2>{own?.hero_id != null ? heroes.get(own.hero_id)?.name ?? `Hero #${own.hero_id}` : "—"}</h2><p>{de ? "Dein erkannter Held" : "Your detected hero"}</p><div className="desktop-build-context-rule" /><small>{de ? "GEGNERTEAM" : "ENEMY TEAM"}</small>{enemies.length ? <div className="desktop-build-enemies">{enemies.map((player, index) => { const hero = heroes.get(player.hero_id!); return <div key={`${player.hero_id}-${index}`}><span>{hero?.images?.icon_image_small_webp ? <img src={hero.images.icon_image_small_webp} alt="" /> : "?"}</span><strong>{hero?.name ?? `Hero #${player.hero_id}`}</strong></div>; })}</div> : <p>{de ? "Noch keine Gegner erkannt" : "No enemies detected yet"}</p>}{rankedThreats.length > 0 && <><div className="desktop-build-context-rule" /><small>{de ? "AKTUELLE GEFAHREN" : "CURRENT THREATS"}</small><ol className="desktop-threat-list">{rankedThreats.map((threat) => <li key={threat.heroId}><span>{heroes.get(threat.heroId)?.name ?? `Hero #${threat.heroId}`}</span><b>{Math.round(threat.weight * 100)}%</b><small>{enemies.find((player) => player.hero_id === threat.heroId)?.net_worth?.toLocaleString() ?? "—"} {de ? "Gesamtvermögen" : "net worth"}</small></li>)}</ol></>}<div className="desktop-build-context-rule" /><p className="desktop-build-source">{de ? "Nettovermögen ist Gesamtvermögen, kein Shop-Guthaben. Gegner-Items sind historische Tendenzen, kein Live-Inventar." : "Net worth is total value, not shop balance. Enemy items are historical tendencies, not live inventory."}</p></aside>
    </div>
  </section>;
}
