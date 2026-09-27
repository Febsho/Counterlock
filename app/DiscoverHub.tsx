"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cachedJson } from "./lib/data/cache";
import { itemStatsUrl } from "./lib/data/deadlock-api";
import { formatRank } from "./lib/player-rank";
import { rankCohort } from "./lib/build-engine/personal-profile";
import { enemyTeamProfile } from "./lib/match-intelligence/team-profile";
import type { HeroAbilityEvidence } from "./lib/build-engine/hero-threats";

type Hero = { id: number; name: string; hero_type?: string | null; tags?: string[]; images?: { icon_image_small_webp?: string; icon_hero_card_webp?: string } };
type Item = { id: number; name: string; cost: number | null; item_tier: number | null; item_slot_type: string | null; shopable: boolean; shop_image_webp?: string };
type HeroStat = { hero_id: number; bucket: number; wins: number; losses: number; matches: number };
type ItemStat = { item_id: number; wins: number; losses: number; matches: number; avg_buy_time_s: number };
type Scoreboard = { hero_id: number; rank: number; value: number; matches: number };
type SteamProfile = { account_id: number; personaname: string; avatar: string; profileurl?: string };
type PlayerHeroStat = { hero_id: number; matches_played: number; wins: number; kills: number; deaths: number; assists: number; kills_per_min: number; deaths_per_min: number; assists_per_min: number; networth_per_min: number; damage_per_min: number; accuracy: number };
type PlayerRank = { account_id: number; badge: number; rank: number; subrank: number };
type PlayerMatch = { match_id: number; hero_id: number; start_time: number; match_duration_s: number; player_kills: number; player_deaths: number; player_assists: number; player_match_outcome: number; ranked_display_badge?: number | null };
type HeroAggregate = { hero_id: number; wins: number; losses: number; matches: number; total_kills: number; total_deaths: number; total_assists: number; total_player_damage: number; total_net_worth: number };
type MetricDistribution = { avg?: number; percentile25?: number; percentile50?: number; percentile75?: number; percentile90?: number };
type RecentMatch = { match_id: number; hero_id: number; start_time: number; match_duration_s: number; player_kills: number; player_deaths: number; player_assists: number; player_match_outcome: number };
type CounterStat = { hero_id: number; enemy_hero_id: number; wins: number; matches_played: number };
type SynergyStat = { hero_id1: number; hero_id2: number; wins: number; matches_played: number };
type HeroCombination = { hero_ids: number[]; wins: number; losses: number; matches: number };
type AbilityAsset = HeroAbilityEvidence & { id?: number; ability_id?: number };
type LaneMatchup = { hero_ids: number[]; enemy_hero_ids: number[]; wins: number; matches_played: number; sample_time_s: number; sample_matches: number; net_worth_diff: number; stats: Record<string, { diff: number; value: number }> };
type SoulCurve = { hero_ids: number[]; enemy_hero_ids: number[]; sample_times_s: number[]; sample_matches: number[]; matches_played: number; net_worth_diff: number[] };

const API = "https://api.deadlock-api.com/v1";
const SECTIONS = ["Items", "Meta", "Leaderboards", "Players", "My Stats", "Team Builder", "Lane Assistant"] as const;
type Section = typeof SECTIONS[number];
type LaneSuggestion = { heroId: number; allyHeroId: number; enemyHeroId: number; enemyAllyHeroId: number };
type Props = { heroes: Hero[]; items: Item[]; accountId: number | null; estimatedRank: number | null; initialSearch?: string; initialSection?: Section; laneSuggestion?: LaneSuggestion | null; onOpenBuild: (heroId: number) => void };

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="discover-select"><span>{label}</span><select value={value} onChange={(event) => onChange(event.target.value)}>{children}</select></label>;
}

function periodQuery(query: URLSearchParams, days: string) {
  const scoped = new URLSearchParams(query);
  scoped.set("min_unix_timestamp", String(Math.floor(Date.now() / 1000) - Number(days) * 86400));
  return scoped;
}

