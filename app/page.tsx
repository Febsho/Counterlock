"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const API = "https://api.deadlock-api.com/v1";

type Lang = "en" | "de";
type Category = "all" | "weapon" | "vitality" | "spirit";
type SortMode = "recommended" | "winrate" | "sample" | "cost";
type Phase = "early" | "mid" | "late";

type Hero = { id: number; name: string; images?: { icon_image_small_webp?: string } };
type Item = {
  id: number;
  name: string;
  cost: number | null;
  item_tier: number | null;
  item_slot_type: Exclude<Category, "all"> | null;
  shopable: boolean;
  shop_image_webp?: string;
};
type ItemStat = { item_id: number; wins: number; losses: number; matches: number; players: number; avg_buy_time_s: number };
type CounterStat = { hero_id: number; enemy_hero_id: number; wins: number; matches_played: number };
type Recommendation = { item: Item; score: number; winRate: number; baselineRate: number; carryRate: number; matches: number; buyTime: number };

const copy = {
  en: {
    home: "Counterbuild home", heroKicker: "DEADLOCK MATCHUP INTELLIGENCE",
    heroTitleA: "Build for the fight", heroTitleB: "happening right now.",
    heroText: "Choose your hero, mark the enemy carry, and get item recommendations ranked with real matchup data.",
    yourHero: "YOUR HERO", youPlay: "YOU PLAY", chooseHero: "Choose your hero",
    enemyTeam: "ENEMY TEAM", chooseEnemy: "Choose an enemy", addEnemy: "+ Add enemy", remove: "Remove",
    focusTarget: "FOCUS TARGET", enemyCarry: "ENEMY CARRY", matchupWr: "YOUR MATCHUP WR",
    analyze: "ANALYZE MATCHUP →", analyzing: "ANALYZING …",
    liveRec: "LIVE RECOMMENDATION", bestBuys: "Your best buys", against: "against",
    currentMinute: "CURRENT MINUTE", filters: "SMART FILTERS", category: "CATEGORY", all: "All",
    weapon: "Weapon", vitality: "Vitality", spirit: "Spirit", minSample: "MIN. SAMPLE", sort: "SORT BY",
    recommended: "Recommended", winrate: "Win rate", sample: "Sample size", cost: "Cost",
    matchup: "MATCHUP", games: "GAMES", focus: "FOCUS", items: "ITEMS FOUND",
    winrateLabel: "WIN RATE", buyTime: "BUY TIME", vsCarry: "percentage points vs. hero baseline",
    copyBuild: "COPY TOP BUILD", copied: "BUILD COPIED ✓", empty: "No items match these filters. Try a lower sample size.",
    methodTitle: "How ranking works:", method: "Carry matchup, the full enemy team, your hero baseline and sample confidence are weighted together. Correlation is not a guarantee—adapt to the actual game state.",
    updated: "UPDATED", assetError: "Hero data is temporarily unavailable.", statsError: "Live statistics are temporarily unavailable. Please try again.",
    footer: "Community project · Data by", disclaimer: "· Not affiliated with Valve.", early: "EARLY", mid: "MID GAME", late: "LATE",
  },
  de: {
    home: "Counterbuild Startseite", heroKicker: "DEADLOCK MATCHUP-ANALYSE",
    heroTitleA: "Baue für den Kampf,", heroTitleB: "der gerade passiert.",
    heroText: "Wähle deinen Helden, markiere den gegnerischen Carry und erhalte Item-Empfehlungen aus echten Matchup-Daten.",
    yourHero: "DEIN HELD", youPlay: "DU SPIELST", chooseHero: "Deinen Helden auswählen",
    enemyTeam: "GEGNERISCHES TEAM", chooseEnemy: "Gegner auswählen", addEnemy: "+ Gegner", remove: "Entfernen",
    focusTarget: "FOKUS-ZIEL", enemyCarry: "GEGNERISCHER CARRY", matchupWr: "DEINE MATCHUP-WR",
    analyze: "MATCHUP ANALYSIEREN →", analyzing: "ANALYSE LÄUFT …",
    liveRec: "LIVE-EMPFEHLUNG", bestBuys: "Deine besten Käufe", against: "gegen",
    currentMinute: "AKTUELLE MINUTE", filters: "INTELLIGENTE FILTER", category: "KATEGORIE", all: "Alle",
    weapon: "Waffe", vitality: "Vitalität", spirit: "Spirit", minSample: "MIN. STICHPROBE", sort: "SORTIERUNG",
    recommended: "Empfehlung", winrate: "Winrate", sample: "Stichprobe", cost: "Kosten",
    matchup: "MATCHUP", games: "SPIELE", focus: "FOKUS", items: "ITEMS GEFUNDEN",
    winrateLabel: "WINRATE", buyTime: "KAUFZEIT", vsCarry: "Prozentpunkte gegen die Helden-Basis",
    copyBuild: "TOP-BUILD KOPIEREN", copied: "BUILD KOPIERT ✓", empty: "Keine Items passen zu diesen Filtern. Versuche eine kleinere Stichprobe.",
    methodTitle: "So wird gerankt:", method: "Carry-Matchup, gesamtes Gegnerteam, Basis-Winrate deines Helden und Stichprobenqualität werden gewichtet. Korrelation ist keine Garantie—passe den Kauf an den Spielstand an.",
    updated: "AKTUALISIERT", assetError: "Heldendaten sind momentan nicht erreichbar.", statsError: "Die Live-Statistiken sind gerade nicht erreichbar. Bitte versuche es erneut.",
    footer: "Community-Projekt · Daten von", disclaimer: "· Nicht mit Valve verbunden.", early: "EARLY", mid: "MID GAME", late: "LATE",
  },
} as const;

