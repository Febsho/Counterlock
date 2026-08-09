"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const API = "https://api.deadlock-api.com/v1";

type Lang = "en" | "de";
type Category = "all" | "weapon" | "vitality" | "spirit";
type SortMode = "recommended" | "winrate" | "sample" | "cost";
type Phase = "early" | "mid" | "late";
type QueueMode = "all" | "ranked" | "unranked";

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
type Detection = { id: number; confidence: number };
type CounterPick = { hero: Hero; score: number; carryRate: number; matches: number; coverage: number };

const copy = {
  en: {
    home: "Counterbuild home", heroKicker: "DEADLOCK MATCHUP INTELLIGENCE",
    heroTitleA: "Build for the fight", heroTitleB: "happening right now.",
    heroText: "Choose your hero, mark the enemy carry, and get item recommendations ranked with real matchup data.",
    yourHero: "YOUR HERO", youPlay: "YOU PLAY", chooseHero: "Choose your hero",
    enemyTeam: "ENEMY TEAM", chooseEnemy: "Choose an enemy", addEnemy: "+ Add enemy", remove: "Remove", importScreen: "IMPORT SCREENSHOT",
    focusTarget: "FOCUS TARGET", enemyCarry: "ENEMY CARRY", matchupWr: "YOUR MATCHUP WR",
    analyze: "ANALYZE MATCHUP →", analyzing: "ANALYZING …",
    liveRec: "LIVE RECOMMENDATION", bestBuys: "Your best buys", against: "against",
    currentMinute: "CURRENT MINUTE", filters: "SMART FILTERS", category: "CATEGORY", all: "All",
    weapon: "Weapon", vitality: "Vitality", spirit: "Spirit", minSample: "MIN. SAMPLE", sort: "SORT BY",
    recommended: "Recommended", winrate: "Win rate", sample: "Sample size", cost: "Cost",
    matchup: "MATCHUP", games: "GAMES", focus: "FOCUS", items: "ITEMS FOUND",
    winrateLabel: "WIN RATE", buyTime: "BUY TIME", vsCarry: "percentage points vs. hero baseline",
    copyBuild: "COPY TOP BUILD", copied: "BUILD COPIED ✓", share: "SHARE MATCHUP", linkCopied: "LINK COPIED ✓", empty: "No items match these filters. Try a lower sample size.",
    methodTitle: "How ranking works:", method: "Carry matchup, the full enemy team, your hero baseline and sample confidence are weighted together. Correlation is not a guarantee—adapt to the actual game state.",
    updated: "UPDATED", assetError: "Hero data is temporarily unavailable.", statsError: "Live statistics are temporarily unavailable. Please try again.",
    footer: "Community project · Data by", disclaimer: "· Not affiliated with Valve.", early: "EARLY", mid: "MID GAME", late: "LATE",
    importerTitle: "Import enemy team", importerText: "Upload a match screenshot where the enemy hero names are visible. Recognition runs locally on your device.",
    dropTitle: "Drop match screenshot here", dropText: "or click to choose a PNG, JPG, or WebP", scanning: "READING HERO NAMES", detected: "DETECTED HEROES", confidence: "match",
    importHeroes: "IMPORT SELECTED HEROES", scanAgain: "CHOOSE ANOTHER SCREENSHOT", noHeroes: "No hero names were detected. Try a sharper screenshot with the scoreboard fully visible.", close: "Close screenshot importer", localOnly: "PRIVATE · IMAGE NEVER LEAVES YOUR DEVICE",
    moreOptions: "MORE OPTIONS", apiFilters: "MATCH DATA", queue: "QUEUE", both: "Ranked + Unranked", ranked: "Ranked only", unranked: "Unranked only", dataWindow: "DATA WINDOW", days: "days", laneOnly: "SAME LANE ONLY",
    itemRules: "ITEM RULES", maxBudget: "MAX. BUDGET", noLimit: "No limit", itemTier: "ITEM TIER", anyTier: "Any tier", resultCount: "RESULT COUNT", positiveLift: "POSITIVE LIFT ONLY", reanalyzeHint: "Queue, time window, and lane filters apply after Analyze Matchup.",
    counterpickKicker: "DRAFT ASSISTANT", counterpickTitle: "Heroes that counter", counterpickText: "Scored against the full enemy lineup, with extra weight on the marked carry.", bestPick: "BEST PICK", teamWr: "LINEUP SCORE", carryWr: "VS. CARRY", useHero: "PLAY THIS HERO", coverage: "matchups covered", currentPick: "CURRENT PICK",
  },
  de: {
    home: "Counterbuild Startseite", heroKicker: "DEADLOCK MATCHUP-ANALYSE",
    heroTitleA: "Baue für den Kampf,", heroTitleB: "der gerade passiert.",
    heroText: "Wähle deinen Helden, markiere den gegnerischen Carry und erhalte Item-Empfehlungen aus echten Matchup-Daten.",
    yourHero: "DEIN HELD", youPlay: "DU SPIELST", chooseHero: "Deinen Helden auswählen",
    enemyTeam: "GEGNERISCHES TEAM", chooseEnemy: "Gegner auswählen", addEnemy: "+ Gegner", remove: "Entfernen", importScreen: "SCREENSHOT IMPORTIEREN",
    focusTarget: "FOKUS-ZIEL", enemyCarry: "GEGNERISCHER CARRY", matchupWr: "DEINE MATCHUP-WR",
    analyze: "MATCHUP ANALYSIEREN →", analyzing: "ANALYSE LÄUFT …",
    liveRec: "LIVE-EMPFEHLUNG", bestBuys: "Deine besten Käufe", against: "gegen",
    currentMinute: "AKTUELLE MINUTE", filters: "INTELLIGENTE FILTER", category: "KATEGORIE", all: "Alle",
    weapon: "Waffe", vitality: "Vitalität", spirit: "Spirit", minSample: "MIN. STICHPROBE", sort: "SORTIERUNG",
    recommended: "Empfehlung", winrate: "Winrate", sample: "Stichprobe", cost: "Kosten",
    matchup: "MATCHUP", games: "SPIELE", focus: "FOKUS", items: "ITEMS GEFUNDEN",
    winrateLabel: "WINRATE", buyTime: "KAUFZEIT", vsCarry: "Prozentpunkte gegen die Helden-Basis",
    copyBuild: "TOP-BUILD KOPIEREN", copied: "BUILD KOPIERT ✓", share: "MATCHUP TEILEN", linkCopied: "LINK KOPIERT ✓", empty: "Keine Items passen zu diesen Filtern. Versuche eine kleinere Stichprobe.",
    methodTitle: "So wird gerankt:", method: "Carry-Matchup, gesamtes Gegnerteam, Basis-Winrate deines Helden und Stichprobenqualität werden gewichtet. Korrelation ist keine Garantie—passe den Kauf an den Spielstand an.",
    updated: "AKTUALISIERT", assetError: "Heldendaten sind momentan nicht erreichbar.", statsError: "Die Live-Statistiken sind gerade nicht erreichbar. Bitte versuche es erneut.",
    footer: "Community-Projekt · Daten von", disclaimer: "· Nicht mit Valve verbunden.", early: "EARLY", mid: "MID GAME", late: "LATE",
    importerTitle: "Gegnerteam importieren", importerText: "Lade einen Match-Screenshot hoch, auf dem die gegnerischen Heldennamen sichtbar sind. Die Erkennung läuft lokal auf deinem Gerät.",
    dropTitle: "Match-Screenshot hier ablegen", dropText: "oder klicken, um PNG, JPG oder WebP auszuwählen", scanning: "HELDENNAMEN WERDEN GELESEN", detected: "ERKANNTE HELDEN", confidence: "Treffer",
    importHeroes: "AUSGEWÄHLTE HELDEN IMPORTIEREN", scanAgain: "ANDEREN SCREENSHOT WÄHLEN", noHeroes: "Keine Heldennamen erkannt. Versuche einen schärferen Screenshot mit vollständig sichtbarem Scoreboard.", close: "Screenshot-Import schließen", localOnly: "PRIVAT · DAS BILD BLEIBT AUF DEINEM GERÄT",
    moreOptions: "MEHR OPTIONEN", apiFilters: "MATCH-DATEN", queue: "WARTESCHLANGE", both: "Ranked + Unranked", ranked: "Nur Ranked", unranked: "Nur Unranked", dataWindow: "ZEITRAUM", days: "Tage", laneOnly: "NUR GLEICHE LANE",
    itemRules: "ITEM-REGELN", maxBudget: "MAX. BUDGET", noLimit: "Kein Limit", itemTier: "ITEM-TIER", anyTier: "Alle Tiers", resultCount: "ANZAHL ERGEBNISSE", positiveLift: "NUR POSITIVER LIFT", reanalyzeHint: "Warteschlange, Zeitraum und Lane-Filter gelten nach der nächsten Matchup-Analyse.",
    counterpickKicker: "DRAFT-ASSISTENT", counterpickTitle: "Helden als Counter", counterpickText: "Bewertet gegen das gesamte Gegnerteam, mit zusätzlichem Gewicht auf dem markierten Carry.", bestPick: "BESTER PICK", teamWr: "LINEUP-SCORE", carryWr: "GEGEN CARRY", useHero: "DIESEN HELDEN SPIELEN", coverage: "Matchups abgedeckt", currentPick: "AKTUELLER PICK",
  },
} as const;

