"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cachedJson } from "./lib/data/cache";
import { itemFlowStats, itemStatsUrl, type ItemFlowStats } from "./lib/data/deadlock-api";
import { formatRank, getRankTier } from "./lib/player-rank";
import { aggregateRankSamples, groupDurationSamples, patchWindow as applyPatchWindow, sortBuilds, sortHeroItems, sortMatchups } from "./lib/analytics/hero-profile";

type Hero = { id: number; name: string; description?: { lore?: string | null; playstyle?: string | null; role?: string | null }; hero_type?: string | null; tags?: string[]; starting_stats?: Record<string, number | { value: number; display_stat_name?: string }>; standard_level_up_upgrades?: Record<string, number>; scaling_stats?: Record<string, unknown>; images?: { icon_hero_card_webp?: string; icon_image_small_webp?: string } };
type HeroStat = { hero_id: number; bucket: number; wins: number; losses: number; matches: number; matches_per_bucket: number };
type GameStats = { total_players: number; total_matches: number };
type HeroBanStat = { hero_id: number; bans: number };
type Item = { id: number; name: string; cost: number | null; item_tier: number | null; item_slot_type: string | null; shop_image_webp?: string };
type ItemStat = { item_id: number; wins: number; losses: number; matches: number; avg_buy_time_s: number };
type AbilityOrder = { abilities: number[]; wins: number; losses: number; matches: number };
type HeroBuildStat = { hero_id: number; hero_build_id: number; wins: number; losses: number; matches: number; players: number };
type CommunityBuild = { hero_build: { hero_id: number; hero_build_id: number; name: string; author_account_id: number; description?: string | null }; num_favorites?: number | null; num_weekly_favorites?: number | null };
type CounterStat = { hero_id: number; enemy_hero_id: number; wins: number; matches_played: number };
type SynergyStat = { hero_id1: number; hero_id2: number; wins: number; matches_played: number };
type LeaderSort = "rank" | "matches";
type ScoreboardEntry = { account_id: number; rank: number; value: number; matches: number };
type PlayerRank = { account_id: number; badge: number; rank: number; subrank: number };
type SteamProfile = { account_id: number; personaname: string; avatar: string };
type AbilityAsset = { id?: number; ability_id?: number; hero?: number; ability_type?: string; name?: string; description?: string | { active?: string | null; passive?: string | null; desc?: string | null; quip?: string | null; t1_desc?: string | null; t2_desc?: string | null; t3_desc?: string | null }; properties?: Record<string, { value?: string | number; label?: string; postfix?: string; scale_function?: { specific_stat_scale_type?: string } }>; image?: string; image_webp?: string; shop_image_webp?: string };
type ClientPatch = { client_version: number; version_datetime: string; version_date?: string };
type ProfileTab = "overview" | "builds" | "abilities" | "matchups" | "leaderboard";
type ProfileData = { key: string; heroId: number; tab: ProfileTab; items: ItemStat[]; flow: ItemFlowStats | null; builds: { item_id: number; builds: number }[]; guides: CommunityBuild[]; buildPerformance: HeroBuildStat[]; orders: AbilityOrder[]; counters: CounterStat[]; synergies: SynergyStat[]; abilities: AbilityAsset[]; trends: HeroStat[]; ranks: HeroStat[]; durations: HeroStat[] };
type Props = { heroes: Hero[]; items: Item[]; initialHeroId?: number | null; onOpenBuild: (heroId: number) => void; onOpenPlayer: (accountId: number) => void };
type HeroSelectOption = { value: string; label: string };

const API = "https://api.deadlock-api.com/v1";
const EMPTY_STATS: HeroStat[] = [];

function statLabel(key: string, displayName?: string) {
  return (displayName ?? key).replace(/^E/, "").replaceAll(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase());
}

function abilityText(asset: AbilityAsset) {
  if (typeof asset.description === "string") return plainAbilityText(asset.description) || "Ability details are unavailable.";
  if (!asset.description) return "Ability details are unavailable.";
  const text = asset.description.desc ?? asset.description.active ?? asset.description.passive ?? asset.description.quip ?? asset.description.t1_desc;
  return text ? plainAbilityText(text) || "Ability details are unavailable." : "Ability details are unavailable.";
}

function plainAbilityText(value: string | number) {
  return String(value)
    .replace(/<svg\b[\s\S]*?<\/svg\s*>/gi, " ")
    .replace(/<br\s*\/?\s*>|<\/(?:p|div|li|ul|ol)>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ").trim();
}

function HeroSelect({ value, options, onChange, ariaLabel, disabled = false }: { value: string; options: HeroSelectOption[]; onChange: (value: string) => void; ariaLabel: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const selected = options.find((option) => option.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const activeOption = rootRef.current?.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
    activeOption?.focus();
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);
  const handleTriggerKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") && !open) {
      event.preventDefault();
      if (!disabled) setOpen(true);
    } else if (event.key === "Escape") setOpen(false);
  };
  const handleOptionKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const optionButtons = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const currentIndex = optionButtons.indexOf(event.currentTarget);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      optionButtons[(currentIndex + (event.key === "ArrowDown" ? 1 : -1) + optionButtons.length) % optionButtons.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      optionButtons[event.key === "Home" ? 0 : optionButtons.length - 1]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault(); setOpen(false); triggerRef.current?.focus();
    } else if (event.key === "Tab") setOpen(false);
  };
  return <div className={`hero-select${open ? " open" : ""}${disabled ? " disabled" : ""}`} ref={rootRef}>
    <button ref={triggerRef} type="button" className="hero-select-trigger" aria-label={ariaLabel} aria-haspopup="listbox" aria-expanded={open} aria-controls={listId} disabled={disabled} onClick={() => setOpen((current) => !current)} onKeyDown={handleTriggerKey}>
      <span>{selected?.label ?? "Select…"}</span><i aria-hidden="true" />
    </button>
    {open && <div className="hero-select-options" id={listId} role="listbox" aria-label={ariaLabel}>{options.map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === selected?.value} className={option.value === selected?.value ? "selected" : ""} onKeyDown={handleOptionKey} onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus(); }}>{option.label}</button>)}</div>}
  </div>;
}