const phaseRanges: Record<Phase, [number, number]> = { early: [0, 660], mid: [540, 1260], late: [1080, Infinity] };

function adjustedRate(stat?: ItemStat) { return stat ? (stat.wins + 60) / (stat.matches + 120) : 0.5; }
function pct(value: number) { return `${(value * 100).toFixed(1)}%`; }
function formatMatches(value: number, lang: Lang) { return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatTime(seconds: number, lang: Lang) { return `~${Math.max(0, Math.round(seconds / 60))} ${lang === "de" ? "Min." : "min"}`; }

function HeroPortrait({ hero, size = "normal" }: { hero?: Hero; size?: "small" | "normal" }) {
  return <span className={`portrait portrait-${size}`}>{hero?.images?.icon_image_small_webp ? <img src={hero.images.icon_image_small_webp} alt="" /> : hero?.name.slice(0, 1) ?? "?"}</span>;
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [heroId, setHeroId] = useState(1);
  const [enemyIds, setEnemyIds] = useState<number[]>([13, 3, 6]);
  const [carryId, setCarryId] = useState(13);
  const [enemyToAdd, setEnemyToAdd] = useState(2);
  const [gameMinute, setGameMinute] = useState(15);
  const [category, setCategory] = useState<Category>("all");
  const [minSample, setMinSample] = useState(250);
  const [sortMode, setSortMode] = useState<SortMode>("recommended");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [matchup, setMatchup] = useState<CounterStat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const t = copy[lang];
  const phase: Phase = gameMinute < 11 ? "early" : gameMinute < 21 ? "mid" : "late";

  const heroMap = useMemo(() => new Map(heroes.map((hero) => [hero.id, hero])), [heroes]);
  const ownHero = heroMap.get(heroId);
  const carryHero = heroMap.get(carryId);

  useEffect(() => {
    const saved = window.localStorage.getItem("counterbuild-language");
    if (saved === "de" || saved === "en") setLang(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    window.localStorage.setItem("counterbuild-language", lang);
    let active = true;
    const apiLanguage = lang === "de" ? "german" : "english";
    Promise.all([
      fetch(`${API}/assets/heroes?language=${apiLanguage}&only_active=true`).then((response) => response.json()),
      fetch(`${API}/assets/items?language=${apiLanguage}`).then((response) => response.json()),
    ]).then(([heroData, itemData]: [Hero[], Item[]]) => {
      if (!active) return;
      setHeroes(heroData.sort((a, b) => a.name.localeCompare(b.name, lang)));
      setItems(itemData.filter((item) => item.shopable && item.cost && item.item_tier));
    }).catch(() => active && setError(copy[lang].assetError));
    return () => { active = false; };
  }, [lang]);

  const analyze = useCallback(async () => {
    if (!items.length || !enemyIds.length) return;
    setLoading(true); setError(""); setCopied(false);
    try {
      const common = "min_matches=80&game_mode=normal";
      const [baseStats, teamStats, carryStats, counterStats] = await Promise.all([
        fetch(`${API}/analytics/item-stats?hero_ids=${heroId}&${common}`).then((r) => r.json()),
        fetch(`${API}/analytics/item-stats?hero_ids=${heroId}&enemy_hero_ids=${enemyIds.join(",")}&${common}`).then((r) => r.json()),
        fetch(`${API}/analytics/item-stats?hero_ids=${heroId}&enemy_hero_ids=${carryId}&${common}`).then((r) => r.json()),
        fetch(`${API}/analytics/hero-counter-stats?same_lane_filter=false&min_matches=80&game_mode=normal`).then((r) => r.json()),
      ] as const) as [ItemStat[], ItemStat[], ItemStat[], CounterStat[]];
      const baseMap = new Map(baseStats.map((stat) => [stat.item_id, stat]));
      const teamMap = new Map(teamStats.map((stat) => [stat.item_id, stat]));
      const carryMap = new Map(carryStats.map((stat) => [stat.item_id, stat]));
      setRecommendations(items.map((item) => {
        const base = baseMap.get(item.id), team = teamMap.get(item.id), carry = carryMap.get(item.id);
        if (!team || !carry) return null;
        const baselineRate = adjustedRate(base), winRate = adjustedRate(team), carryRate = adjustedRate(carry);
        const confidence = Math.min(1, Math.log10(Math.max(10, carry.matches)) / 4.7);
        const uplift = Math.max(-0.06, Math.min(0.06, carryRate - baselineRate));
        return { item, score: (carryRate * .5 + winRate * .3 + baselineRate * .2 + uplift * .35) * confidence, winRate, baselineRate, carryRate, matches: carry.matches, buyTime: carry.avg_buy_time_s } satisfies Recommendation;
      }).filter((value): value is Recommendation => Boolean(value)));
      setMatchup(counterStats.find((stat) => stat.hero_id === heroId && stat.enemy_hero_id === carryId) ?? null);
      setUpdatedAt(new Date());
    } catch { setError(copy[lang].statsError); }
    finally { setLoading(false); }
  }, [carryId, enemyIds, heroId, items, lang]);

  useEffect(() => { if (items.length) void analyze(); }, [items]);

  const visibleRecommendations = useMemo(() => {
    const [start, end] = phaseRanges[phase];
    const filtered = recommendations.filter((entry) => entry.buyTime >= start && entry.buyTime <= end && entry.matches >= minSample && (category === "all" || entry.item.item_slot_type === category));
    return filtered.sort((a, b) => sortMode === "winrate" ? b.carryRate - a.carryRate : sortMode === "sample" ? b.matches - a.matches : sortMode === "cost" ? (a.item.cost ?? 0) - (b.item.cost ?? 0) : b.score - a.score).slice(0, 8);
  }, [category, minSample, phase, recommendations, sortMode]);

  function addEnemy() { if (enemyToAdd !== heroId && !enemyIds.includes(enemyToAdd) && enemyIds.length < 6) setEnemyIds((current) => [...current, enemyToAdd]); }
  function removeEnemy(id: number) { const next = enemyIds.filter((enemyId) => enemyId !== id); setEnemyIds(next); if (carryId === id && next.length) setCarryId(next[0]); }
  function submit(event: FormEvent) { event.preventDefault(); void analyze(); }
  async function copyTopBuild() {
    const text = `${ownHero?.name ?? "Hero"} vs ${carryHero?.name ?? "Carry"}: ${visibleRecommendations.slice(0, 5).map((entry, index) => `${index + 1}. ${entry.item.name}`).join(" · ")}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2200); } catch { setCopied(false); }
  }

  const matchupWinRate = matchup ? matchup.wins / matchup.matches_played : null;
  const availableEnemies = heroes.filter((hero) => hero.id !== heroId && !enemyIds.includes(hero.id));

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label={t.home}><span className="brand-mark">CB</span><span><strong>COUNTER</strong>BUILD</span></a>
        <div className="header-actions">
          <div className="live-pill"><span /> LIVE MATCH DATA</div>
          <div className="language-toggle" aria-label="Language / Sprache">
            <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
            <button className={lang === "de" ? "active" : ""} onClick={() => setLang("de")}>DE</button>
          </div>
        </div>
      </header>

      <section className="hero-section" id="top">
        <div className="eyebrow">{t.heroKicker}</div>
        <h1>{t.heroTitleA}<br /><em>{t.heroTitleB}</em></h1>
        <p>{t.heroText}</p>
      </section>

      <form className="analyzer" onSubmit={submit}>
        <div className="step-block">
          <div className="step-label"><span>01</span> {t.yourHero}</div>
          <label className="select-card"><HeroPortrait hero={ownHero} /><span><small>{t.youPlay}</small><select value={heroId} onChange={(event) => setHeroId(Number(event.target.value))} aria-label={t.chooseHero}>{heroes.map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</select></span></label>
        </div>
        <div className="step-block enemy-block">
          <div className="step-label"><span>02</span> {t.enemyTeam} <b>{enemyIds.length}/6</b></div>
          <div className="enemy-list">{enemyIds.map((id) => { const hero = heroMap.get(id); return <div className={`enemy-chip ${id === carryId ? "is-carry" : ""}`} key={id}><button type="button" onClick={() => setCarryId(id)}><HeroPortrait hero={hero} size="small" /><span>{hero?.name}</span>{id === carryId && <b>CARRY</b>}</button><button className="remove-enemy" type="button" onClick={() => removeEnemy(id)} aria-label={`${t.remove} ${hero?.name}`}>×</button></div>; })}</div>
          <div className="add-enemy"><select value={enemyToAdd} onChange={(event) => setEnemyToAdd(Number(event.target.value))} aria-label={t.chooseEnemy}>{availableEnemies.map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</select><button type="button" onClick={addEnemy} disabled={enemyIds.length >= 6}>{t.addEnemy}</button></div>
        </div>
        <div className="step-block carry-block">
          <div className="step-label"><span>03</span> {t.focusTarget}</div>
          <div className="carry-card"><HeroPortrait hero={carryHero} /><div><small>{t.enemyCarry}</small><strong>{carryHero?.name ?? "–"}</strong></div>{matchupWinRate !== null && <div className="threat"><small>{t.matchupWr}</small><strong>{pct(matchupWinRate)}</strong></div>}</div>
          <button className="analyze-button" disabled={loading || !enemyIds.length} type="submit">{loading ? t.analyzing : t.analyze}</button>
        </div>
      </form>

      <section className="results" aria-live="polite">
        <div className="results-heading"><div><div className="eyebrow">{t.liveRec}</div><h2>{t.bestBuys} <span>{t.against} {carryHero?.name}</span></h2></div><button className="copy-build" onClick={copyTopBuild} disabled={!visibleRecommendations.length}>{copied ? t.copied : t.copyBuild}</button></div>

        <div className="match-context">
          <label className="minute-control"><span><small>{t.currentMinute}</small><strong>{gameMinute}:00</strong></span><input type="range" min="1" max="40" value={gameMinute} onChange={(event) => setGameMinute(Number(event.target.value))} /><div className="phase-tabs">{(["early", "mid", "late"] as Phase[]).map((value) => <button type="button" key={value} className={phase === value ? "active" : ""} onClick={() => setGameMinute(value === "early" ? 7 : value === "mid" ? 15 : 26)}>{t[value]}</button>)}</div></label>
          <div className="quick-stats"><div><small>{t.matchup}</small><strong>{matchupWinRate === null ? "—" : pct(matchupWinRate)}</strong></div><div><small>{t.games}</small><strong>{formatMatches(matchup?.matches_played ?? 0, lang)}</strong></div><div><small>{t.focus}</small><strong>{carryHero?.name ?? "—"}</strong></div><div><small>{t.items}</small><strong>{visibleRecommendations.length}</strong></div></div>
        </div>

        <div className="filter-bar"><div className="filter-title">{t.filters}</div><label><small>{t.category}</small><select value={category} onChange={(event) => setCategory(event.target.value as Category)}><option value="all">{t.all}</option><option value="weapon">{t.weapon}</option><option value="vitality">{t.vitality}</option><option value="spirit">{t.spirit}</option></select></label><label><small>{t.minSample}</small><select value={minSample} onChange={(event) => setMinSample(Number(event.target.value))}><option value="80">80+</option><option value="250">250+</option><option value="1000">1K+</option><option value="5000">5K+</option></select></label><label><small>{t.sort}</small><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="recommended">{t.recommended}</option><option value="winrate">{t.winrate}</option><option value="sample">{t.sample}</option><option value="cost">{t.cost}</option></select></label></div>

        {error && <div className="error-card">{error}</div>}
        {!error && loading && <div className="loading-grid">{[1,2,3,4].map((n) => <div key={n} />)}</div>}
        {!error && !loading && !visibleRecommendations.length && <div className="empty-card">{t.empty}</div>}
        {!error && !loading && Boolean(visibleRecommendations.length) && <div className="item-grid">{visibleRecommendations.map((entry, index) => { const lift = (entry.carryRate - entry.baselineRate) * 100; return <article className={`item-card slot-${entry.item.item_slot_type}`} key={entry.item.id}><div className="rank">#{String(index + 1).padStart(2, "0")}</div><div className="item-icon">{entry.item.shop_image_webp ? <img src={entry.item.shop_image_webp} alt="" /> : <span>◆</span>}</div><div className="item-main"><div className="item-meta"><span>{entry.item.item_slot_type && t[entry.item.item_slot_type]}</span><span>T{entry.item.item_tier}</span></div><h3>{entry.item.name}</h3><div className="item-reason">{lift >= 0 ? "+" : ""}{lift.toFixed(1)} {t.vsCarry}</div></div><div className="item-stat"><small>{t.winrateLabel}</small><strong>{pct(entry.carryRate)}</strong></div><div className="item-stat"><small>{t.sample}</small><strong>{formatMatches(entry.matches, lang)}</strong></div><div className="item-stat"><small>{t.buyTime}</small><strong>{formatTime(entry.buyTime, lang)}</strong></div><div className="cost">◈ {entry.item.cost?.toLocaleString(lang === "de" ? "de-DE" : "en-US")}</div></article>; })}</div>}

        <div className="method-note"><span>i</span><p><strong>{t.methodTitle}</strong> {t.method}</p>{updatedAt && <time>{t.updated} {updatedAt.toLocaleTimeString(lang === "de" ? "de-DE" : "en-US", { hour: "2-digit", minute: "2-digit" })}</time>}</div>
      </section>

      <footer><div className="brand"><span className="brand-mark">CB</span><span><strong>COUNTER</strong>BUILD</span></div><p>{t.footer} <a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">Deadlock API</a> {t.disclaimer}</p></footer>
    </main>
  );
}
