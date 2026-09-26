import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export type DesktopPlayer = {
  account_id: number | null;
  hero_id: number | null;
  team: number | null;
  kills: number | null;
  deaths: number | null;
  assists: number | null;
  net_worth: number | null;
  unspent_souls: number | null;
  owned_item_class_tokens: number[] | null;
  items: number[] | null;
};

export type DesktopMatch = {
  match_id: number | null;
  account_id: number | null;
  duration_s: number | null;
  game_time_s: number | null;
  match_mode_parsed: string | null;
  players: DesktopPlayer[];
  source: string;
};

export type DesktopStatus = {
  in_game: boolean;
  game_running: boolean;
  steam_running: boolean;
  pid: number | null;
  installation_path: string | null;
  build_id: string | null;
  console_phase: string | null;
  lobby_id: number | null;
  match_id: number | null;
  account_id: number | null;
  provider: string;
  capabilities: { roster: boolean; net_worth: boolean; unspent_souls: boolean; items: boolean };
  last_error: string | null;
};

export type DesktopPreferences = { close_to_tray: boolean; compact_always_on_top: boolean };
export type DesktopMonitor = { index: number; name: string; x: number; y: number; width: number; height: number };

export type DesktopAdviceItem = { item_id: number; name: string; cost: number; score: number; reason: string; affordable: boolean | null; priority: number };
export type DesktopAdvice = { match_id: number | null; inventory_known: boolean; owned_item_ids: number[]; recommended: DesktopAdviceItem | null; alternatives: DesktopAdviceItem[] };
export type AdvisorEvidence = {
  hero_id: number;
  enemy_ids: number[];
  item_catalog: Array<{ item_id: number; class_name: string }>;
  items: Array<{ item_id: number; name: string; cost: number; score: number; reason: string }>;
};

export const desktopAvailable = () => typeof window !== "undefined" && isTauri();
export const getDesktopStatus = () => invoke<DesktopStatus>("desktop_status");
export const getDesktopMatch = () => invoke<DesktopMatch | null>("match_snapshot");
export const getLastMatch = () => invoke<DesktopMatch | null>("last_match");
export const getRecommendations = () => invoke<DesktopAdvice | null>("recommendations");
export const setAdvisorEvidence = (evidence: AdvisorEvidence) => invoke<void>("set_advisor_evidence", { evidence });
export const submitLocalRoster = (roster: { own_hero_id: number; ally_hero_ids: number[]; enemy_hero_ids: number[] }) => invoke<void>("submit_local_roster", { roster });
export const toggleCompact = () => invoke<void>("toggle_compact");
export const getDesktopMonitors = () => invoke<DesktopMonitor[]>("desktop_monitors");
export const captureHud = (monitorIndex?: number) => invoke<number[]>("hud_capture", { monitorIndex });
export const getDesktopPreferences = () => invoke<DesktopPreferences>("desktop_preferences");
export const saveDesktopPreferences = (preferences: DesktopPreferences) => invoke<void>("save_desktop_preferences", { preferences });
export const checkForDesktopUpdate = () => check();
export const installDesktopUpdate = async (update: NonNullable<Awaited<ReturnType<typeof check>>>) => {
  await update.downloadAndInstall();
  await relaunch();
};
export const onOpenSettings = (callback: () => void): Promise<UnlistenFn> =>
  listen("open-settings", callback);
export const onDesktopStatus = (callback: (status: DesktopStatus) => void): Promise<UnlistenFn> =>
  listen<DesktopStatus>("desktop-status", (event) => callback(event.payload));
export const onDesktopMatch = (callback: (match: DesktopMatch | null) => void): Promise<UnlistenFn> =>
  listen<DesktopMatch | null>("match-state", (event) => callback(event.payload));
export const onRecommendations = (callback: (advice: DesktopAdvice | null) => void): Promise<UnlistenFn> =>
  listen<DesktopAdvice | null>("recommendations", (event) => callback(event.payload));