export function DiscoverHub({ heroes, items, accountId, estimatedRank, initialSearch, initialSection, laneSuggestion, onOpenBuild }: Props) {
  const [section, setSection] = useState<Section>(initialSection ?? "Items");
  const [mode, setMode] = useState("ranked");
  const [days, setDays] = useState("30");
  const [rankTier, setRankTier] = useState("all");
  const [itemStats, setItemStats] = useState<ItemStat[]>([]);
  const [heroStats, setHeroStats] = useState<HeroStat[]>([]);
  const [leaderboard, setLeaderboard] = useState<Scoreboard[]>([]);
  const [synergies, setSynergies] = useState<SynergyStat[]>([]);
  const [counters, setCounters] = useState<CounterStat[]>([]);
  const [combinations, setCombinations] = useState<HeroCombination[]>([]);
  const [laneMatchups, setLaneMatchups] = useState<LaneMatchup[]>([]);
  const [soulCurves, setSoulCurves] = useState<SoulCurve[]>([]);
  const [openingItems, setOpeningItems] = useState<ItemStat[]>([]);
  const [myStats, setMyStats] = useState<{ key: string; player: PlayerHeroStat[]; cohort: HeroAggregate[]; metrics: Record<string, MetricDistribution>; personalMetrics: Record<string, MetricDistribution>; history: RecentMatch[]; error: boolean } | null>(null);
  const [myHeroId, setMyHeroId] = useState(heroes[0]?.id ?? 0);
  const [loadStatus, setLoadStatus] = useState<{ key: string; error: boolean } | null>(null);
  const [search, setSearch] = useState(initialSearch ?? "");
  const [sort, setSort] = useState("winrate");
  const [itemCategory, setItemCategory] = useState("all");
  const [playerQuery, setPlayerQuery] = useState("");
  const [playerSearch, setPlayerSearch] = useState<SteamProfile[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<SteamProfile | null>(null);
  const [selectedPlayerStats, setSelectedPlayerStats] = useState<PlayerHeroStat[]>([]);
  const [selectedPlayerRank, setSelectedPlayerRank] = useState<PlayerRank | null>(null);
  const [selectedPlayerHistory, setSelectedPlayerHistory] = useState<PlayerMatch[]>([]);
  const [selectedPlayerMetrics, setSelectedPlayerMetrics] = useState<{ own: Record<string, MetricDistribution>; field: Record<string, MetricDistribution>; cohort: string } | null>(null);
  const [playerBusy, setPlayerBusy] = useState(false);
  const [playerError, setPlayerError] = useState(false);
  const [teamA, setTeamA] = useState<number[]>([]);
  const [teamB, setTeamB] = useState<number[]>([]);
  const [teamSearch, setTeamSearch] = useState("");
  const [teamAbilities, setTeamAbilities] = useState<Map<number, HeroAbilityEvidence[]>>(new Map());
  const [laneHero, setLaneHero] = useState(heroes[0]?.id ?? 0);
  const [laneAlly, setLaneAlly] = useState(heroes[1]?.id ?? 0);
  const [laneEnemy, setLaneEnemy] = useState(heroes[1]?.id ?? 0);
  const [laneEnemyAlly, setLaneEnemyAlly] = useState(heroes[0]?.id ?? 0);
  const playerRequestRef = useRef(0);
  const globalQuery = useMemo(() => {
    const query = new URLSearchParams({ game_mode: "normal" });
    if (mode !== "all") query.set("match_mode", mode);
    if (rankTier !== "all") { query.set("min_average_badge", String(Number(rankTier) * 10 + 1)); query.set("max_average_badge", String(Number(rankTier) * 10 + 6)); }
    return query;
  }, [mode, rankTier]);
  const requestKey = `${section}:${globalQuery.toString()}:${days}:${sort}:${teamA.join(",")}:${teamB.join(",")}`;
  const busy = section !== "My Stats" && loadStatus?.key !== requestKey;
  const error = section !== "My Stats" && loadStatus?.key === requestKey && loadStatus.error;

  const myStatsKey = `${accountId ?? "none"}:${myHeroId}:${days}:${estimatedRank ?? "all"}:${globalQuery.toString()}`;
  useEffect(() => {
    if (section !== "My Stats" || accountId == null) return;
    let active = true;
    const query = periodQuery(globalQuery, days);
    const cohort = rankTier === "all" ? rankCohort(estimatedRank) : null;
    if (cohort) { query.set("min_average_badge", String(cohort.min)); query.set("max_average_badge", String(cohort.max)); }
    const playerQuery = periodQuery(globalQuery, days); playerQuery.set("account_ids", String(accountId));
    if (cohort) { playerQuery.set("min_average_badge", String(cohort.min)); playerQuery.set("max_average_badge", String(cohort.max)); }
    const metricsQuery = new URLSearchParams(query); metricsQuery.set("hero_ids", String(myHeroId));
    const ownMetricsQuery = new URLSearchParams(metricsQuery); ownMetricsQuery.set("account_ids", String(accountId));
    void Promise.all([
      cachedJson<PlayerHeroStat[]>(`${API}/players/hero-stats?${playerQuery}`, 60 * 60 * 1000),
      cachedJson<HeroAggregate[]>(`${API}/analytics/hero-stats?${query}&bucket=no_bucket`, 60 * 60 * 1000),
      cachedJson<Record<string, MetricDistribution>>(`${API}/analytics/player-stats/metrics?${metricsQuery}`, 60 * 60 * 1000),
      cachedJson<Record<string, MetricDistribution>>(`${API}/analytics/player-stats/metrics?${ownMetricsQuery}`, 60 * 60 * 1000),
      cachedJson<RecentMatch[]>(`${API}/players/${accountId}/match-history`, 10 * 60 * 1000),
    ]).then(([player, cohortRows, metrics, personalMetrics, history]) => {
      if (active) setMyStats({ key: myStatsKey, player, cohort: cohortRows.filter((row) => row.hero_id === myHeroId), metrics, personalMetrics, history: history.slice().sort((a, b) => b.start_time - a.start_time).slice(0, 20), error: false });
    }).catch(() => { if (active) setMyStats({ key: myStatsKey, player: [], cohort: [], metrics: {}, personalMetrics: {}, history: [], error: true }); });
    return () => { active = false; };
  }, [accountId, days, estimatedRank, globalQuery, myHeroId, myStatsKey, rankTier, section]);
  const myStatsBusy = section === "My Stats" && accountId != null && myStats?.key !== myStatsKey;

  useEffect(() => {
    let active = true;
    const query = periodQuery(globalQuery, days);
    const requests: Promise<unknown>[] = [];
    if (section === "Items") { query.set("min_matches", "10"); requests.push(cachedJson<ItemStat[]>(`${API}/analytics/item-stats?${query}`, 60 * 60 * 1000)); }
    if (section === "Meta") { query.set("bucket", "start_time_week"); requests.push(cachedJson<HeroStat[]>(`${API}/analytics/hero-stats?${query}`, 60 * 60 * 1000)); }
    if (section === "Leaderboards") { query.set("sort_by", sort); query.set("sort_direction", "desc"); query.set("min_matches", "10"); query.set("limit", "100"); requests.push(cachedJson<Scoreboard[]>(`${API}/analytics/scoreboards/heroes?${query}`, 60 * 60 * 1000)); }
    if (section === "Team Builder") {
      const synergyQuery = periodQuery(globalQuery, days); synergyQuery.set("min_matches", "10"); synergyQuery.set("same_lane_filter", "false");
      requests.push(cachedJson<SynergyStat[]>(`${API}/analytics/hero-synergy-stats?${synergyQuery}`, 60 * 60 * 1000));
      const counterQuery = periodQuery(globalQuery, days); counterQuery.set("min_matches", "10"); counterQuery.set("same_lane_filter", "false");
      requests.push(cachedJson<CounterStat[]>(`${API}/analytics/hero-counter-stats?${counterQuery}`, 60 * 60 * 1000));
      if (teamA.length) { const combinationQuery = periodQuery(globalQuery, days); combinationQuery.set("include_hero_ids", teamA.join(",")); if (teamB.length) combinationQuery.set("include_enemy_hero_ids", teamB.join(",")); combinationQuery.set("comb_size", "6"); combinationQuery.set("min_matches", "3"); requests.push(cachedJson<HeroCombination[]>(`${API}/analytics/hero-comb-stats?${combinationQuery}`, 60 * 60 * 1000).catch(() => [])); }
    }
    if (section === "Lane Assistant") {
      const allies = [laneHero, laneAlly].sort((a, b) => a - b), enemies = [laneEnemy, laneEnemyAlly].sort((a, b) => a - b);
      const laneQuery = periodQuery(globalQuery, days); laneQuery.set("hero_ids", allies.join(",")); laneQuery.set("enemy_hero_ids", enemies.join(",")); laneQuery.set("min_matches", "5"); laneQuery.set("sample_time_s", "900"); laneQuery.set("stats", "player_damage,kills,denies"); laneQuery.set("group_by", "assigned_lane,hero_ids,enemy_hero_ids");
      requests.push(cachedJson<LaneMatchup[]>(`${API}/analytics/lane-matchup-stats?${laneQuery}`, 60 * 60 * 1000));
      const curveQuery = periodQuery(globalQuery, days); curveQuery.set("hero_ids", allies.join(",")); curveQuery.set("enemy_hero_ids", enemies.join(",")); curveQuery.set("min_matches", "5");
      requests.push(cachedJson<SoulCurve[]>(`${API}/analytics/lane-soul-curve?${curveQuery}`, 60 * 60 * 1000));
      const itemQuery = periodQuery(globalQuery, days); itemQuery.set("min_bought_at_s", "0"); itemQuery.set("max_bought_at_s", "600"); itemQuery.set("same_lane_filter", "true"); itemQuery.set("min_matches", "5");
      requests.push(cachedJson<ItemStat[]>(itemStatsUrl(laneHero, itemQuery, enemies), 60 * 60 * 1000));
    }
    void Promise.all(requests).then((results) => {
      if (!active) return;
      if (section === "Items") setItemStats(results[0] as ItemStat[]);
      if (section === "Meta") setHeroStats(results[0] as HeroStat[]);
      if (section === "Leaderboards") setLeaderboard(results[0] as Scoreboard[]);
      if (section === "Team Builder") { setSynergies(results[0] as SynergyStat[]); setCounters(results[1] as CounterStat[]); setCombinations((results[2] as HeroCombination[] | undefined) ?? []); }
      if (section === "Lane Assistant") { setLaneMatchups(results[0] as LaneMatchup[]); setSoulCurves(results[1] as SoulCurve[]); setOpeningItems(results[2] as ItemStat[]); }
      if (active) setLoadStatus({ key: requestKey, error: false });
    }).catch(() => { if (active) setLoadStatus({ key: requestKey, error: true }); });
    return () => { active = false; };
  }, [days, globalQuery, laneAlly, laneEnemy, laneEnemyAlly, laneHero, requestKey, section, sort, teamA, teamB]);

  const enrichedItems = useMemo(() => itemStats.map((stat) => ({ stat, item: items.find((entry) => entry.id === stat.item_id) })).filter((row): row is { stat: ItemStat; item: Item } => Boolean(row.item && row.item.shopable))
    .filter(({ item }) => (itemCategory === "all" || item.item_slot_type === itemCategory) && item.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === "matches" ? b.stat.matches - a.stat.matches : sort === "buytime" ? a.stat.avg_buy_time_s - b.stat.avg_buy_time_s : (b.stat.wins / Math.max(1, b.stat.matches)) - (a.stat.wins / Math.max(1, a.stat.matches))), [itemCategory, itemStats, items, search, sort]);

  const trends = useMemo(() => {
    const grouped = new Map<number, HeroStat[]>();
    heroStats.forEach((row) => grouped.set(row.hero_id, [...(grouped.get(row.hero_id) ?? []), row]));
    return [...grouped.entries()].map(([heroId, rows]) => {
      const ordered = rows.sort((a, b) => a.bucket - b.bucket), current = ordered.at(-1), prior = ordered.at(-2);
      return { heroId, current, delta: current && prior && current.matches > 0 && prior.matches > 0 ? current.wins / current.matches - prior.wins / prior.matches : null, samples: ordered.reduce((sum, row) => sum + row.matches, 0) };
    }).filter((row) => row.current).sort((a, b) => (b.delta ?? -2) - (a.delta ?? -2));
  }, [heroStats]);

  async function findPlayer(event: React.FormEvent) {
    event.preventDefault(); setPlayerBusy(true); setPlayerError(false); setSelectedPlayer(null); setSelectedPlayerStats([]); setSelectedPlayerRank(null); setSelectedPlayerHistory([]); setSelectedPlayerMetrics(null);
    const requestId = ++playerRequestRef.current;
    try { const query = new URLSearchParams({ search_query: playerQuery.trim(), limit: "12", min_matches_played_last_30d: "1" }); const result = await cachedJson<SteamProfile[]>(`${API}/players/steam-search?${query}`, 10 * 60 * 1000); if (requestId === playerRequestRef.current) setPlayerSearch(result); }
    catch { if (requestId === playerRequestRef.current) setPlayerError(true); } finally { if (requestId === playerRequestRef.current) setPlayerBusy(false); }
  }

  async function loadPlayer(profile: SteamProfile) {
    const requestId = ++playerRequestRef.current;
    setSelectedPlayer(profile); setPlayerStatsBusy(true); setPlayerError(false); setSelectedPlayerStats([]); setSelectedPlayerRank(null); setSelectedPlayerHistory([]); setSelectedPlayerMetrics(null);
    try {
      const [statsResult, rankResult, historyResult] = await Promise.allSettled([
        cachedJson<PlayerHeroStat[]>(`${API}/players/hero-stats?account_ids=${profile.account_id}&game_mode=normal`, 60 * 60 * 1000),
        cachedJson<PlayerRank[]>(`${API}/players/rank?account_ids=${profile.account_id}`, 60 * 60 * 1000),
        cachedJson<PlayerMatch[]>(`${API}/players/${profile.account_id}/match-history`, 10 * 60 * 1000),
      ]);
      if (statsResult.status === "rejected") throw statsResult.reason;
      if (requestId !== playerRequestRef.current) return;
      const rank = rankResult.status === "fulfilled" ? rankResult.value.find((row) => row.account_id === profile.account_id && row.badge > 0) ?? null : null;
      setSelectedPlayerStats(statsResult.value.filter((row) => Number.isFinite(row.hero_id)).sort((a, b) => b.matches_played - a.matches_played));
      setSelectedPlayerRank(rank);
      setSelectedPlayerHistory(historyResult.status === "fulfilled" ? historyResult.value.slice().sort((a, b) => b.start_time - a.start_time).slice(0, 20) : []);
      const ownMetricsQuery = periodQuery(globalQuery, days); ownMetricsQuery.set("account_ids", String(profile.account_id));
      const cohortQuery = periodQuery(globalQuery, days);
      const rankBand = rankTier === "all" ? rankCohort(rank?.badge ?? null) : null;
      const cohort = rankTier !== "all" ? `selected ${formatRank(Number(rankTier) * 10 + 1).replace(/ I$/, "+")} range` : rankBand ? `${formatRank(rankBand.min)}–${formatRank(rankBand.max)}` : "all reported ranks";
      if (rankTier === "all" && rankBand) { cohortQuery.set("min_average_badge", String(rankBand.min)); cohortQuery.set("max_average_badge", String(rankBand.max)); }
      const [ownMetrics, fieldMetrics] = await Promise.allSettled([
        cachedJson<Record<string, MetricDistribution>>(`${API}/analytics/player-stats/metrics?${ownMetricsQuery}`, 60 * 60 * 1000),
        cachedJson<Record<string, MetricDistribution>>(`${API}/analytics/player-stats/metrics?${cohortQuery}`, 60 * 60 * 1000),
      ]);
      if (requestId === playerRequestRef.current && ownMetrics.status === "fulfilled" && fieldMetrics.status === "fulfilled") setSelectedPlayerMetrics({ own: ownMetrics.value, field: fieldMetrics.value, cohort });
    }
    catch { if (requestId === playerRequestRef.current) setPlayerError(true); } finally { if (requestId === playerRequestRef.current) setPlayerStatsBusy(false); }
  }

  // Alias keeps all player loading state in one place.
  function setPlayerStatsBusy(value: boolean) { setPlayerBusy(value); }

  const compositionRosterIds = useMemo(() => [...new Set([...teamA, ...teamB])], [teamA, teamB]);
  useEffect(() => {
    if (section !== "Team Builder") return;
    let active = true;
    const ids = compositionRosterIds;
    void Promise.allSettled(ids.map((id) => cachedJson<AbilityAsset[]>(`${API}/assets/items/by-hero-id/${id}?language=english`, 24 * 60 * 60 * 1000))).then((results) => {
      if (!active) return;
      const next = new Map<number, HeroAbilityEvidence[]>();
      results.forEach((result, index) => {
        if (result.status === "fulfilled") next.set(ids[index], result.value.filter((ability) => ability?.description || ability?.behaviours || ability?.behaviors));
      });
      setTeamAbilities(next);
    });
    return () => { active = false; };
  }, [compositionRosterIds, section]);

  const heroMap = useMemo(() => new Map(heroes.map((hero) => [hero.id, hero])), [heroes]);
  const toggler = (team: "a" | "b", heroId: number) => {
    const setter = team === "a" ? setTeamA : setTeamB;
    setter((current) => current.includes(heroId) ? current.filter((id) => id !== heroId) : current.length < 6 ? [...current, heroId] : current);
  };
  const scorePair = (a: number, b: number) => synergies.find((row) => (row.hero_id1 === a && row.hero_id2 === b) || (row.hero_id1 === b && row.hero_id2 === a));
  const compositionPairs = (team: number[]) => team.flatMap((heroId, index) => team.slice(index + 1).map((allyId) => ({ heroId, allyId, stat: scorePair(heroId, allyId) }))).filter((pair) => pair.stat);
  const matchupMatrix = teamA.flatMap((allyId) => teamB.map((enemyId) => counters.find((row) => row.hero_id === allyId && row.enemy_hero_id === enemyId))).filter((row): row is CounterStat => Boolean(row));
  const averageTeamEdge = matchupMatrix.length ? matchupMatrix.reduce((sum, row) => sum + row.wins / row.matches_played, 0) / matchupMatrix.length : null;
  const completionSuggestions = teamA.length < 6 ? combinations.filter((row) => row.hero_ids.length === 6 && teamA.every((id) => row.hero_ids.includes(id))).flatMap((row) => row.hero_ids.filter((id) => !teamA.includes(id)).map((heroId) => ({ heroId, wins: row.wins, matches: row.matches }))).reduce((map, row) => { const previous = map.get(row.heroId) ?? { wins: 0, matches: 0 }; map.set(row.heroId, { wins: previous.wins + row.wins, matches: previous.matches + row.matches }); return map; }, new Map<number, { wins: number; matches: number }>()): new Map<number, { wins: number; matches: number }>();
  const selectedTeamHistory = teamA.length === 6 ? combinations.find((row) => row.hero_ids.length === 6 && teamA.every((id) => row.hero_ids.includes(id))) : undefined;
  const compositionProfile = enemyTeamProfile(teamA.map((heroId) => ({ heroId })), teamAbilities);
  const opponentCompositionProfile = enemyTeamProfile(teamB.map((heroId) => ({ heroId })), teamAbilities);
  const compositionDimensions = [["Weapon pressure", compositionProfile.weaponDamage], ["Weapon burst", compositionProfile.weaponBurst], ["Spirit damage", compositionProfile.spiritDamage], ["Healing", compositionProfile.healing], ["Sustain", compositionProfile.sustain], ["Hard crowd control", compositionProfile.hardCc], ["Mobility", compositionProfile.mobility], ["Shields", compositionProfile.shields]] as const;
  const knownCompositionSignals = compositionDimensions.filter(([, value]) => value >= .58).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const possibleCompositionGaps = compositionDimensions.filter(([, value]) => value <= .3).sort((a, b) => a[1] - b[1]).slice(0, 3);
  const opponentCompositionDimensions = [["Weapon pressure", opponentCompositionProfile.weaponDamage], ["Weapon burst", opponentCompositionProfile.weaponBurst], ["Spirit damage", opponentCompositionProfile.spiritDamage], ["Healing", opponentCompositionProfile.healing], ["Sustain", opponentCompositionProfile.sustain], ["Hard crowd control", opponentCompositionProfile.hardCc], ["Mobility", opponentCompositionProfile.mobility], ["Shields", opponentCompositionProfile.shields]] as const;
  const opponentStrengthSignals = opponentCompositionDimensions.filter(([, value]) => value >= .58).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const opponentPossibleGaps = opponentCompositionDimensions.filter(([, value]) => value <= .3).sort((a, b) => a[1] - b[1]).slice(0, 3);
  const laneHeroPair = [laneHero, laneAlly].sort((a, b) => a - b), laneEnemyPair = [laneEnemy, laneEnemyAlly].sort((a, b) => a - b);
  const laneStat = laneMatchups.find((row) => row.hero_ids.join(",") === laneHeroPair.join(",") && row.enemy_hero_ids.join(",") === laneEnemyPair.join(","));
  const soulCurve = soulCurves.find((row) => row.hero_ids.join(",") === laneHeroPair.join(",") && row.enemy_hero_ids.join(",") === laneEnemyPair.join(","));
  const selectedHero = heroMap.get(laneHero), selectedAlly = heroMap.get(laneAlly), selectedEnemy = heroMap.get(laneEnemy), selectedEnemyAlly = heroMap.get(laneEnemyAlly);
  const selectedPlayerTotals = selectedPlayerStats.reduce((total, row) => ({ matches: total.matches + row.matches_played, wins: total.wins + row.wins }), { matches: 0, wins: 0 });
  const recentScored = selectedPlayerHistory.filter((match) => match.player_match_outcome === 1 || match.player_match_outcome === 2);
  const recentWins = recentScored.filter((match) => match.player_match_outcome === 1).length;
  const curveValues = soulCurve?.net_worth_diff ?? [];
  const curveScale = Math.max(1, ...curveValues.map(Math.abs));
  const curvePath = curveValues.map((value, index) => `${index ? "L" : "M"}${curveValues.length > 1 ? index / (curveValues.length - 1) * 100 : 50},${24 - value / curveScale * 19}`).join(" ");

  return <main className="discover-page">
    <header className="discover-heading"><div><small>COUNTERLOCK / DISCOVER</small><h1>Discover</h1><p>Explore the meta, players, and team matchups through tracked match data.</p></div><div className="discover-global-filters"><Select label="MODE" value={mode} onChange={setMode}><option value="all">All queues</option><option value="ranked">Ranked</option><option value="unranked">Unranked</option></Select><Select label="PERIOD" value={days} onChange={setDays}><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></Select><Select label="RANK" value={rankTier} onChange={setRankTier}><option value="all">All ranks</option>{Array.from({ length: 11 }, (_, index) => index + 1).map((tier) => <option key={tier} value={tier}>{formatRank(tier * 10 + 1).replace(/ I$/, "+")}</option>)}</Select></div></header>
    <nav className="discover-tabs" aria-label="Discover tools">{SECTIONS.map((entry) => <button key={entry} type="button" className={entry === section ? "active" : ""} onClick={() => setSection(entry)}>{entry}</button>)}</nav>
    {busy && <div className="discover-state">Loading {section.toLowerCase()}…</div>}{error && <div className="discover-state" role="alert">This data is temporarily unavailable. Please retry in a moment.</div>}
    {section === "My Stats" && <PersonalStatsPanel accountId={accountId} estimatedRank={estimatedRank} rankTier={rankTier} heroes={heroes} heroId={myHeroId} setHeroId={setMyHeroId} busy={myStatsBusy} stats={myStats?.key === myStatsKey ? myStats : null} />}
    {!busy && !error && section === "Items" && <section><div className="discover-section-head"><div><small>GLOBAL ITEM META</small><h2>Popular items and outcomes</h2></div><button type="button" onClick={() => onOpenBuild(heroes[0]?.id ?? 0)}>OPEN BUILD LAB →</button></div><div className="discover-controls"><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search items…" /><Select label="SLOT" value={itemCategory} onChange={setItemCategory}><option value="all">All slots</option><option value="weapon">Weapon</option><option value="vitality">Vitality</option><option value="spirit">Spirit</option></Select><Select label="SORT" value={sort} onChange={setSort}><option value="winrate">Win rate</option><option value="matches">Matches</option><option value="buytime">Buy timing</option></Select></div><div className="discover-card-grid item-explorer-grid">{enrichedItems.slice(0, 60).map(({ stat, item }) => <article key={item.id}>{item.shop_image_webp && <img src={item.shop_image_webp} alt="" />}<div><small>{item.item_slot_type?.toUpperCase() ?? "ITEM"} · T{item.item_tier ?? "—"}</small><strong>{item.name}</strong><span>{stat.matches.toLocaleString()} matches · {stat.avg_buy_time_s ? `${Math.floor(stat.avg_buy_time_s / 60)}:${String(Math.floor(stat.avg_buy_time_s % 60)).padStart(2, "0")} avg buy` : "Buy time unavailable"}</span></div><b>{stat.matches ? `${(100 * stat.wins / stat.matches).toFixed(1)}%` : "—"}<small>WIN RATE</small></b></article>)}</div></section>}
    {!busy && !error && section === "Meta" && <section><div className="discover-section-head"><div><small>HERO META / WEEK OVER WEEK</small><h2>Rising and falling</h2><p>Change compares the two latest weekly buckets; it is descriptive and may be noisy at low sample sizes.</p></div></div><div className="discover-card-grid meta-grid">{trends.filter((row) => row.delta != null).map((row) => { const hero = heroMap.get(row.heroId)!; return <article key={row.heroId}><img src={hero.images?.icon_hero_card_webp ?? hero.images?.icon_image_small_webp} alt="" /><div><small>{row.delta! >= 0 ? "RISING" : "FALLING"} · {row.samples.toLocaleString()} BUCKETED MATCHES</small><strong>{hero.name}</strong><span>{row.current!.matches.toLocaleString()} matches this week · {(100 * row.current!.wins / row.current!.matches).toFixed(1)}% WR</span></div><b className={row.delta! >= 0 ? "meta-rise" : "meta-fall"}>{row.delta! > 0 ? "+" : ""}{(row.delta! * 100).toFixed(1)} pp</b></article>; })}</div></section>}
    {!busy && !error && section === "Leaderboards" && <section><div className="discover-section-head"><div><small>GLOBAL HERO LEADERBOARD</small><h2>Heroes by performance</h2></div><Select label="SORT BY" value={sort} onChange={setSort}><option value="winrate">Win rate</option><option value="matches">Matches</option><option value="avg_kills_per_match">Kills / match</option><option value="avg_player_damage_per_match">Player damage</option><option value="avg_net_worth_per_match">Net worth</option></Select></div><div className="discover-list">{leaderboard.slice(0, 50).map((row) => { const hero = heroMap.get(row.hero_id); if (!hero) return null; const value = sort === "winrate" ? `${(row.value <= 1 ? row.value * 100 : row.value).toFixed(1)}%` : Math.round(row.value).toLocaleString(); return <article key={row.hero_id}><span>#{row.rank}</span>{hero.images?.icon_image_small_webp && <img src={hero.images.icon_image_small_webp} alt="" />}<strong>{hero.name}</strong><small>{row.matches.toLocaleString()} matches</small><b>{value}</b></article>; })}</div></section>}
    {!busy && !error && section === "Players" && <section><div className="discover-section-head"><div><small>PLAYER ANALYTICS</small><h2>Find a player</h2><p>Search Steam profiles, then inspect their rank, recent results, and per-hero performance.</p></div></div><form className="player-search-form" onSubmit={findPlayer}><input value={playerQuery} onChange={(event) => setPlayerQuery(event.target.value)} placeholder="Steam name or account ID…" /><button type="submit" disabled={!playerQuery.trim() || playerBusy}>{playerBusy ? "SEARCHING…" : "SEARCH PLAYERS →"}</button></form>{playerError && <div className="discover-state">Player data could not be loaded.</div>}{!selectedPlayer && playerSearch.length > 0 && <div className="player-search-results">{playerSearch.map((player) => <button type="button" key={player.account_id} onClick={() => void loadPlayer(player)}>{player.avatar && <img src={player.avatar} alt="" />}<strong>{player.personaname}</strong><span>Open profile →</span></button>)}</div>}{selectedPlayer && <><div className="selected-player-heading">{selectedPlayer.avatar && <img src={selectedPlayer.avatar} alt="" />}<div><small>PLAYER PROFILE · STEAM ID {selectedPlayer.account_id}</small><h3>{selectedPlayer.personaname}</h3></div><button type="button" onClick={() => { ++playerRequestRef.current; setSelectedPlayer(null); setSelectedPlayerStats([]); setSelectedPlayerHistory([]); setSelectedPlayerRank(null); setSelectedPlayerMetrics(null); setPlayerBusy(false); }}>BACK TO SEARCH</button></div>{playerBusy ? <div className="discover-state">Loading profile…</div> : <><div className="player-profile-summary"><article><small>LATEST RANK</small><strong>{selectedPlayerRank ? formatRank(selectedPlayerRank.badge) : "Unavailable"}</strong><span>Latest reported ranked match</span></article><article><small>TRACKED MATCHES</small><strong>{selectedPlayerTotals.matches.toLocaleString()}</strong><span>Across reported hero stats</span></article><article><small>OVERALL WIN RATE</small><strong>{selectedPlayerTotals.matches ? `${(100 * selectedPlayerTotals.wins / selectedPlayerTotals.matches).toFixed(1)}%` : "—"}</strong><span>{selectedPlayerTotals.matches ? `${selectedPlayerTotals.wins.toLocaleString()} wins · ${(selectedPlayerTotals.matches - selectedPlayerTotals.wins).toLocaleString()} other results` : "No aggregate sample"}</span></article><article><small>MOST PLAYED</small><strong>{selectedPlayerStats[0] ? heroMap.get(selectedPlayerStats[0].hero_id)?.name ?? `Hero ${selectedPlayerStats[0].hero_id}` : "—"}</strong><span>{selectedPlayerStats[0] ? `${selectedPlayerStats[0].matches_played.toLocaleString()} matches` : "No hero sample"}</span></article></div><PlayerPerformance metrics={selectedPlayerMetrics} /><section className="player-recent-history"><header><div><small>RECENT MATCHES</small><h3>Last 20 public results</h3></div><b>{recentScored.length ? `${recentWins}W / ${recentScored.length - recentWins}L` : "—"}</b></header>{selectedPlayerHistory.length ? <div className="player-recent-list">{selectedPlayerHistory.map((match) => { const hero = heroMap.get(match.hero_id); return <article key={match.match_id}><time>{new Date(match.start_time * 1000).toLocaleDateString()}</time>{hero?.images?.icon_image_small_webp && <img src={hero.images.icon_image_small_webp} alt="" />}<strong>{hero?.name ?? `Hero ${match.hero_id}`}</strong><span>{match.player_kills}/{match.player_deaths}/{match.player_assists} KDA</span><small>{Math.floor(match.match_duration_s / 60)} min</small><b className={match.player_match_outcome === 1 ? "win" : match.player_match_outcome === 2 ? "loss" : "unknown"}>{match.player_match_outcome === 1 ? "WIN" : match.player_match_outcome === 2 ? "LOSS" : "—"}</b></article>; })}</div> : <p className="discover-state">Recent public match history is unavailable for this profile.</p>}</section><h3 className="player-hero-heading">MOST PLAYED HEROES</h3><div className="player-hero-stats">{selectedPlayerStats.map((stat) => { const hero = heroMap.get(stat.hero_id); return <article key={stat.hero_id}>{hero?.images?.icon_image_small_webp && <img src={hero.images.icon_image_small_webp} alt="" />}<strong>{hero?.name ?? `Hero ${stat.hero_id}`}</strong><span>{stat.matches_played} matches · {stat.matches_played ? `${(100 * stat.wins / stat.matches_played).toFixed(1)}% WR` : "—"}</span><small>{stat.kills_per_min.toFixed(2)} K · {stat.deaths_per_min.toFixed(2)} D · {stat.assists_per_min.toFixed(2)} A / min</small><small>{stat.networth_per_min.toFixed(0)} souls/min · {stat.damage_per_min.toFixed(0)} player dmg/min · {(100 * stat.accuracy).toFixed(1)}% accuracy</small></article>; })}</div>{!selectedPlayerStats.length && <div className="discover-state">No public hero match history is available for this profile.</div>}</>}</>}</section>}
    {!busy && !error && section === "Team Builder" && <section><div className="discover-section-head"><div><small>6V6 COMPOSITION WORKSHOP</small><h2>Build both teams</h2><p>Review historical teammate synergy and direct matchup samples. No win prediction is inferred from incomplete pair data.</p></div></div><div className="team-builder-columns"><TeamRoster name="YOUR TEAM" roster={teamA} heroes={heroes} onRemove={(id) => setTeamA((rows) => rows.filter((entry) => entry !== id))} /><TeamRoster name="OPPONENTS" roster={teamB} heroes={heroes} onRemove={(id) => setTeamB((rows) => rows.filter((entry) => entry !== id))} /></div><input className="team-hero-search" value={teamSearch} onChange={(event) => setTeamSearch(event.target.value)} placeholder="Find a hero to add…" /><div className="team-hero-picks">{heroes.filter((hero) => hero.name.toLowerCase().includes(teamSearch.toLowerCase())).map((hero) => <div key={hero.id}>{hero.images?.icon_image_small_webp && <img src={hero.images.icon_image_small_webp} alt="" />}<strong>{hero.name}</strong><button type="button" disabled={teamA.length >= 6 || teamA.includes(hero.id)} onClick={() => toggler("a", hero.id)}>+ YOURS</button><button type="button" disabled={teamB.length >= 6 || teamB.includes(hero.id)} onClick={() => toggler("b", hero.id)}>+ THEM</button></div>)}</div><section className="team-composition-reading"><header><small>TEAM MECHANIC COVERAGE</small><strong>Asset and ability evidence</strong></header><div className="team-composition-signals"><article><small>YOUR TEAM · DOCUMENTED STRENGTHS</small><p>{teamA.length ? knownCompositionSignals.map(([name, value]) => `${name} · ${Math.round(value * 100)}%`).join(" · ") || "No strong supported signal yet" : "Add heroes"}</p><b>{Math.round(compositionProfile.confidence * 100)}% evidence</b></article><article><small>YOUR TEAM · POSSIBLE GAPS</small><p>{!teamA.length ? "Add heroes" : compositionProfile.confidence >= .45 ? possibleCompositionGaps.map(([name]) => name).join(" · ") || "No clear low-signal categories" : "Insufficient ability evidence to call gaps"}</p></article><article><small>OPPONENTS · DOCUMENTED STRENGTHS</small><p>{teamB.length ? opponentStrengthSignals.map(([name, value]) => `${name} · ${Math.round(value * 100)}%`).join(" · ") || "No strong supported signal yet" : "Add heroes"}</p><b>{Math.round(opponentCompositionProfile.confidence * 100)}% evidence</b></article><article><small>OPPONENTS · POSSIBLE GAPS</small><p>{!teamB.length ? "Add heroes" : opponentCompositionProfile.confidence >= .45 ? opponentPossibleGaps.map(([name]) => name).join(" · ") || "No clear low-signal categories" : "Insufficient ability evidence to call gaps"}</p></article></div><p>Mechanic tags combine hero asset descriptions with a small curated set. Low-confidence categories remain uncertain; these signals are not a team-win prediction.</p></section><div className="team-analysis-grid"><article><small>YOUR TEAM / PAIR SYNERGY</small><strong>{compositionPairs(teamA).length} / 15 pairs have data</strong><p>{compositionPairs(teamA).sort((a, b) => (b.stat!.wins / b.stat!.matches_played) - (a.stat!.wins / a.stat!.matches_played)).slice(0, 4).map((pair) => `${heroMap.get(pair.heroId)?.name} + ${heroMap.get(pair.allyId)?.name} · ${(100 * pair.stat!.wins / pair.stat!.matches_played).toFixed(1)}% / ${pair.stat!.matches_played} games`).join(" · ") || "Select heroes to inspect pair history."}</p></article><article><small>HEAD-TO-HEAD SAMPLES</small><strong>{averageTeamEdge == null ? "No complete matchup samples" : `${(100 * averageTeamEdge).toFixed(1)}% average row win rate`}</strong><p>{matchupMatrix.length} of {teamA.length * teamB.length} hero-vs-hero pair samples found. This is descriptive match history, not a team prediction.</p></article><article><small>{teamA.length === 6 ? "SELECTED FULL TEAM HISTORY" : "COMMON FULL-TEAM COMPLETIONS"}</small><strong>{teamA.length === 6 ? selectedTeamHistory ? `${(100 * selectedTeamHistory.wins / selectedTeamHistory.matches).toFixed(1)}% · ${selectedTeamHistory.matches.toLocaleString()} games` : "No full-team sample" : `${[...completionSuggestions.values()].reduce((sum, row) => sum + row.matches, 0).toLocaleString()} roster appearances`}</strong><p>{teamA.length === 6 ? "Exact six-hero lineup history against the selected enemy heroes, when enough sample is available." : [...completionSuggestions.entries()].sort((a, b) => b[1].matches - a[1].matches).slice(0, 4).map(([heroId, row]) => `${heroMap.get(heroId)?.name ?? `Hero ${heroId}`} · ${row.matches.toLocaleString()} games · ${(100 * row.wins / Math.max(1, row.matches)).toFixed(1)}% historical WR`).join(" · ") || "Pick at least one hero to find historically played six-hero completions."}</p><small>Historical combinations are descriptive co-occurrences, not predicted best picks.</small></article></div></section>}
    {!busy && !error && section === "Lane Assistant" && <section><div className="discover-section-head"><div><small>LANE MATCHUP ASSISTANT</small><h2>Compare the lane</h2><p>Historical 2v2 lane data, souls curve, and opening buys from the selected matchup. This endpoint is marked subject to change by Deadlock API.</p></div></div><div className="lane-live-fill">{laneSuggestion ? <><button type="button" onClick={() => { setLaneHero(laneSuggestion.heroId); setLaneAlly(laneSuggestion.allyHeroId); setLaneEnemy(laneSuggestion.enemyHeroId); setLaneEnemyAlly(laneSuggestion.enemyAllyHeroId); }}>USE ASSIGNED LIVE LANE →</button><span>Uses current match roster lane assignments. Review all four picks; assignments can be estimates.</span></> : <span>Connect a live roster and assign lane positions in the match view to prefill this matchup.</span>}</div><div className="lane-assistant-controls"><Select label="YOUR HERO" value={String(laneHero)} onChange={(value) => setLaneHero(Number(value))}>{heroes.map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</Select><Select label="YOUR ALLY" value={String(laneAlly)} onChange={(value) => setLaneAlly(Number(value))}>{heroes.filter((hero) => hero.id !== laneHero).map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</Select><span>VS</span><Select label="LANE OPPONENT" value={String(laneEnemy)} onChange={(value) => setLaneEnemy(Number(value))}>{heroes.map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</Select><Select label="ENEMY ALLY" value={String(laneEnemyAlly)} onChange={(value) => setLaneEnemyAlly(Number(value))}>{heroes.filter((hero) => hero.id !== laneEnemy).map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</Select></div><article className="lane-assistant-result"><div>{selectedHero?.images?.icon_hero_card_webp && <img src={selectedHero.images.icon_hero_card_webp} alt="" />}<span><small>HISTORICAL LANE MATCHUP</small><strong>{selectedHero?.name} + {selectedAlly?.name} vs {selectedEnemy?.name} + {selectedEnemyAlly?.name}</strong><small>15 MIN SAMPLE · {laneStat?.sample_matches.toLocaleString() ?? "0"} matchups reached this point</small></span></div><b>{laneStat?.matches_played ? `${(100 * laneStat.wins / laneStat.matches_played).toFixed(1)}%` : "—"}<small>{laneStat?.matches_played ? `${laneStat.matches_played.toLocaleString()} duo matchups` : "No matching duo sample"}</small></b></article>{laneStat && <div className="lane-curve-panel"><div><small>SOULS LEAD OVER TIME</small><strong>{laneStat.net_worth_diff >= 0 ? "+" : ""}{Math.round(laneStat.net_worth_diff).toLocaleString()} souls at 15 min</strong><span>{laneStat.sample_matches.toLocaleString()} games lasted to this reading</span></div>{curveValues.length > 1 ? <svg viewBox="0 0 100 48" role="img" aria-label="Average lane souls lead over time"><path d="M0 24H100" /><path className="lane-curve-line" d={curvePath} /></svg> : <small>Time curve unavailable for this duo.</small>}</div>}{laneStat?.stats && <div className="lane-stat-row">{Object.entries(laneStat.stats).map(([name, metric]) => <article key={name}><small>{name.replaceAll("_", " ").toUpperCase()} LEAD</small><strong>{metric.diff >= 0 ? "+" : ""}{Math.round(metric.diff).toLocaleString()}</strong></article>)}</div>}<section className="lane-opening-items"><div className="discover-section-head"><div><small>OPENING ITEMS / FIRST 10 MINUTES</small><h2>Items in comparable lanes</h2></div></div><div className="discover-list">{openingItems.slice().sort((a, b) => b.matches - a.matches).slice(0, 6).map((row) => { const item = items.find((entry) => entry.id === row.item_id); return <article key={row.item_id}>{item?.shop_image_webp && <img src={item.shop_image_webp} alt="" />}<strong>{item?.name ?? `Item ${row.item_id}`}</strong><small>{row.matches.toLocaleString()} matches</small><b>{row.matches ? `${(100 * row.wins / row.matches).toFixed(1)}% WR` : "—"}</b></article>; })}</div></section></section>}
  </main>;
}

function PersonalStatsPanel({ accountId, estimatedRank, rankTier, heroes, heroId, setHeroId, busy, stats }: { accountId: number | null; estimatedRank: number | null; rankTier: string; heroes: Hero[]; heroId: number; setHeroId: (id: number) => void; busy: boolean; stats: { player: PlayerHeroStat[]; cohort: HeroAggregate[]; metrics: Record<string, MetricDistribution>; personalMetrics: Record<string, MetricDistribution>; history: RecentMatch[]; error: boolean } | null }) {
  const cohort = stats?.cohort.reduce((acc, row) => ({ wins: acc.wins + row.wins, matches: acc.matches + row.matches }), { wins: 0, matches: 0 }) ?? { wins: 0, matches: 0 };
  const player = stats?.player.find((row) => row.hero_id === heroId);
  const metrics = [
    { label: "KILLS / MATCH", key: "kills" }, { label: "DEATHS / MATCH", key: "deaths" }, { label: "ASSISTS / MATCH", key: "assists" },
    { label: "SOULS / MIN", key: "net_worth_per_min" }, { label: "PLAYER DAMAGE / MATCH", key: "player_damage" }, { label: "ACCURACY", key: "accuracy" },
    { label: "LAST HITS / MATCH", key: "last_hits" }, { label: "DENIES / MATCH", key: "denies" }, { label: "BOSS DAMAGE / MATCH", key: "boss_damage" },
  ];
  const rank = rankCohort(estimatedRank);
  const fallbackRank = rankTier === "all" ? null : { min: Number(rankTier) * 10 + 1, max: Number(rankTier) * 10 + 6 };
  const history = stats?.history ?? [];
  const scored = history.filter((match) => match.player_match_outcome === 1 || match.player_match_outcome === 2);
  const wins = scored.filter((match) => match.player_match_outcome === 1).length;
  const lowSignals = metrics.flatMap((metric) => {
    const own = stats?.personalMetrics[metric.key]?.avg, p25 = stats?.metrics[metric.key]?.percentile25;
    if (own == null || p25 == null || own >= p25 || metric.key === "deaths") return [];
    const title = metric.key === "last_hits" ? "Lane farming" : metric.key === "denies" ? "Orb denies" : metric.key === "boss_damage" ? "Boss damage" : metric.key === "player_damage" ? "Player damage" : metric.label.toLowerCase();
    return [title];
  });
  const formatted = (key: string, value: number | undefined) => value == null ? "—" : key === "accuracy" ? `${(value * 100).toFixed(1)}%` : key === "net_worth_per_min" ? Math.round(value).toLocaleString() : Math.round(value).toLocaleString();
  return <section><div className="discover-section-head"><div><small>PERSONAL PERFORMANCE</small><h2>Your hero results vs. the field</h2><p>{rank ? `Compared with the same hero near your estimated rank (${formatRank(rank.min)}–${formatRank(rank.max)}).` : fallbackRank ? `Rank estimate unavailable; using the selected rank range (${formatRank(fallbackRank.min)}–${formatRank(fallbackRank.max)}).` : "Rank estimate unavailable; comparison uses all reported ranks."}</p></div><Select label="HERO" value={String(heroId)} onChange={(value) => setHeroId(Number(value))}>{heroes.map((hero) => <option key={hero.id} value={hero.id}>{hero.name}</option>)}</Select></div>
    {accountId == null ? <div className="discover-state">Link a Steam profile in Match History to view your stats.</div> : busy ? <div className="discover-state">Loading your stats…</div> : stats?.error ? <div className="discover-state" role="alert">Personal stats are temporarily unavailable.</div> : <><div className="discover-state">Your sample: {player?.matches_played ?? 0} selected-hero matches · field sample: {cohort.matches.toLocaleString()} hero matches. Percentile bands are approximate and compare same-hero metric distributions.</div><div className="discover-card-grid personal-stats-grid"><article><small>WIN RATE</small><strong>{player?.matches_played ? `${(100 * player.wins / player.matches_played).toFixed(1)}%` : "—"}</strong><span>YOU · {player?.matches_played ?? 0} MATCHES</span><b>{cohort.matches ? `${(100 * cohort.wins / cohort.matches).toFixed(1)}%` : "—"}</b><span>FIELD · {cohort.matches.toLocaleString()}</span></article>{metrics.map((metric) => { const own = stats?.personalMetrics[metric.key]?.avg; const distribution = stats?.metrics[metric.key]; const band = own == null || distribution?.percentile50 == null ? "Percentile unavailable" : own >= (distribution.percentile90 ?? Infinity) ? "At or above P90" : own >= (distribution.percentile75 ?? Infinity) ? "P75–P90" : own >= distribution.percentile50 ? "P50–P75" : distribution.percentile25 != null && own >= distribution.percentile25 ? "P25–P50" : distribution.percentile25 != null ? "Below P25" : "Below P50"; return <article key={metric.key}><small>{metric.label}</small><strong>{formatted(metric.key, own)}</strong><span>YOU · {band}</span><b>{formatted(metric.key, distribution?.avg)}</b><span>FIELD AVG · P50 {formatted(metric.key, distribution?.percentile50)}</span></article>; })}</div>
      <section className="personal-insights-grid"><article><small>LAST 20 MATCHES</small><strong>{scored.length ? `${wins}W / ${scored.length - wins}L` : "—"}</strong><p>{history.length ? `${history.length} recent matches returned · ${scored.length} with a scored result` : "No recent public match history is available."}</p><div className="recent-result-strip">{history.slice(0, 20).map((match) => <i key={match.match_id} title={`${heroes.find((hero) => hero.id === match.hero_id)?.name ?? "Hero"} · ${match.player_kills}/${match.player_deaths}/${match.player_assists}`} className={match.player_match_outcome === 1 ? "win" : match.player_match_outcome === 2 ? "loss" : "unknown"}>{match.player_match_outcome === 1 ? "W" : match.player_match_outcome === 2 ? "L" : "·"}</i>)}</div></article><article><small>IMPROVEMENT SIGNALS</small><strong>{lowSignals.length ? `${lowSignals.length} focus ${lowSignals.length === 1 ? "area" : "areas"}` : "No clear low signal"}</strong><p>{lowSignals.length ? lowSignals.slice(0, 3).map((signal) => `${signal} is below the same-hero field’s 25th percentile`).join(" · ") : "Signals appear when your metric sample falls below the same-hero 25th percentile. This is a prompt for review, not a causal diagnosis."}</p></article></section></>}
  </section>;
}

function PlayerPerformance({ metrics }: { metrics: { own: Record<string, MetricDistribution>; field: Record<string, MetricDistribution>; cohort: string } | null }) {
  const rows = [
    ["KILLS / MATCH", "kills", false], ["DEATHS / MATCH", "deaths", false], ["ASSISTS / MATCH", "assists", false],
    ["SOULS / MIN", "net_worth_per_min", false], ["PLAYER DAMAGE / MATCH", "player_damage", false], ["ACCURACY", "accuracy", true],
  ] as const;
  const value = (key: string, number?: number, percent = false) => number == null ? "—" : percent ? `${(number * 100).toFixed(1)}%` : Math.round(number).toLocaleString();
  return <section className="player-performance"><header><div><small>PERFORMANCE VS THE FIELD</small><h3>Player metrics</h3></div><span>{metrics ? metrics.cohort : "Loading comparison…"}</span></header>{metrics ? <div className="player-performance-grid">{rows.map(([label, key, percent]) => { const own = metrics.own[key], field = metrics.field[key]; const percentile = own?.avg == null ? null : own.avg >= (field?.percentile90 ?? Infinity) ? "P90+" : own.avg >= (field?.percentile75 ?? Infinity) ? "P75–P90" : own.avg >= (field?.percentile50 ?? Infinity) ? "P50–P75" : own.avg >= (field?.percentile25 ?? Infinity) ? "P25–P50" : field?.percentile25 != null ? "Below P25" : null; return <article key={key}><small>{label}</small><strong>{value(key, own?.avg, percent)}</strong><span>YOU · {percentile ?? "Percentile unavailable"}</span><b>{value(key, field?.avg, percent)}</b><span>FIELD AVG · P50 {value(key, field?.percentile50, percent)}</span></article>; })}</div> : <p>Rank comparison appears when the API returns enough public sample data.</p>}<p className="player-performance-note">Metric percentiles are approximate distributions for the selected time and queue filters; they are descriptive, not a skill rating.</p></section>;
}

function TeamRoster({ name, roster, heroes, onRemove }: { name: string; roster: number[]; heroes: Hero[]; onRemove: (heroId: number) => void }) {
  return <section className="team-roster"><header><small>{name}</small><b>{roster.length}/6</b></header>{Array.from({ length: 6 }, (_, index) => { const hero = heroes.find((entry) => entry.id === roster[index]); return hero ? <button type="button" key={hero.id} onClick={() => onRemove(hero.id)}>{hero.images?.icon_image_small_webp && <img src={hero.images.icon_image_small_webp} alt="" />}<span>{hero.name}</span><b>×</b></button> : <div className="empty-roster-slot" key={index}>PICK {index + 1}</div>; })}</section>;
}
