"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

const API = "https://api.deadlock-api.com/v1";

type Hero = {
  id: number;
  name: string;
  images?: {
    icon_image_small_webp?: string;
    icon_hero_card_webp?: string;
  };
};

type Item = {
  id: number;
  name: string;
  cost: number | null;
  item_tier: number | null;
  item_slot_type: "weapon" | "vitality" | "spirit" | null;
  shopable: boolean;
  shop_image_webp?: string;
};

type ItemStat = {
  item_id: number;
  wins: number;
  losses: number;
  matches: number;
  players: number;
  avg_buy_time_s: number;
};

type CounterStat = {
  hero_id: number;
  enemy_hero_id: number;
  wins: number;
  matches_played: number;
};

type Recommendation = {
  item: Item;
  score: number;
  winRate: number;
  baselineRate: number;
  carryRate: number;
  matches: number;
  buyTime: number;
};

type Phase = "early" | "mid" | "late";

const phaseRanges: Record<Phase, [number, number]> = {
  early: [0, 660],
  mid: [540, 1260],
  late: [1080, Number.POSITIVE_INFINITY],
};

function adjustedRate(stat?: ItemStat) {
  if (!stat) return 0.5;
  return (stat.wins + 60) / (stat.matches + 120);
}

function pct(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatMatches(value: number) {
  return new Intl.NumberFormat("de-DE", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatTime(seconds: number) {
  const minutes = Math.max(0, Math.round(seconds / 60));
  return `~${minutes} Min.`;
}

function HeroPortrait({ hero, size = "normal" }: { hero?: Hero; size?: "small" | "normal" }) {
  if (!hero) return <span className={`portrait portrait-${size} portrait-empty`}>?</span>;
  return (
    <span className={`portrait portrait-${size}`}>
      {hero.images?.icon_image_small_webp ? (
        <img src={hero.images.icon_image_small_webp} alt="" />
      ) : (
        hero.name.slice(0, 1)
      )}
    </span>
  );
}

export default function Home() {
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [heroId, setHeroId] = useState(1);
  const [enemyIds, setEnemyIds] = useState<number[]>([13, 3, 6]);
  const [carryId, setCarryId] = useState(13);
  const [enemyToAdd, setEnemyToAdd] = useState(2);
  const [phase, setPhase] = useState<Phase>("mid");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [matchup, setMatchup] = useState<CounterStat | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const heroMap = useMemo(() => new Map(heroes.map((hero) => [hero.id, hero])), [heroes]);
  const ownHero = heroMap.get(heroId);
  const carryHero = heroMap.get(carryId);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(`${API}/assets/heroes?language=german&only_active=true`).then((response) => response.json()),
      fetch(`${API}/assets/items?language=german`).then((response) => response.json()),
    ])
      .then(([heroData, itemData]: [Hero[], Item[]]) => {
        if (!active) return;
        setHeroes(heroData.sort((a, b) => a.name.localeCompare(b.name, "de")));
        setItems(itemData.filter((item) => item.shopable && item.cost && item.item_tier));
      })
      .catch(() => active && setError("Heldendaten konnten gerade nicht geladen werden."));
    return () => {
      active = false;
    };
  }, []);

  const analyze = useCallback(async () => {
    if (!items.length || !enemyIds.length) return;
    setLoading(true);
    setError("");
    try {
      const enemyList = enemyIds.join(",");
      const common = "min_matches=80&game_mode=normal";
      const [baseStats, teamStats, carryStats, counterStats] = await Promise.all([
        fetch(`${API}/analytics/item-stats?hero_ids=${heroId}&${common}`).then((r) => r.json()),
        fetch(`${API}/analytics/item-stats?hero_ids=${heroId}&enemy_hero_ids=${enemyList}&${common}`).then((r) => r.json()),
        fetch(`${API}/analytics/item-stats?hero_ids=${heroId}&enemy_hero_ids=${carryId}&${common}`).then((r) => r.json()),
        fetch(`${API}/analytics/hero-counter-stats?same_lane_filter=false&min_matches=80&game_mode=normal`).then((r) => r.json()),
      ] as const) as [ItemStat[], ItemStat[], ItemStat[], CounterStat[]];

      const baseMap = new Map(baseStats.map((stat) => [stat.item_id, stat]));
      const teamMap = new Map(teamStats.map((stat) => [stat.item_id, stat]));
      const carryMap = new Map(carryStats.map((stat) => [stat.item_id, stat]));
      const ranked = items
        .map((item) => {
          const base = baseMap.get(item.id);
          const team = teamMap.get(item.id);
          const carry = carryMap.get(item.id);
          if (!team || !carry) return null;
          const baselineRate = adjustedRate(base);
          const winRate = adjustedRate(team);
          const carryRate = adjustedRate(carry);
          const sampleConfidence = Math.min(1, Math.log10(Math.max(10, carry.matches)) / 4.7);
          const uplift = Math.max(-0.06, Math.min(0.06, carryRate - baselineRate));
          const score = (carryRate * 0.5 + winRate * 0.3 + baselineRate * 0.2 + uplift * 0.35) * sampleConfidence;
          return {
            item,
            score,
            winRate,
            baselineRate,
            carryRate,
            matches: carry.matches,
            buyTime: carry.avg_buy_time_s,
          } satisfies Recommendation;
        })
        .filter((value): value is Recommendation => Boolean(value))
        .sort((a, b) => b.score - a.score);

      setRecommendations(ranked);
      setMatchup(
        counterStats.find((stat) => stat.hero_id === heroId && stat.enemy_hero_id === carryId) ?? null,
      );
      setUpdatedAt(new Date());
    } catch {
      setError("Die Live-Statistiken sind gerade nicht erreichbar. Bitte versuche es gleich noch einmal.");
    } finally {
      setLoading(false);
    }
  }, [carryId, enemyIds, heroId, items]);

  useEffect(() => {
    if (items.length) void analyze();
  }, [items]); // initial analysis only

  const visibleRecommendations = useMemo(() => {
    const [start, end] = phaseRanges[phase];
    const inPhase = recommendations.filter((entry) => entry.buyTime >= start && entry.buyTime <= end);
    return (inPhase.length >= 4 ? inPhase : recommendations).slice(0, 8);
  }, [phase, recommendations]);

  function addEnemy() {
    if (enemyToAdd === heroId || enemyIds.includes(enemyToAdd) || enemyIds.length >= 6) return;
    setEnemyIds((current) => [...current, enemyToAdd]);
  }

  function removeEnemy(id: number) {
    const next = enemyIds.filter((enemyId) => enemyId !== id);
    setEnemyIds(next);
    if (carryId === id && next.length) setCarryId(next[0]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void analyze();
  }

  const matchupWinRate = matchup ? matchup.wins / matchup.matches_played : null;

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="Counterbuild Startseite">
          <span className="brand-mark">CB</span>
          <span><strong>COUNTER</strong>BUILD</span>
        </a>
        <div className="live-pill"><span /> LIVE MATCH DATA</div>
      </header>

      <section className="hero-section" id="top">
        <div className="eyebrow">DEADLOCK MATCHUP INTELLIGENCE</div>
        <h1>Baue für den Kampf,<br /><em>der gerade passiert.</em></h1>
        <p>Wähle deinen Helden, markiere den gegnerischen Carry und erhalte Item-Empfehlungen aus echten Matchup-Daten.</p>
      </section>

      <form className="analyzer" onSubmit={submit}>
        <div className="step-block">
          <div className="step-label"><span>01</span> DEIN HELD</div>
          <label className="select-card">
            <HeroPortrait hero={ownHero} />
            <span>
              <small>DU SPIELST</small>
              <select value={heroId} onChange={(event) => setHeroId(Number(event.target.value))} aria-label="Deinen Helden auswählen">
                {heroes.map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}
              </select>
            </span>
          </label>
        </div>

        <div className="step-block enemy-block">
          <div className="step-label"><span>02</span> GEGNERISCHES TEAM <b>{enemyIds.length}/6</b></div>
          <div className="enemy-list">
            {enemyIds.map((id) => {
              const hero = heroMap.get(id);
              return (
                <button className={`enemy-chip ${id === carryId ? "is-carry" : ""}`} type="button" key={id} onClick={() => setCarryId(id)}>
                  <HeroPortrait hero={hero} size="small" />
                  <span>{hero?.name}</span>
                  {id === carryId && <b>CARRY</b>}
                  <i onClick={(event) => { event.stopPropagation(); removeEnemy(id); }} aria-label={`${hero?.name} entfernen`}>×</i>
                </button>
              );
            })}
          </div>
          <div className="add-enemy">
            <select value={enemyToAdd} onChange={(event) => setEnemyToAdd(Number(event.target.value))} aria-label="Gegner auswählen">
              {heroes.filter((hero) => hero.id !== heroId && !enemyIds.includes(hero.id)).map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}
            </select>
            <button type="button" onClick={addEnemy} disabled={enemyIds.length >= 6}>+ Gegner</button>
          </div>
        </div>

        <div className="step-block carry-block">
          <div className="step-label"><span>03</span> FOKUS-ZIEL</div>
          <div className="carry-card">
            <HeroPortrait hero={carryHero} />
            <div><small>GEGNERISCHER CARRY</small><strong>{carryHero?.name ?? "–"}</strong></div>
            {matchupWinRate !== null && <div className="threat"><small>DEINE MATCHUP-WR</small><strong>{pct(matchupWinRate)}</strong></div>}
          </div>
          <button className="analyze-button" disabled={loading || !enemyIds.length} type="submit">
            {loading ? "ANALYSE LÄUFT …" : "MATCHUP ANALYSIEREN →"}
          </button>
        </div>
      </form>

      <section className="results" aria-live="polite">
        <div className="results-heading">
          <div>
            <div className="eyebrow">LIVE EMPFEHLUNG</div>
            <h2>Deine besten Käufe <span>gegen {carryHero?.name}</span></h2>
          </div>
          <div className="phase-tabs" aria-label="Spielphase">
            {(["early", "mid", "late"] as Phase[]).map((value) => (
              <button key={value} className={phase === value ? "active" : ""} onClick={() => setPhase(value)}>
                {value === "early" ? "EARLY" : value === "mid" ? "MID GAME" : "LATE"}
              </button>
            ))}
          </div>
        </div>

        {error && <div className="error-card">{error}</div>}
        {!error && loading && <div className="loading-grid">{[1,2,3,4].map((n) => <div key={n} />)}</div>}
        {!error && !loading && (
          <div className="item-grid">
            {visibleRecommendations.map((entry, index) => {
              const lift = (entry.carryRate - entry.baselineRate) * 100;
              return (
                <article className={`item-card slot-${entry.item.item_slot_type}`} key={entry.item.id}>
                  <div className="rank">#{String(index + 1).padStart(2, "0")}</div>
                  <div className="item-icon">
                    {entry.item.shop_image_webp ? <img src={entry.item.shop_image_webp} alt="" /> : <span>◆</span>}
                  </div>
                  <div className="item-main">
                    <div className="item-meta"><span>{entry.item.item_slot_type}</span><span>T{entry.item.item_tier}</span></div>
                    <h3>{entry.item.name}</h3>
                    <div className="item-reason">
                      {lift >= 0 ? `+${lift.toFixed(1)}` : lift.toFixed(1)} Prozentpunkte gegen den Carry
                    </div>
                  </div>
                  <div className="item-stat"><small>WINRATE</small><strong>{pct(entry.carryRate)}</strong></div>
                  <div className="item-stat"><small>SAMPLE</small><strong>{formatMatches(entry.matches)}</strong></div>
                  <div className="item-stat"><small>KAUFZEIT</small><strong>{formatTime(entry.buyTime)}</strong></div>
                  <div className="cost">◈ {entry.item.cost?.toLocaleString("de-DE")}</div>
                </article>
              );
            })}
          </div>
        )}

        <div className="method-note">
          <span>i</span>
          <p><strong>So wird gerankt:</strong> Carry-Matchup, gesamtes Gegnerteam, Basis-Winrate deines Helden und Stichprobengröße werden gewichtet. Korrelation ist keine Garantie – passe den Kauf immer an den aktuellen Spielstand an.</p>
          {updatedAt && <time>AKTUALISIERT {updatedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</time>}
        </div>
      </section>

      <footer>
        <div className="brand"><span className="brand-mark">CB</span><span><strong>COUNTER</strong>BUILD</span></div>
        <p>Community-Projekt · Daten von <a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">Deadlock API</a> · Nicht mit Valve verbunden.</p>
      </footer>
    </main>
  );
}