export function HeroHub({ heroes, items, initialHeroId, onOpenBuild, onOpenPlayer }: Props) {
  const [response, setResponse] = useState<{ key: string; stats: HeroStat[]; error: boolean } | null>(null);
  const [trendResponse, setTrendResponse] = useState<{ key: string; stats: HeroStat[] } | null>(null);
  const [pickBanResponse, setPickBanResponse] = useState<{ key: string; totalPlayers: number; totalMatches: number; bans: HeroBanStat[] } | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<"matches" | "winrate" | "name">("matches");
  const [mode, setMode] = useState("all");
  const [days, setDays] = useState(30);
  const [patches, setPatches] = useState<ClientPatch[]>([]);
  const [selectedPatch, setSelectedPatch] = useState("all");
  const [rankTier, setRankTier] = useState("all");
  const [selected, setSelected] = useState<Hero | null>(() => heroes.find((hero) => hero.id === initialHeroId) ?? null);
  const [profileTab, setProfileTab] = useState<ProfileTab>("overview");
  const [profileData, setProfileData] = useState<ProfileData | null>(null);
  const [leaderMetric, setLeaderMetric] = useState<LeaderSort>("rank");
  const [heroItemSort, setHeroItemSort] = useState<"popular" | "winrate">("popular");
  const [heroBuildSort, setHeroBuildSort] = useState<"popular" | "winrate">("popular");
  const [abilityOrderSort, setAbilityOrderSort] = useState<"popular" | "winrate">("popular");
  const [abilityItemIds, setAbilityItemIds] = useState<number[]>([]);
  const [abilityItemSearch, setAbilityItemSearch] = useState("");
  const [leaderboard, setLeaderboard] = useState<{ key: string; rows: ScoreboardEntry[]; names: SteamProfile[]; ranks: PlayerRank[]; error: boolean } | null>(null);
  const [sameLaneOnly, setSameLaneOnly] = useState(true);
  const [matchupView, setMatchupView] = useState<"tough" | "favorable">("tough");
  const requestKey = `${mode}:${days}:${rankTier}:${selectedPatch}`;
  const busy = response?.key !== requestKey;
  const error = response?.key === requestKey && response.error;
  const stats = response?.key === requestKey ? response.stats : EMPTY_STATS;
  const profileKey = selected ? `${selected.id}:${requestKey}:${profileTab}:${profileTab === "matchups" ? sameLaneOnly : profileTab === "abilities" ? abilityItemIds.join(",") : ""}` : "";
  const profileBusy = Boolean(selected && profileData?.key !== profileKey);
  const profile = profileData?.key === profileKey || (selected && profileData?.heroId === selected.id && profileData.tab === profileTab) ? profileData : null;
  const leaderboardKey = selected ? `${selected.id}:${requestKey}:${leaderMetric}` : "";
  const leaderboardBusy = profileTab === "leaderboard" && Boolean(selected && leaderboard?.key !== leaderboardKey);
  const leaderboardData = leaderboard?.key === leaderboardKey ? leaderboard : null;

  useEffect(() => {
    let active = true;
    void cachedJson<ClientPatch[]>(`${API}/assets/steam-info/all`, 6 * 60 * 60 * 1000).then((rows) => {
      if (active) setPatches(Array.isArray(rows) ? rows.filter((row) => Number.isFinite(row.client_version) && Boolean(row.version_datetime)).sort((a, b) => Date.parse(`${b.version_datetime}Z`) - Date.parse(`${a.version_datetime}Z`)) : []);
    }).catch(() => { if (active) setPatches([]); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const query = new URLSearchParams({ bucket: "no_bucket", game_mode: "normal", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - days * 86400) });
    applyPatchWindow(query, patches, selectedPatch);
    if (mode !== "all") query.set("match_mode", mode);
    if (rankTier !== "all") { query.set("min_average_badge", String(Number(rankTier) * 10 + 1)); query.set("max_average_badge", String(Number(rankTier) * 10 + 6)); }
    const pickQuery = new URLSearchParams(query); pickQuery.set("bucket", "no_bucket");
    const trendQuery = new URLSearchParams(query); trendQuery.set("bucket", "start_time_week");
    const banQuery = new URLSearchParams({ bucket: "no_bucket", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - days * 86400) });
    applyPatchWindow(banQuery, patches, selectedPatch);
    if (mode !== "all") banQuery.set("match_mode", mode);
    if (rankTier !== "all") { banQuery.set("min_average_badge", String(Number(rankTier) * 10 + 1)); banQuery.set("max_average_badge", String(Number(rankTier) * 10 + 6)); }
    Promise.allSettled([cachedJson<HeroStat[]>(`${API}/analytics/hero-stats?${query}`), cachedJson<GameStats[]>(`${API}/analytics/game-stats?${pickQuery}`), cachedJson<HeroBanStat[]>(`${API}/analytics/hero-ban-stats?${banQuery}`), cachedJson<HeroStat[]>(`${API}/analytics/hero-stats?${trendQuery}`)]).then(([heroResult, gameResult, banResult, trendResult]) => {
      if (!active) return;
      if (heroResult.status === "fulfilled") setResponse({ key: requestKey, stats: Array.isArray(heroResult.value) ? heroResult.value : [], error: false });
      else setResponse({ key: requestKey, stats: [], error: true });
      const games = gameResult.status === "fulfilled" ? gameResult.value : [];
      const bans = banResult.status === "fulfilled" ? banResult.value : [];
      setPickBanResponse({ key: requestKey, totalPlayers: games.reduce((sum, row) => sum + row.total_players, 0), totalMatches: games.reduce((sum, row) => sum + row.total_matches, 0), bans });
      setTrendResponse({ key: requestKey, stats: trendResult.status === "fulfilled" ? trendResult.value : [] });
    });
    return () => { active = false; };
  }, [days, mode, patches, rankTier, requestKey, selectedPatch]);

  useEffect(() => {
    if (!selected || profileTab === "leaderboard") return;
    let active = true;
    const params = new URLSearchParams({ min_matches: "10", game_mode: "normal", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - days * 86400) });
    applyPatchWindow(params, patches, selectedPatch);
    if (mode !== "all") params.set("match_mode", mode);
    if (rankTier !== "all") { params.set("min_average_badge", String(Number(rankTier) * 10 + 1)); params.set("max_average_badge", String(Number(rankTier) * 10 + 6)); }
    const abilityParams = new URLSearchParams(params); abilityParams.set("hero_id", String(selected.id)); abilityParams.set("min_matches", "5");
    if (abilityItemIds.length) abilityParams.set("include_item_ids", abilityItemIds.join(","));
    const counterParams = new URLSearchParams(params); counterParams.set("same_lane_filter", String(sameLaneOnly));
    const [itemUrl, counterUrl] = [itemStatsUrl(selected.id, params), `${API}/analytics/hero-counter-stats?${counterParams}`];
    const durationUrl = (min: number, max: number) => {
      const durationParams = new URLSearchParams({ bucket: "no_bucket", game_mode: "normal", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - days * 86400), min_duration_s: String(min), max_duration_s: String(max) });
      applyPatchWindow(durationParams, patches, selectedPatch);
      if (mode !== "all") durationParams.set("match_mode", mode);
      if (rankTier !== "all") { durationParams.set("min_average_badge", String(Number(rankTier) * 10 + 1)); durationParams.set("max_average_badge", String(Number(rankTier) * 10 + 6)); }
      return `${API}/analytics/hero-stats?${durationParams}`;
    };
    const buildPerformanceParams = new URLSearchParams({ min_matches: "5", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - days * 86400) });
    applyPatchWindow(buildPerformanceParams, patches, selectedPatch);
    if (mode !== "all") buildPerformanceParams.set("match_mode", mode);
    if (rankTier !== "all") { buildPerformanceParams.set("min_average_badge", String(Number(rankTier) * 10 + 1)); buildPerformanceParams.set("max_average_badge", String(Number(rankTier) * 10 + 6)); }
    const guideParams = new URLSearchParams({ hero_id: String(selected.id), sort_by: "weekly_favorites", sort_direction: "desc", start: "0", limit: "100", only_latest: "true", build_language: "English" });
    const flowParams = new URLSearchParams(params); flowParams.set("hero_ids", String(selected.id));
    const trendParams = new URLSearchParams({ bucket: "start_time_week", game_mode: "normal", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - days * 86400) });
    const rankParams = new URLSearchParams({ bucket: "avg_badge", game_mode: "normal", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - days * 86400) });
    applyPatchWindow(trendParams, patches, selectedPatch); applyPatchWindow(rankParams, patches, selectedPatch);
    if (mode !== "all") { trendParams.set("match_mode", mode); rankParams.set("match_mode", mode); }
    void Promise.allSettled([
      profileTab === "builds" ? cachedJson<ItemStat[]>(itemUrl) : Promise.resolve([] as ItemStat[]),
      profileTab === "builds" ? cachedJson<unknown>(`${API}/analytics/build-item-stats?hero_id=${selected.id}&min_last_updated_unix_timestamp=${Math.floor(Date.now() / 1000) - days * 86400}`, 60 * 60 * 1000) : Promise.resolve([]),
      profileTab === "abilities" ? cachedJson<unknown>(`${API}/analytics/ability-order-stats?${abilityParams}`, 60 * 60 * 1000) : Promise.resolve([]),
      profileTab === "matchups" ? cachedJson<CounterStat[]>(counterUrl) : Promise.resolve([] as CounterStat[]),
      profileTab === "abilities" ? cachedJson<AbilityAsset[]>(`${API}/assets/items/by-hero-id/${selected.id}?language=english`, 24 * 60 * 60 * 1000) : Promise.resolve([] as AbilityAsset[]),
      profileTab === "overview" ? cachedJson<HeroStat[]>(`${API}/analytics/hero-stats?${trendParams}`, 60 * 60 * 1000) : Promise.resolve([] as HeroStat[]),
      profileTab === "overview" ? cachedJson<HeroStat[]>(`${API}/analytics/hero-stats?${rankParams}`, 60 * 60 * 1000) : Promise.resolve([] as HeroStat[]),
      profileTab === "overview" ? Promise.all([cachedJson<HeroStat[]>(durationUrl(0, 899)), cachedJson<HeroStat[]>(durationUrl(900, 1499)), cachedJson<HeroStat[]>(durationUrl(1500, 7000))]) : Promise.resolve([] as HeroStat[][]),
      profileTab === "matchups" ? cachedJson<SynergyStat[]>(`${API}/analytics/hero-synergy-stats?${counterParams}`, 60 * 60 * 1000) : Promise.resolve([] as SynergyStat[]),
      profileTab === "builds" ? cachedJson<CommunityBuild[]>(`${API}/builds?${guideParams}`, 60 * 60 * 1000) : Promise.resolve([] as CommunityBuild[]),
      profileTab === "builds" ? cachedJson<HeroBuildStat[]>(`${API}/analytics/hero-build-stats/${selected.id}?${buildPerformanceParams}`, 60 * 60 * 1000) : Promise.resolve([] as HeroBuildStat[]),
      profileTab === "builds" ? itemFlowStats(`${API}/analytics/item-flow-stats?${flowParams}`) : Promise.resolve(null as ItemFlowStats | null),
    ]).then((results) => {
      if (!active) return;
      const value = <T,>(index: number, fallback: T): T => results[index].status === "fulfilled" ? results[index].value as T : fallback;
      const builds = value<unknown>(1, []);
      const orders = value<unknown>(2, []);
      setProfileData({
        key: profileKey,
        heroId: selected.id,
        tab: profileTab,
        items: value<ItemStat[]>(0, []),
        flow: value<ItemFlowStats | null>(11, null),
        builds: Array.isArray(builds) ? builds.filter((row): row is { item_id: number; builds: number } => Boolean(row && typeof row === "object" && Number.isInteger((row as { item_id?: number }).item_id) && Number.isFinite((row as { builds?: number }).builds))).sort((a, b) => b.builds - a.builds) : [],
        orders: Array.isArray(orders) ? orders.filter((row): row is AbilityOrder => Boolean(row && typeof row === "object" && Array.isArray((row as AbilityOrder).abilities) && Number.isFinite((row as AbilityOrder).matches) && Number.isFinite((row as AbilityOrder).wins))).sort((a, b) => b.matches - a.matches) : [],
        counters: value<CounterStat[]>(3, []).filter((row) => row.hero_id === selected.id),
        abilities: value<AbilityAsset[]>(4, []),
        trends: value<HeroStat[]>(5, []).filter((row) => row.hero_id === selected.id).sort((a, b) => a.bucket - b.bucket),
        ranks: value<HeroStat[]>(6, []).filter((row) => row.hero_id === selected.id && getRankTier(row.bucket) != null).sort((a, b) => a.bucket - b.bucket),
        durations: groupDurationSamples(value<HeroStat[][]>(7, []), selected.id).flat(),
        synergies: value<SynergyStat[]>(8, []).filter((row) => row.hero_id1 === selected.id || row.hero_id2 === selected.id),
        guides: value<CommunityBuild[]>(9, []).filter((row) => row?.hero_build?.hero_id === selected.id),
        buildPerformance: value<HeroBuildStat[]>(10, []).filter((row) => row.hero_id === selected.id),
      });
    });
    return () => { active = false; };
  }, [abilityItemIds, days, mode, patches, profileTab, rankTier, requestKey, sameLaneOnly, selected, selectedPatch]);

  useEffect(() => {
    if (!selected || profileTab !== "leaderboard") return;
    let active = true;
    const query = new URLSearchParams({ sort_by: leaderMetric, sort_direction: "desc", hero_id: String(selected.id), min_matches: "10", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - days * 86400), limit: "25", start: "0" });
    applyPatchWindow(query, patches, selectedPatch);
    if (mode !== "all") query.set("match_mode", mode);
    if (rankTier !== "all") { query.set("min_average_badge", String(Number(rankTier) * 10 + 1)); query.set("max_average_badge", String(Number(rankTier) * 10 + 6)); }
    void (async () => {
      try {
        const rows = await cachedJson<ScoreboardEntry[]>(`${API}/analytics/scoreboards/players?${query}`, 60 * 60 * 1000);
        const accounts = rows.map((row) => row.account_id);
        const [nameResult, rankResult] = await Promise.allSettled(accounts.length ? [
          cachedJson<SteamProfile[]>(`${API}/players/steam?account_ids=${accounts.join(",")}`, 24 * 60 * 60 * 1000),
          cachedJson<PlayerRank[]>(`${API}/players/rank?account_ids=${accounts.join(",")}`, 60 * 60 * 1000),
        ] : [Promise.resolve([] as SteamProfile[]), Promise.resolve([] as PlayerRank[])]);
        if (active) setLeaderboard({ key: `${selected.id}:${requestKey}:${leaderMetric}`, rows, names: nameResult.status === "fulfilled" ? nameResult.value : [], ranks: rankResult.status === "fulfilled" ? rankResult.value : [], error: false });
      } catch {
        if (active) setLeaderboard({ key: `${selected.id}:${requestKey}:${leaderMetric}`, rows: [], names: [], ranks: [], error: true });
      }
    })();
    return () => { active = false; };
  }, [days, leaderMetric, mode, patches, profileTab, rankTier, requestKey, selected, selectedPatch]);

  const trendRows = profile?.trends ?? [];
  const trendPoints = trendRows.map((row, index) => ({ ...row, rate: row.matches ? row.wins / row.matches : 0, x: trendRows.length > 1 ? (index / (trendRows.length - 1)) * 100 : 50 })).filter((row) => row.matches > 0);
  const trendLine = trendPoints.map((row, index) => `${index ? "L" : "M"}${row.x},${42 - row.rate * 36}`).join(" ");
  const trendDelta = trendPoints.length > 1 ? (trendPoints.at(-1)!.rate - trendPoints[0].rate) * 100 : null;
  const rankSummaries = aggregateRankSamples(profile?.ranks ?? [], (bucket) => {
    const tier = getRankTier(bucket);
    return tier == null ? null : { tier, label: formatRank(tier * 10 + 1).replace(/ I$/, "") };
  });
  const abilityItemChoices = items.filter((item) => item.name.toLowerCase().includes(abilityItemSearch.trim().toLowerCase())).slice(0, 24);
  const guideRows = sortBuilds((profile?.guides ?? []).map((guide) => ({ guide, performance: profile?.buildPerformance.find((row) => row.hero_build_id === guide.hero_build.hero_build_id) ?? null })), heroBuildSort, (row) => row.guide.num_weekly_favorites ?? row.guide.num_favorites ?? 0, (row) => row.performance).slice(0, 10);
  const itemPhases = [["Early · under 10 min", 0, 600], ["Mid · 10–20 min", 600, 1200], ["Late · 20+ min", 1200, Infinity]] as const;
  const flowTransitions = (profile?.flow?.edges ?? []).slice().sort((a, b) => b.matches - a.matches).slice(0, 9);
  const playableAbilities = (profile?.abilities ?? []).filter((asset) => asset.hero === detail?.hero.id && asset.ability_type !== "melee" && asset.name);
  const abilityById = new Map(playableAbilities.flatMap((asset) => asset.id != null ? [[asset.id, asset] as const] : []));
  const leaderboardRows = (leaderboardData?.rows ?? []).slice().sort((a, b) => leaderMetric === "rank" ? b.value - a.value || b.matches - a.matches : b.matches - a.matches || b.value - a.value);

  const rows = useMemo(() => {
    const byId = new Map<number, HeroStat>();
    for (const row of stats) {
      const prev = byId.get(row.hero_id);
      if (!prev || row.matches > prev.matches) byId.set(row.hero_id, row);
    }
    return heroes.filter((hero) => hero.name.toLowerCase().includes(search.toLowerCase()))
      .map((hero) => ({ hero, stat: byId.get(hero.id) }))
      .sort((a, b) => sort === "name" ? a.hero.name.localeCompare(b.hero.name) : sort === "winrate" ? ((b.stat?.wins ?? 0) / Math.max(1, b.stat?.matches ?? 0)) - ((a.stat?.wins ?? 0) / Math.max(1, a.stat?.matches ?? 0)) : (b.stat?.matches ?? 0) - (a.stat?.matches ?? 0));
  }, [heroes, search, sort, stats]);

  const detail = selected && (rows.find((row) => row.hero.id === selected.id) ?? { hero: selected, stat: stats.find((row) => row.hero_id === selected.id) });
  const detailSelectionMetrics = pickBanResponse?.key === requestKey ? pickBanResponse : null;
  const detailPickRate = detail?.stat?.matches && detailSelectionMetrics?.totalPlayers ? 100 * detail.stat.matches / detailSelectionMetrics.totalPlayers : null;
  const detailBans = detail ? detailSelectionMetrics?.bans.find((row) => row.hero_id === detail.hero.id)?.bans : null;
  const detailBanRate = detailBans != null && detailSelectionMetrics?.totalMatches ? 100 * detailBans / detailSelectionMetrics.totalMatches : null;
  return <main className="hero-hub-page">
    {detail ? <>
      <button className="hero-hub-back" type="button" onClick={() => setSelected(null)}>← ALL HEROES</button>
      <section className="hero-profile-hero">
        {detail.hero.images?.icon_hero_card_webp && <img src={detail.hero.images.icon_hero_card_webp} alt="" />}
        <div><small>HERO PROFILE / CURRENT META</small><h1>{detail.hero.name}</h1><p>{detail.hero.description?.playstyle ?? detail.hero.description?.lore ?? `Recent performance across ${days} days of ${mode === "all" ? "ranked and unranked" : mode} matches.`}</p><div className="hero-profile-tags">{[detail.hero.description?.role, detail.hero.hero_type, ...(detail.hero.tags ?? [])].filter((tag): tag is string => Boolean(tag)).slice(0, 5).map((tag) => <span key={tag}>{tag.replaceAll("_", " ")}</span>)}</div></div>
        <button type="button" onClick={() => onOpenBuild(detail.hero.id)}>OPEN BUILD LAB →</button>
      </section>
      <nav className="hero-profile-tabs" aria-label="Hero profile sections">{(["overview", "builds", "abilities", "matchups", "leaderboard"] as const).map((tab) => <button type="button" className={profileTab === tab ? "active" : ""} key={tab} onClick={() => setProfileTab(tab)}>{tab}</button>)}</nav>
      {profileBusy && <div className="hero-profile-refresh" role="status">{profile ? "Refreshing this section; previous results stay visible until the new sample arrives." : "Loading this hero section…"}</div>}
      {(!profileBusy || profile) && <>
      {profileTab === "overview" && <div className="hero-profile-metrics">
        <article><small>WIN RATE</small><strong>{detail.stat?.matches ? `${(100 * detail.stat.wins / detail.stat.matches).toFixed(1)}%` : "—"}</strong><span>of tracked games</span></article>
        <article><small>MATCHES</small><strong>{detail.stat?.matches.toLocaleString() ?? "—"}</strong><span>in selected window</span></article>
        <article><small>W / L</small><strong>{detail.stat ? `${detail.stat.wins.toLocaleString()} / ${detail.stat.losses.toLocaleString()}` : "—"}</strong><span>tracked results</span></article>
        <article><small>PICK SHARE</small><strong>{detailPickRate == null ? "—" : `${detailPickRate.toFixed(1)}%`}</strong><span>of reported player appearances</span></article>
        <article><small>BAN RATE</small><strong>{detailBanRate == null ? "—" : `${detailBanRate.toFixed(1)}%`}</strong><span>{detailBans?.toLocaleString() ?? "—"} bans / {detailSelectionMetrics?.totalMatches.toLocaleString() ?? "—"} matches</span></article>
      </div>
      }
      {profileTab === "overview" && <section className="hero-profile-panel hero-base-stats"><div className="hero-profile-panel-head"><div><small>HERO BASELINE</small><h2>Starting stats & per-level growth</h2><p>Starting values and numeric per-level fields from the current hero asset. Per-level fields retain the API’s stat naming.</p></div></div><div className="hero-base-stat-grid">{Object.entries(detail.hero.starting_stats ?? {}).filter(([, entry]) => typeof entry === "number" || Number.isFinite(entry.value)).map(([key, entry]) => { const value = typeof entry === "number" ? entry : entry.value; const label = typeof entry === "number" ? statLabel(key) : statLabel(key, entry.display_stat_name); return <article key={key}><small>{label}</small><strong>{Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></article>; })}{!Object.keys(detail.hero.starting_stats ?? {}).length && <p className="hero-profile-footnote">Starting stats are unavailable in the current hero asset response.</p>}</div>{Object.keys(detail.hero.standard_level_up_upgrades ?? {}).length > 0 && <><h3 className="hero-base-growth-title">NUMERIC LEVEL-UP UPGRADES</h3><div className="hero-base-stat-grid">{Object.entries(detail.hero.standard_level_up_upgrades ?? {}).map(([key, value]) => <article key={key}><small>{statLabel(key.replace(/^MODIFIER_VALUE_/, "").replace(/_FROM_LEVEL$/, "").replaceAll("_", " "))} / level</small><strong>{value >= 0 ? "+" : ""}{Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })}</strong></article>)}</div></>}</section>}
      {profileTab === "overview" && <><div className="hero-profile-analysis-grid"><section className="hero-profile-panel"><div className="hero-profile-panel-head"><div><small>WEEKLY PERFORMANCE</small><h2>Win rate trend</h2></div>{trendDelta != null && <b className={trendDelta >= 0 ? "trend-up" : "trend-down"}>{trendDelta > 0 ? "+" : ""}{trendDelta.toFixed(1)} pp</b>}</div>{trendPoints.length > 1 ? <><svg className="hero-trend-chart" viewBox="0 0 100 46" role="img" aria-label="Weekly win rate trend"><path d="M0 24H100" /><path className="trend-path" d={trendLine} /></svg><div className="hero-trend-labels"><span>{new Date(trendRows[0]?.bucket * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><span>{new Date(trendRows.at(-1)!.bucket * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></div></> : <p className="hero-profile-footnote">Not enough weekly samples for a trend.</p>}</section><section className="hero-profile-panel rank-performance"><div className="hero-profile-panel-head"><div><small>PERFORMANCE BY RANK</small><h2>Win rate across ranks</h2></div></div>{rankSummaries.length ? rankSummaries.map((row) => <div className="rank-performance-row" key={row.tier}><span>{row.label}</span><i><b style={{ width: `${row.rate * 100}%` }} /></i><strong>{(row.rate * 100).toFixed(1)}%</strong><small>{row.matches.toLocaleString()}</small></div>) : <p className="hero-profile-footnote">No rank breakdown is available for this window.</p>}</section></div><section className="hero-profile-panel duration-panel"><div className="hero-profile-panel-head"><div><small>PERFORMANCE BY GAME DURATION</small><h2>How the game length changes the result</h2></div></div><div className="duration-stats">{(["Early · 0–15 min", "Mid · 15–25 min", "Late · 25+ min"] as const).map((label, index) => { const row = profile?.durations[index]; return <article key={label}><small>{label}</small><strong>{row?.matches ? `${(100 * row.wins / row.matches).toFixed(1)}%` : "—"}</strong><span>{row?.matches ? `${row.matches.toLocaleString()} matches` : "No sample"}</span></article>; })}</div></section></>}
      {profileTab === "builds" && <>
        <section className="hero-profile-panel">
          <div className="hero-profile-panel-head"><div><small>ITEM PERFORMANCE</small><h2>{heroItemSort === "popular" ? `Popular buys on ${detail.hero.name}` : `Best-performing items on ${detail.hero.name}`}</h2><p>Item-level match outcomes; this is not a complete build win-rate comparison.</p></div><div className="hero-profile-actions"><label className="leaderboard-metric"><span>SORT</span><HeroSelect ariaLabel="Sort hero item outcomes" value={heroItemSort} options={[{ value: "popular", label: "Most matches" }, { value: "winrate", label: "Highest win rate · 25+ matches" }]} onChange={(value) => setHeroItemSort(value as typeof heroItemSort)} /></label><button type="button" onClick={() => onOpenBuild(detail.hero.id)}>OPEN BUILD LAB →</button></div></div>
          <div className="hero-profile-list">{sortHeroItems(profile?.items ?? [], heroItemSort).slice(0, 12).map((row) => { const item = items.find((entry) => entry.id === row.item_id); return <article key={row.item_id}>{item?.shop_image_webp && <img src={item.shop_image_webp} alt="" />}<strong>{item?.name ?? `Item ${row.item_id}`}</strong><span>{row.matches.toLocaleString()} matches · {detail.stat?.matches ? `${(100 * row.matches / detail.stat.matches).toFixed(1)}% item pick share` : "pick share unavailable"}</span><b>{row.matches ? `${(100 * row.wins / row.matches).toFixed(1)}% WR` : "—"}</b><small>{row.avg_buy_time_s ? `${Math.floor(row.avg_buy_time_s / 60)}:${String(Math.floor(row.avg_buy_time_s % 60)).padStart(2, "0")} avg buy` : ""}</small></article>; })}</div>
          {heroItemSort === "winrate" && !(profile?.items ?? []).some((row) => row.matches >= 25) && <p className="hero-profile-footnote">No item has reached the 25-match minimum in this filter window.</p>}
          <p className="hero-profile-footnote">These are item outcomes, not build outcomes. The build records below track community guides and first-selected build performance separately.</p>
        </section>
        <section className="hero-profile-panel">
          <div className="hero-profile-panel-head"><div><small>BUY TIMING & BUILD PATHS</small><h2>Items by game phase</h2><p>Grouped by average purchase time. Item flow shows common next purchases after a starting item; these are observed paths, not prescriptions.</p></div></div>
          <div className="hero-item-phase-grid">{itemPhases.map(([label, min, max]) => { const rows = (profile?.items ?? []).filter((row) => row.avg_buy_time_s >= min && row.avg_buy_time_s < max).sort((a, b) => b.matches - a.matches).slice(0, 4); return <article key={label}><small>{label}</small>{rows.map((row) => <div key={row.item_id}><span>{items.find((item) => item.id === row.item_id)?.name ?? `Item ${row.item_id}`}</span><b>{Math.floor(row.avg_buy_time_s / 60)}m · {row.matches.toLocaleString()}</b></div>)}{!rows.length && <p>No item timing sample.</p>}</article>; })}</div>
          <div className="hero-build-guide-list">{flowTransitions.map((edge) => { const from = items.find((item) => item.id === edge.from_item_id), to = items.find((item) => item.id === edge.to_item_id); return <article key={`${edge.from_column}-${edge.from_item_id}-${edge.to_item_id}`}><div><strong>{from?.name ?? `Item ${edge.from_item_id}`} → {to?.name ?? `Item ${edge.to_item_id}`}</strong><small>Stage {edge.from_column + 1} · common follow-up</small></div><span>{edge.matches.toLocaleString()} transitions</span><b>{edge.matches ? `${(100 * edge.wins / edge.matches).toFixed(1)}% WR` : "—"}</b></article>; })}</div>
          {!flowTransitions.length && <p className="hero-profile-footnote">No item-flow paths are available for the selected filters.</p>}
        </section>
        <section className="hero-profile-panel">
          <div className="hero-profile-panel-head"><div><small>COMMUNITY BUILDS</small><h2>{heroBuildSort === "popular" ? "Popular guides" : "Highest win-rate starting builds"}</h2><p>Popularity comes from weekly guide favorites. Outcome data records the first guide selected at match start and does not track later build edits.</p></div><label className="leaderboard-metric"><span>SORT</span><HeroSelect ariaLabel="Sort community builds" value={heroBuildSort} options={[{ value: "popular", label: "Weekly favorites" }, { value: "winrate", label: "Win rate · 20+ matches" }]} onChange={(value) => setHeroBuildSort(value as typeof heroBuildSort)} /></label></div>
          {guideRows.length ? <div className="hero-build-guide-list">{guideRows.map(({ guide, performance }) => <article key={guide.hero_build.hero_build_id}><div><strong>{guide.hero_build.name}</strong><small>BUILD {guide.hero_build.hero_build_id} · {guide.num_weekly_favorites ?? guide.num_favorites ?? 0} favorites this week</small>{guide.hero_build.description && <p>{guide.hero_build.description}</p>}</div><span>{performance ? `${performance.matches.toLocaleString()} matches · ${performance.players.toLocaleString()} players` : "No matching outcome sample"}</span><b>{performance?.matches ? `${(100 * performance.wins / performance.matches).toFixed(1)}% WR` : "—"}</b></article>)}</div> : <p className="hero-profile-footnote">{heroBuildSort === "winrate" ? "No community build has reached 20 outcome matches in this filter window." : "No English community guides are available for this hero right now."}</p>}
          <p className="hero-profile-footnote">Guide popularity is not evidence of win rate. Build outcomes use a separate match sample and are observational.</p>
        </section>
      </>}
      {profileTab === "abilities" && <>
        <section className="hero-profile-panel">
          <div className="hero-profile-panel-head"><div><small>HERO ABILITIES</small><h2>Ability details</h2><p>Descriptions and upgrades are shown as readable text from the current hero assets.</p></div></div>
          {playableAbilities.length ? <div className="hero-ability-grid">{playableAbilities.map((asset, index) => <article key={asset.id ?? asset.ability_id ?? asset.name}>{(asset.image_webp ?? asset.image ?? asset.shop_image_webp) && <img src={asset.image_webp ?? asset.image ?? asset.shop_image_webp} alt="" />}<div><small>ABILITY {index + 1} · {asset.ability_type === "ultimate" ? "ULTIMATE" : "SKILL"}</small><strong>{asset.name}</strong><p>{abilityText(asset)}</p>{asset.description && typeof asset.description !== "string" && [asset.description.t1_desc, asset.description.t2_desc, asset.description.t3_desc].map((upgrade, level) => upgrade ? <span key={level}>T{level + 1}: {plainAbilityText(upgrade)}</span> : null)}{Object.entries(asset.properties ?? {}).filter(([, property]) => property.label && property.value != null && property.value !== "0" && property.value !== 0).slice(0, 5).map(([id, property]) => <span key={id}>{property.label}: {plainAbilityText(property.value!)}{property.postfix ?? ""}{property.scale_function?.specific_stat_scale_type ? ` · scales with ${statLabel(property.scale_function.specific_stat_scale_type)}` : ""}</span>)}</div></article>)}</div> : <p className="hero-profile-footnote">Ability assets are unavailable for this hero right now.</p>}
        </section>
        <section className="hero-profile-panel ability-item-conditioning">
          <div className="hero-profile-panel-head"><div><small>BUILD-CONDITIONED SKILL ORDERS</small><h2>Filter orders by purchased items</h2><p>Shows historical upgrade orders from players who bought every selected item. Rank and time filters above still apply.</p></div></div>
          <input aria-label="Search items for ability-order filter" value={abilityItemSearch} onChange={(event) => setAbilityItemSearch(event.target.value)} placeholder="Search items…" />
          <div className="ability-item-choices">{abilityItemChoices.map((item) => <button key={item.id} type="button" className={abilityItemIds.includes(item.id) ? "selected" : ""} aria-pressed={abilityItemIds.includes(item.id)} onClick={() => setAbilityItemIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : current.length < 4 ? [...current, item.id] : current)}>{item.shop_image_webp && <img src={item.shop_image_webp} alt="" />}<span>{item.name}</span></button>)}</div>
          <div className="ability-item-selected">{abilityItemIds.length ? `Filtering on ${abilityItemIds.map((id) => items.find((item) => item.id === id)?.name ?? `Item ${id}`).join(" + ")}` : "No item filter · all hero upgrade orders"}<button type="button" disabled={!abilityItemIds.length} onClick={() => setAbilityItemIds([])}>CLEAR</button></div>
        </section>
        <section className="hero-profile-panel ability-orders-panel">
          <div className="hero-profile-panel-head"><div><small>ABILITY ORDERS</small><h2>{abilityOrderSort === "popular" ? "Most played upgrade paths" : "Highest win rate orders · 20+ matches"}</h2><p>Each cell is one skill point: its top number is the point order, and A1–A4 identifies the ability.</p></div><label className="leaderboard-metric"><span>SORT</span><HeroSelect ariaLabel="Sort ability orders" value={abilityOrderSort} options={[{ value: "popular", label: "Most played" }, { value: "winrate", label: "Win rate · 20+ matches" }]} onChange={(value) => setAbilityOrderSort(value as typeof abilityOrderSort)} /></label></div>
          <div className="ability-order-legend">{playableAbilities.map((asset, index) => <span key={asset.id ?? asset.name}><b>A{index + 1}</b>{asset.name}</span>)}</div>
          <div className="hero-profile-list ability-order-list">{(profile?.orders ?? []).filter((order) => abilityOrderSort !== "winrate" || order.matches >= 20).slice().sort((a, b) => abilityOrderSort === "popular" ? b.matches - a.matches : b.wins / Math.max(1, b.matches) - a.wins / Math.max(1, a.matches)).slice(0, 10).map((order, index) => <article key={`${order.abilities.join("-")}-${index}`}><strong className="ability-order-rank">#{index + 1}</strong><div className="ability-sequence">{order.abilities.map((id, position) => { const asset = abilityById.get(id); const slot = asset ? playableAbilities.indexOf(asset) + 1 : 0; return <span className={`ability-order-step ability-order-step-${slot || "unknown"}`} key={`${id}-${position}`} title={`${position + 1}. ${asset?.name ?? "Unknown ability"}`}><small>{position + 1}</small><b>{slot ? `A${slot}` : "?"}</b></span>; })}</div><span className="ability-order-sample">{order.matches.toLocaleString()} matches</span><b className="ability-order-rate">{order.matches ? `${(100 * order.wins / order.matches).toFixed(1)}% WR` : "—"}</b></article>)}</div>
          {abilityItemIds.length > 0 && !profile?.orders.length && <p className="hero-profile-footnote">No order rows met the current filters; clear an item or widen the rank and time window.</p>}
        </section>
      </>}
      {profileTab === "matchups" && <><section className="hero-profile-panel"><div className="hero-profile-panel-head"><div><small>HERO MATCHUPS</small><h2>{matchupView === "tough" ? "Toughest opponents" : "Most favorable opponents"}</h2></div><label className="matchup-lane-toggle"><input type="checkbox" checked={sameLaneOnly} onChange={(event) => setSameLaneOnly(event.target.checked)} /> Same lane only</label></div><div className="hero-matchup-toggle"><button type="button" className={matchupView === "tough" ? "active" : ""} onClick={() => setMatchupView("tough")}>Tough matchups</button><button type="button" className={matchupView === "favorable" ? "active" : ""} onClick={() => setMatchupView("favorable")}>Favorable matchups</button></div><div className="hero-profile-list matchup-list">{sortMatchups(profile?.counters ?? [], matchupView).map((row) => ({ row, enemy: heroes.find((hero) => hero.id === row.enemy_hero_id), delta: detail.stat?.matches ? (row.wins / row.matches_played - detail.stat.wins / detail.stat.matches) * 100 : null })).slice(0, 12).map(({ row, enemy, delta }) => <article key={row.enemy_hero_id}>{enemy?.images?.icon_image_small_webp && <img src={enemy.images.icon_image_small_webp} alt="" />}<strong>{enemy?.name ?? `Hero ${row.enemy_hero_id}`}</strong><span>{row.matches_played.toLocaleString()} matches · {row.matches_played >= 200 ? "strong sample" : row.matches_played >= 50 ? "medium sample" : "limited sample"}</span><b className={row.wins / row.matches_played >= .5 ? "matchup-good" : "matchup-hard"}>{(100 * row.wins / row.matches_played).toFixed(1)}% WR</b><small>{delta == null ? "— vs hero avg" : `${delta > 0 ? "+" : ""}${delta.toFixed(1)} pp vs hero avg`}</small></article>)}</div><p className="hero-profile-footnote">Delta compares matchup win rate with this hero’s overall rate under the selected filters. Observational, not causal.</p></section><section className="hero-profile-panel teammate-panel"><div className="hero-profile-panel-head"><div><small>TEAM SYNERGY</small><h2>Most successful teammates</h2></div></div><div className="hero-profile-list matchup-list">{(profile?.synergies ?? []).filter((row) => row.matches_played >= 10).map((row) => ({ row, allyId: row.hero_id1 === detail.hero.id ? row.hero_id2 : row.hero_id1, rate: row.wins / row.matches_played })).sort((a, b) => b.rate - a.rate).slice(0, 8).map(({ row, allyId, rate }) => { const ally = heroes.find((hero) => hero.id === allyId); return <article key={allyId}>{ally?.images?.icon_image_small_webp && <img src={ally.images.icon_image_small_webp} alt="" />}<strong>{ally?.name ?? `Hero ${allyId}`}</strong><span>{row.matches_played.toLocaleString()} matches together</span><b className="matchup-good">{(100 * rate).toFixed(1)}% team WR</b></article>; })}</div><p className="hero-profile-footnote">Pair results are historical team win rates, not a causal estimate of either hero’s effect.</p></section></>}
      {profileTab === "leaderboard" && <section className="hero-profile-panel"><div className="hero-profile-panel-head"><div><small>TOP PLAYERS / {detail.hero.name.toUpperCase()}</small><h2>Hero leaderboard</h2><p>Players with at least 10 matches on this hero, ordered by current rank or matches played.</p></div><label className="leaderboard-metric"><span>SORT BY</span><HeroSelect ariaLabel="Sort hero leaderboard" value={leaderMetric} options={[{ value: "rank", label: "Highest player rank" }, { value: "matches", label: "Most matches played" }]} onChange={(value) => setLeaderMetric(value as LeaderSort)} /></label></div>{leaderboardBusy ? <div className="hero-hub-state">Loading player leaderboard…</div> : leaderboardData?.error ? <div className="hero-hub-state">Player leaderboard is temporarily unavailable.</div> : leaderboardData?.rows.length ? <div className="hero-profile-list leaderboard-list">{leaderboardRows.map((row, index) => { const steam = leaderboardData.names.find((entry) => entry.account_id === row.account_id), rank = leaderboardData.ranks.find((entry) => entry.account_id === row.account_id); return <article key={row.account_id}><span className="leaderboard-place">#{index + 1}</span>{steam?.avatar && <img src={steam.avatar} alt="" />}{steam ? <button className="leaderboard-player-link" type="button" onClick={() => onOpenPlayer(row.account_id)}>{steam.personaname} ↗</button> : <strong>Player {row.account_id}</strong>}<span className="leaderboard-rank">{rank?.badge ? formatRank(rank.badge) : "Rank unavailable"}</span><small>{row.matches.toLocaleString()} matches played</small></article>; })}</div> : <div className="hero-hub-state">No players met the minimum match sample for these filters.</div>}<p className="hero-profile-footnote">Rank is the player’s latest reported badge; match count is the number of games on this hero in the selected filters.</p></section>}
      {profileTab === "overview" && <section className="hero-profile-note"><small>PROFILE DATA</small><p>Win rate and match totals reflect the selected mode and time window. Builds, ability orders, and same-lane opponent results use matched historical data.</p></section>}
      </>}
    </> : <>
      <div className="hero-hub-heading"><div><small>COUNTERLOCK / HERO ANALYTICS</small><h1>Hero Hub</h1><p>Find your next main. Compare live win rates and match volume across the current meta.</p></div><span>{heroes.length} HEROES</span></div>
      <div className="hero-hub-controls"><label className="hero-hub-search"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search heroes…" /></label>
        <label><span>PATCH WINDOW</span><HeroSelect ariaLabel="Patch window" value={selectedPatch} options={[{ value: "all", label: "All patches" }, ...patches.map((patch) => ({ value: String(patch.client_version), label: `v${patch.client_version} · ${patch.version_date ?? new Date(`${patch.version_datetime}Z`).toLocaleDateString()}` }))]} onChange={setSelectedPatch} /></label>
        <label><span>MODE</span><HeroSelect ariaLabel="Match mode" value={mode} options={[{ value: "all", label: "All matches" }, { value: "ranked", label: "Ranked" }, { value: "unranked", label: "Unranked" }]} onChange={setMode} /></label>
        <label><span>{selectedPatch === "all" ? "PERIOD" : "PERIOD · PATCH OVERRIDES"}</span><HeroSelect ariaLabel="Time period" value={String(days)} disabled={selectedPatch !== "all"} options={[{ value: "7", label: "7 days" }, { value: "30", label: "30 days" }, { value: "90", label: "90 days" }]} onChange={(value) => setDays(Number(value))} /></label>
        <label><span>RANK</span><HeroSelect ariaLabel="Rank filter" value={rankTier} options={[{ value: "all", label: "All ranks" }, ...Array.from({ length: 11 }, (_, index) => index + 1).map((tier) => ({ value: String(tier), label: formatRank(tier * 10 + 1).replace(/ I$/, "+") }))]} onChange={setRankTier} /></label>
        <label><span>SORT</span><HeroSelect ariaLabel="Sort heroes" value={sort} options={[{ value: "matches", label: "Most played" }, { value: "winrate", label: "Win rate" }, { value: "name", label: "Name" }]} onChange={(value) => setSort(value as typeof sort)} /></label>
      </div>
      {error && <div className="hero-hub-state" role="status">Hero analytics are temporarily unavailable. Try again in a moment.</div>}
      {!error && busy && <div className="hero-hub-state">Loading current hero data…</div>}
      {!busy && !error && <div className="hero-hub-grid">{rows.map(({ hero, stat }, index) => {
        const rate = stat && stat.matches ? 100 * stat.wins / stat.matches : null;
        const selectionMetrics = pickBanResponse?.key === requestKey ? pickBanResponse : null;
        const pickRate = stat?.matches && selectionMetrics?.totalPlayers ? 100 * stat.matches / selectionMetrics.totalPlayers : null;
        const bans = selectionMetrics?.bans.find((row) => row.hero_id === hero.id)?.bans;
        const heroTrend = (trendResponse?.key === requestKey ? trendResponse.stats : []).filter((row) => row.hero_id === hero.id && row.matches > 0).sort((a, b) => a.bucket - b.bucket);
        const trendDelta = heroTrend.length > 1 ? (heroTrend.at(-1)!.wins / heroTrend.at(-1)!.matches - heroTrend.at(-2)!.wins / heroTrend.at(-2)!.matches) * 100 : null;
        return <button type="button" className="hero-hub-card" key={hero.id} onClick={() => { setProfileTab("overview"); setSelected(hero); }}>
          <span className="hero-hub-rank">{String(index + 1).padStart(2, "0")}</span>
          {hero.images?.icon_hero_card_webp ? <img src={hero.images.icon_hero_card_webp} alt="" loading="lazy" /> : <span className="hero-hub-placeholder">{hero.name.slice(0, 1)}</span>}
          <span className="hero-hub-card-copy"><strong>{hero.name}</strong><small>{stat?.matches ? `${stat.matches.toLocaleString()} matches` : "No recent sample"}</small></span>
          <span className={`hero-hub-rate ${rate != null && rate >= 50 ? "positive" : ""}`}>{rate == null ? "—" : `${rate.toFixed(1)}%`}<small>WIN RATE</small></span>
          <span className="hero-hub-selection-rates"><span>{pickRate == null ? "—" : `${pickRate.toFixed(1)}%`}<small>PICK SHARE</small></span><span>{bans == null || !selectionMetrics?.totalMatches ? "—" : `${(100 * bans / selectionMetrics.totalMatches).toFixed(1)}%`}<small>BAN RATE · {bans?.toLocaleString() ?? "—"} BANS</small></span><span className={trendDelta == null ? "" : trendDelta >= 0 ? "trend-up" : "trend-down"}>{trendDelta == null ? "—" : `${trendDelta > 0 ? "+" : ""}${trendDelta.toFixed(1)} pp`}<small>WEEKLY TREND</small></span></span>
          <span className="hero-hub-arrow">↗</span>
        </button>;
      })}</div>}{!busy && !error && <p className="hero-profile-footnote">Pick share is hero selections divided by all reported player appearances. Ban rate is the share of filtered matches in which the hero was banned; the count is shown alongside it. Patch windows use client-build timestamps because analytics do not expose a direct match-build filter, so boundaries are approximate; selecting a patch overrides the period filter.</p>}
    </>}
  </main>;
}