const phaseRanges: Record<Phase, [number, number]> = { early: [0, 660], mid: [540, 1260], late: [1080, Infinity] };

function adjustedRate(stat?: ItemStat) { return stat ? (stat.wins + 60) / (stat.matches + 120) : 0.5; }
function pct(value: number) { return `${(value * 100).toFixed(1)}%`; }
function formatMatches(value: number, lang: Lang) { return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatTime(seconds: number, lang: Lang) { return `~${Math.max(0, Math.round(seconds / 60))} ${lang === "de" ? "Min." : "min"}`; }

function normalizeText(value: string) { return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, ""); }
function editDistance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}
function detectHeroNames(text: string, heroes: Hero[], ownHeroId: number): Detection[] {
  const compactText = normalizeText(text);
  const words = text.split(/\s+/).map(normalizeText).filter(Boolean);
  return heroes.filter((hero) => hero.id !== ownHeroId).map((hero) => {
    const target = normalizeText(hero.name);
    if (compactText.includes(target)) return { id: hero.id, confidence: 1 };
    let best = 0;
    for (let size = 1; size <= 3; size += 1) {
      for (let index = 0; index <= words.length - size; index += 1) {
        const candidate = words.slice(index, index + size).join("");
        const similarity = 1 - editDistance(target, candidate) / Math.max(target.length, candidate.length, 1);
        if (similarity > best) best = similarity;
      }
    }
    return { id: hero.id, confidence: best };
  }).filter((entry) => entry.confidence >= (normalizeText(heroes.find((hero) => hero.id === entry.id)?.name ?? "").length <= 4 ? .78 : .66)).sort((a, b) => b.confidence - a.confidence).slice(0, 8);
}

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
  const [queueMode, setQueueMode] = useState<QueueMode>("all");
  const [dataWindow, setDataWindow] = useState(30);
  const [laneOnly, setLaneOnly] = useState(false);
  const [maxBudget, setMaxBudget] = useState(0);
  const [itemTier, setItemTier] = useState(0);
  const [resultCount, setResultCount] = useState(8);
  const [positiveLiftOnly, setPositiveLiftOnly] = useState(false);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [matchup, setMatchup] = useState<CounterStat | null>(null);
  const [allCounterStats, setAllCounterStats] = useState<CounterStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [importerOpen, setImporterOpen] = useState(false);
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrComplete, setOcrComplete] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [selectedDetections, setSelectedDetections] = useState<number[]>([]);
  const t = copy[lang];
  const phase: Phase = gameMinute < 11 ? "early" : gameMinute < 21 ? "mid" : "late";

  const heroMap = useMemo(() => new Map(heroes.map((hero) => [hero.id, hero])), [heroes]);
  const ownHero = heroMap.get(heroId);
  const carryHero = heroMap.get(carryId);

  useEffect(() => {
    const saved = window.localStorage.getItem("counterbuild-language");
    if (saved === "de" || saved === "en") setLang(saved);
    const params = new URLSearchParams(window.location.search);
    const sharedHero = Number(params.get("hero")), sharedCarry = Number(params.get("carry"));
    const sharedEnemies = (params.get("enemies") ?? "").split(",").map(Number).filter((id) => Number.isFinite(id) && id > 0).slice(0, 6);
    if (sharedHero) setHeroId(sharedHero);
    if (sharedEnemies.length) setEnemyIds(sharedEnemies);
    if (sharedCarry) setCarryId(sharedCarry);
    const minute = Number(params.get("minute")); if (minute >= 1 && minute <= 40) setGameMinute(minute);
    const queue = params.get("queue"); if (queue === "ranked" || queue === "unranked") setQueueMode(queue);
    const windowDays = Number(params.get("window")); if ([7, 30, 90].includes(windowDays)) setDataWindow(windowDays);
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
      const commonParams = new URLSearchParams({ min_matches: "80", game_mode: "normal", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - dataWindow * 86400) });
      if (queueMode !== "all") commonParams.set("match_mode", queueMode);
      const common = commonParams.toString();
      const matchupParams = new URLSearchParams(commonParams); matchupParams.set("same_lane_filter", String(laneOnly));
      const matchupCommon = matchupParams.toString();
      const [baseStats, teamStats, carryStats, counterStats] = await Promise.all([
        fetch(`${API}/analytics/item-stats?hero_ids=${heroId}&${common}`).then((r) => r.json()),
        fetch(`${API}/analytics/item-stats?hero_ids=${heroId}&enemy_hero_ids=${enemyIds.join(",")}&${matchupCommon}`).then((r) => r.json()),
        fetch(`${API}/analytics/item-stats?hero_ids=${heroId}&enemy_hero_ids=${carryId}&${matchupCommon}`).then((r) => r.json()),
        fetch(`${API}/analytics/hero-counter-stats?${matchupCommon}`).then((r) => r.json()),
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
      setAllCounterStats(counterStats);
      setMatchup(counterStats.find((stat) => stat.hero_id === heroId && stat.enemy_hero_id === carryId) ?? null);
      setUpdatedAt(new Date());
    } catch { setError(copy[lang].statsError); }
    finally { setLoading(false); }
  }, [carryId, dataWindow, enemyIds, heroId, items, laneOnly, lang, queueMode]);

  useEffect(() => { if (items.length) void analyze(); }, [items]);

  const visibleRecommendations = useMemo(() => {
    const [start, end] = phaseRanges[phase];
    const filtered = recommendations.filter((entry) => entry.buyTime >= start && entry.buyTime <= end && entry.matches >= minSample && (category === "all" || entry.item.item_slot_type === category) && (!maxBudget || (entry.item.cost ?? 0) <= maxBudget) && (!itemTier || entry.item.item_tier === itemTier) && (!positiveLiftOnly || entry.carryRate > entry.baselineRate));
    return filtered.sort((a, b) => sortMode === "winrate" ? b.carryRate - a.carryRate : sortMode === "sample" ? b.matches - a.matches : sortMode === "cost" ? (a.item.cost ?? 0) - (b.item.cost ?? 0) : b.score - a.score).slice(0, resultCount);
  }, [category, itemTier, maxBudget, minSample, phase, positiveLiftOnly, recommendations, resultCount, sortMode]);

  const counterPicks = useMemo<CounterPick[]>(() => {
    if (!allCounterStats.length || !enemyIds.length) return [];
    const statsMap = new Map(allCounterStats.map((stat) => [`${stat.hero_id}:${stat.enemy_hero_id}`, stat]));
    return heroes.filter((hero) => !enemyIds.includes(hero.id)).map((hero) => {
      let weightedRate = 0, totalWeight = 0, matches = 0, coverage = 0, carryRate = .5;
      enemyIds.forEach((enemyId) => {
        const stat = statsMap.get(`${hero.id}:${enemyId}`);
        if (!stat) return;
        const rate = (stat.wins + 50) / (stat.matches_played + 100);
        const weight = enemyId === carryId ? 2 : 1;
        weightedRate += rate * weight; totalWeight += weight; matches += stat.matches_played; coverage += 1;
        if (enemyId === carryId) carryRate = rate;
      });
      if (!totalWeight) return null;
      const coverageFactor = .8 + .2 * (coverage / enemyIds.length);
      return { hero, score: (weightedRate / totalWeight) * coverageFactor, carryRate, matches, coverage };
    }).filter((entry): entry is CounterPick => Boolean(entry)).sort((a, b) => b.score - a.score).slice(0, 4);
  }, [allCounterStats, carryId, enemyIds, heroes]);

  function addEnemy() { if (enemyToAdd !== heroId && !enemyIds.includes(enemyToAdd) && enemyIds.length < 6) setEnemyIds((current) => [...current, enemyToAdd]); }
  function removeEnemy(id: number) { const next = enemyIds.filter((enemyId) => enemyId !== id); setEnemyIds(next); if (carryId === id && next.length) setCarryId(next[0]); }
  function submit(event: FormEvent) { event.preventDefault(); void analyze(); }
  async function readScreenshot(file: File) {
    if (!file.type.startsWith("image/")) return;
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    setScreenshotUrl(URL.createObjectURL(file)); setOcrRunning(true); setOcrComplete(false); setOcrProgress(0); setDetections([]); setSelectedDetections([]);
    let worker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null;
    try {
      const { createWorker } = await import("tesseract.js");
      worker = await createWorker("eng", 1, { logger: (message) => { if (message.status === "recognizing text") setOcrProgress(Math.round(message.progress * 100)); } });
      const result = await worker.recognize(file);
      const found = detectHeroNames(result.data.text, heroes, heroId);
      setDetections(found); setSelectedDetections(found.slice(0, 6).map((entry) => entry.id)); setOcrComplete(true);
    } catch { setDetections([]); setOcrComplete(true); }
    finally { if (worker) await worker.terminate(); setOcrRunning(false); }
  }
  function closeImporter() { if (screenshotUrl) URL.revokeObjectURL(screenshotUrl); setScreenshotUrl(""); setImporterOpen(false); setDetections([]); setSelectedDetections([]); setOcrComplete(false); }
  function importDetectedHeroes() {
    const ids = selectedDetections.filter((id) => id !== heroId).slice(0, 6);
    if (!ids.length) return;
    setEnemyIds(ids); if (!ids.includes(carryId)) setCarryId(ids[0]); closeImporter();
  }
  async function copyTopBuild() {
    const text = `${ownHero?.name ?? "Hero"} vs ${carryHero?.name ?? "Carry"}: ${visibleRecommendations.slice(0, 5).map((entry, index) => `${index + 1}. ${entry.item.name}`).join(" · ")}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2200); } catch { setCopied(false); }
  }
  async function shareMatchup() {
    const params = new URLSearchParams({ hero: String(heroId), enemies: enemyIds.join(","), carry: String(carryId), minute: String(gameMinute), queue: queueMode, window: String(dataWindow) });
    const url = `${window.location.origin}${window.location.pathname}?${params}`;
    try { await navigator.clipboard.writeText(url); window.history.replaceState(null, "", url); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 2200); } catch { setLinkCopied(false); }
  }
  function selectCounterPick(id: number) {
    setHeroId(id);
    document.getElementById("top")?.scrollIntoView({ behavior: "smooth" });
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
          <button className="import-trigger" type="button" onClick={() => setImporterOpen(true)}><span>▣</span> {t.importScreen}</button>
        </div>
        <div className="step-block carry-block">
          <div className="step-label"><span>03</span> {t.focusTarget}</div>
          <div className="carry-card"><HeroPortrait hero={carryHero} /><div><small>{t.enemyCarry}</small><strong>{carryHero?.name ?? "–"}</strong></div>{matchupWinRate !== null && <div className="threat"><small>{t.matchupWr}</small><strong>{pct(matchupWinRate)}</strong></div>}</div>
          <button className="analyze-button" disabled={loading || !enemyIds.length} type="submit">{loading ? t.analyzing : t.analyze}</button>
        </div>
      </form>

      {Boolean(counterPicks.length) && <section className="counterpick-section">
        <div className="counterpick-heading"><div><div className="eyebrow">{t.counterpickKicker}</div><h2>{t.counterpickTitle} <span>{enemyIds.length > 1 ? t.enemyTeam : carryHero?.name}</span></h2></div><p>{t.counterpickText}</p></div>
        <div className="counterpick-grid">{counterPicks.map((pick, index) => <article className={pick.hero.id === heroId ? "current" : ""} key={pick.hero.id}>
          <div className="pick-rank">{index === 0 ? t.bestPick : `#0${index + 1}`}</div>
          <div className="pick-hero"><HeroPortrait hero={pick.hero} /><div><h3>{pick.hero.name}</h3><small>{pick.coverage}/{enemyIds.length} {t.coverage}</small></div></div>
          <div className="pick-metrics"><div><small>{t.teamWr}</small><strong>{pct(pick.score)}</strong></div><div><small>{t.carryWr}</small><strong>{pct(pick.carryRate)}</strong></div><div><small>{t.sample}</small><strong>{formatMatches(pick.matches, lang)}</strong></div></div>
          <button type="button" onClick={() => selectCounterPick(pick.hero.id)} disabled={pick.hero.id === heroId}>{pick.hero.id === heroId ? t.currentPick : `${t.useHero} →`}</button>
        </article>)}</div>
      </section>}

      <section className="results" aria-live="polite">
        <div className="results-heading"><div><div className="eyebrow">{t.liveRec}</div><h2>{t.bestBuys} <span>{t.against} {carryHero?.name}</span></h2></div><div className="result-actions"><button className="copy-build" onClick={shareMatchup}>{linkCopied ? t.linkCopied : t.share}</button><button className="copy-build" onClick={copyTopBuild} disabled={!visibleRecommendations.length}>{copied ? t.copied : t.copyBuild}</button></div></div>

        <div className="match-context">
          <label className="minute-control"><span><small>{t.currentMinute}</small><strong>{gameMinute}:00</strong></span><input type="range" min="1" max="40" value={gameMinute} onChange={(event) => setGameMinute(Number(event.target.value))} /><div className="phase-tabs">{(["early", "mid", "late"] as Phase[]).map((value) => <button type="button" key={value} className={phase === value ? "active" : ""} onClick={() => setGameMinute(value === "early" ? 7 : value === "mid" ? 15 : 26)}>{t[value]}</button>)}</div></label>
          <div className="quick-stats"><div><small>{t.matchup}</small><strong>{matchupWinRate === null ? "—" : pct(matchupWinRate)}</strong></div><div><small>{t.games}</small><strong>{formatMatches(matchup?.matches_played ?? 0, lang)}</strong></div><div><small>{t.focus}</small><strong>{carryHero?.name ?? "—"}</strong></div><div><small>{t.items}</small><strong>{visibleRecommendations.length}</strong></div></div>
        </div>

        <div className="filter-bar"><div className="filter-title">{t.filters}</div><label><small>{t.category}</small><select value={category} onChange={(event) => setCategory(event.target.value as Category)}><option value="all">{t.all}</option><option value="weapon">{t.weapon}</option><option value="vitality">{t.vitality}</option><option value="spirit">{t.spirit}</option></select></label><label><small>{t.minSample}</small><select value={minSample} onChange={(event) => setMinSample(Number(event.target.value))}><option value="80">80+</option><option value="250">250+</option><option value="1000">1K+</option><option value="5000">5K+</option></select></label><label><small>{t.sort}</small><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="recommended">{t.recommended}</option><option value="winrate">{t.winrate}</option><option value="sample">{t.sample}</option><option value="cost">{t.cost}</option></select></label></div>

        <details className="advanced-options">
          <summary><span>＋</span> {t.moreOptions}</summary>
          <div className="advanced-grid">
            <section><div className="advanced-title">{t.apiFilters}</div><label><small>{t.queue}</small><select value={queueMode} onChange={(event) => setQueueMode(event.target.value as QueueMode)}><option value="all">{t.both}</option><option value="ranked">{t.ranked}</option><option value="unranked">{t.unranked}</option></select></label><label><small>{t.dataWindow}</small><select value={dataWindow} onChange={(event) => setDataWindow(Number(event.target.value))}><option value="7">7 {t.days}</option><option value="30">30 {t.days}</option><option value="90">90 {t.days}</option></select></label><label className="toggle-option"><input type="checkbox" checked={laneOnly} onChange={(event) => setLaneOnly(event.target.checked)} /><span />{t.laneOnly}</label></section>
            <section><div className="advanced-title">{t.itemRules}</div><label><small>{t.maxBudget}</small><select value={maxBudget} onChange={(event) => setMaxBudget(Number(event.target.value))}><option value="0">{t.noLimit}</option><option value="800">800</option><option value="1600">1,600</option><option value="3200">3,200</option><option value="6400">6,400</option></select></label><label><small>{t.itemTier}</small><select value={itemTier} onChange={(event) => setItemTier(Number(event.target.value))}><option value="0">{t.anyTier}</option><option value="1">Tier 1</option><option value="2">Tier 2</option><option value="3">Tier 3</option><option value="4">Tier 4</option></select></label></section>
            <section><div className="advanced-title">OUTPUT</div><label><small>{t.resultCount}</small><select value={resultCount} onChange={(event) => setResultCount(Number(event.target.value))}><option value="4">4</option><option value="8">8</option><option value="12">12</option></select></label><label className="toggle-option"><input type="checkbox" checked={positiveLiftOnly} onChange={(event) => setPositiveLiftOnly(event.target.checked)} /><span />{t.positiveLift}</label><p>{t.reanalyzeHint}</p></section>
          </div>
        </details>

        {error && <div className="error-card">{error}</div>}
        {!error && loading && <div className="loading-grid">{[1,2,3,4].map((n) => <div key={n} />)}</div>}
        {!error && !loading && !visibleRecommendations.length && <div className="empty-card">{t.empty}</div>}
        {!error && !loading && Boolean(visibleRecommendations.length) && <div className="item-grid">{visibleRecommendations.map((entry, index) => { const lift = (entry.carryRate - entry.baselineRate) * 100; return <article className={`item-card slot-${entry.item.item_slot_type}`} key={entry.item.id}><div className="rank">#{String(index + 1).padStart(2, "0")}</div><div className="item-icon">{entry.item.shop_image_webp ? <img src={entry.item.shop_image_webp} alt="" /> : <span>◆</span>}</div><div className="item-main"><div className="item-meta"><span>{entry.item.item_slot_type && t[entry.item.item_slot_type]}</span><span>T{entry.item.item_tier}</span></div><h3>{entry.item.name}</h3><div className="item-reason">{lift >= 0 ? "+" : ""}{lift.toFixed(1)} {t.vsCarry}</div></div><div className="item-stat"><small>{t.winrateLabel}</small><strong>{pct(entry.carryRate)}</strong></div><div className="item-stat"><small>{t.sample}</small><strong>{formatMatches(entry.matches, lang)}</strong></div><div className="item-stat"><small>{t.buyTime}</small><strong>{formatTime(entry.buyTime, lang)}</strong></div><div className="cost">◈ {entry.item.cost?.toLocaleString(lang === "de" ? "de-DE" : "en-US")}</div></article>; })}</div>}

        <div className="method-note"><span>i</span><p><strong>{t.methodTitle}</strong> {t.method}</p>{updatedAt && <time>{t.updated} {updatedAt.toLocaleTimeString(lang === "de" ? "de-DE" : "en-US", { hour: "2-digit", minute: "2-digit" })}</time>}</div>
      </section>

      <footer><div className="brand"><span className="brand-mark">CB</span><span><strong>COUNTER</strong>BUILD</span></div><p>{t.footer} <a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">Deadlock API</a> {t.disclaimer}</p></footer>

      {importerOpen && <div className="import-overlay" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="import-modal">
          <button className="modal-close" type="button" onClick={closeImporter} aria-label={t.close}>×</button>
          <div className="eyebrow">AUTO TEAM IMPORT · OCR</div>
          <h2 id="import-title">{t.importerTitle}</h2>
          <p className="import-intro">{t.importerText}</p>
          <div className="privacy-note">● {t.localOnly}</div>

          {!screenshotUrl && <label className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void readScreenshot(file); }}>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readScreenshot(file); }} />
            <span className="upload-glyph">▣</span><strong>{t.dropTitle}</strong><small>{t.dropText}</small>
          </label>}

          {screenshotUrl && <div className="scan-layout">
            <div className="screenshot-preview"><img src={screenshotUrl} alt="Match screenshot preview" />{ocrRunning && <div className="scan-line" />}</div>
            <div className="scan-results">
              {ocrRunning && <div className="ocr-progress"><div><span style={{ width: `${ocrProgress}%` }} /></div><strong>{t.scanning} · {ocrProgress}%</strong></div>}
              {ocrComplete && <><div className="detected-title"><span>{t.detected}</span><b>{detections.length}</b></div>{detections.length ? <div className="detected-list">{detections.map((entry) => { const hero = heroMap.get(entry.id); const selected = selectedDetections.includes(entry.id); return <label className={selected ? "selected" : ""} key={entry.id}><input type="checkbox" checked={selected} onChange={() => setSelectedDetections((current) => current.includes(entry.id) ? current.filter((id) => id !== entry.id) : current.length < 6 ? [...current, entry.id] : current)} /><HeroPortrait hero={hero} size="small" /><span><strong>{hero?.name}</strong><small>{Math.round(entry.confidence * 100)}% {t.confidence}</small></span><i>{selected ? "✓" : "+"}</i></label>; })}</div> : <div className="ocr-empty">{t.noHeroes}</div>}</>}
            </div>
          </div>}

          {screenshotUrl && <div className="import-actions"><label className="rescan-button"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readScreenshot(file); }} />{t.scanAgain}</label><button type="button" onClick={importDetectedHeroes} disabled={!selectedDetections.length || ocrRunning}>{t.importHeroes} ({selectedDetections.length}/6) →</button></div>}
        </div>
      </div>}
    </main>
  );
}
