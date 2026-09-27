"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";
import { captureHud, checkForDesktopUpdate, desktopAvailable, getDesktopMatch, getDesktopStatus, getDesktopMonitors, getDesktopPreferences, getLastMatch, getRecommendations, installDesktopUpdate, onDesktopMatch, onDesktopStatus, onOpenSettings, onRecommendations, saveDesktopPreferences, setAdvisorEvidence, submitLocalRoster, type DesktopAdvice, type DesktopMatch, type DesktopStatus, type DesktopPreferences, type DesktopMonitor } from "./desktop";
import { DesktopLivePanel } from "./DesktopLivePanel";
import { DesktopBuildLab } from "./DesktopBuildLab";
import { cachedJson } from "./lib/data/cache";
import { rankItems } from "./lib/build-engine/scoring";
import { itemFlowStats, itemStatsUrl } from "./lib/data/deadlock-api";
import { bestFlowPath, flowCoreFit, itemFlowPhase } from "./lib/build-engine/build-flow";
import { counterCapability, hasCounterRoleOverlap, tagsForItem, tagMatchesManualThreat } from "./lib/build-engine/counter-tags";
import { mergedHeroThreats, type HeroAbilityEvidence } from "./lib/build-engine/hero-threats";
import { scoreThreats } from "./lib/build-engine/threat-score";
import { buildUpgradeGraph } from "./lib/build-engine/upgrade-graph";
import { optimizeSlots } from "./lib/build-engine/slot-optimizer";
import { findSellDecisions, planPurchasePath, rankNextBuys, type PlanCandidate } from "./lib/build-engine/planner";
import { buildDeviation, shouldPreservePowerSpike } from "./lib/match-intelligence/deviation";
import { counterCoverage } from "./lib/match-intelligence/counter-coverage";
import { fetchStatlockerProfiles, syncPersonalHeroProfile, type StatlockerProfile, type StatlockerStatus } from "./lib/data/statlocker";
import { personalSignals, personalSequencePrior, rankCohort, rankDataHasCoverage, type PersonalHeroProfile } from "./lib/build-engine/personal-profile";
import { completeRecommendationOutcome, recommendationOutcomeCache, recordRecommendationSnapshot } from "./lib/data/recommendation-outcomes";
import { MatchHistory } from "./MatchHistory";
import { laneBuyScore, laneState } from "./lib/match-intelligence/lane";

const API = "https://api.deadlock-api.com/v1";

type Lang = "en" | "de";
type Category = "all" | "weapon" | "vitality" | "spirit";
type SortMode = "buytime" | "recommended" | "winrate" | "sample" | "cost";
type Phase = "early" | "mid" | "late";
type QueueMode = "all" | "ranked" | "unranked";
type BuyTarget = "carry" | "team";
type BuildStyle = "balanced" | "safe" | "greedy";
type Lane = "all" | "blue" | "green" | "yellow" | "purple";
type ImportTarget = "auto" | "enemy" | "ally";

type Hero = { id: number; name: string; images?: { icon_image_small_webp?: string; icon_hero_card_webp?: string } };
type Item = {
  id: number;
  name: string;
  cost: number | null;
  item_tier: number | null;
  item_slot_type: Exclude<Category, "all"> | null;
  shopable: boolean;
  shop_image_webp?: string;
  class_name?: string;
  component_items?: string[];
};
type ItemStat = { item_id: number; wins: number; losses: number; matches: number; players: number; avg_buy_time_s: number };
type EnemyBuildSignal = { heroId: number; stats: ItemStat[] };
type CounterStat = { hero_id: number; enemy_hero_id: number; wins: number; matches_played: number };
type EnemyItemRate = { heroId: number; rate: number; matches: number; lift: number };
type Recommendation = { item: Item; carryScore: number; teamScore: number; laneFit?: number; coveredEnemyIds?: number[]; teamRate: number; baselineRate: number; carryRate: number; carryMatches: number; teamMatches: number; exactMatches: number; carryBuyTime: number; teamBuyTime: number; enemyRates: EnemyItemRate[]; advisorReason?: string; coreFit?: number; counterFit?: number; counterUrgency?: number; mechanicFit?: number; exactFit?: number; personalFit?: number; threatTargets?: number[] };
type Detection = { id: number; confidence: number; x?: number; y?: number; side?: "ally" | "enemy"; lane?: Exclude<Lane, "all">; isOwn?: boolean; playerName?: string };
type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } };
type ScoreboardSheet = { canvas: HTMLCanvasElement; rowHeight: number };
type CounterPick = { hero: Hero; score: number; carryRate: number; matches: number; coverage: number };
type SteamProfile = { account_id: number; personaname: string; profileurl: string; avatar: string };
type ActiveMatchPlayer = { account_id: number | null; hero_id: number | null; team: number | null };
type ActiveMatch = { match_id: number | null; start_time: number | null; duration_s: number | null; match_mode_parsed: string | null; players: ActiveMatchPlayer[] };
type PatchNote = { title: string; pub_date: string; link: string };
type CompanionStatus = { in_game: boolean; account_id: number | null; match_id: number | null; joined_at: number | null; hud_capture_available?: boolean; roster_available?: boolean };
type CompanionRoster = { match_id: number | null; account_id: number | null; duration_s: number | null; match_mode_parsed: string | null; players: ActiveMatchPlayer[] };

const copy = {
  en: {
    home: "Counterlock home", heroKicker: "DEADLOCK MATCHUP INTELLIGENCE", lightMode: "LIGHT", darkMode: "DARK", latestPatch: "LATEST PATCH", loadingPatch: "CHECKING PATCH…", patchUnavailable: "Patch notes are temporarily unavailable.", openPatch: "OPEN FULL PATCH NOTES", companionConnected: "LOCAL COMPANION CONNECTED", companionSearching: "WAITING FOR LOCAL MATCH", companionUnavailable: "LOCAL COMPANION OFFLINE",
    nextBuy: "NEXT BUY", nextBuyText: "Best fit for your current match state", matchState: "MATCH STATE", ahead: "AHEAD", even: "EVEN", behind: "BEHIND", buildPath: "BUILD PATH", balanced: "BALANCED", safe: "SAFE", greedy: "GREEDY", threats: "ENEMY THREATS", healing: "HEALING", weaponDamage: "WEAPON", spiritDamage: "SPIRIT", crowdControl: "CROWD CONTROL", counterAlerts: "COUNTER ALERTS", enemyBuildSignals: "COMMON ENEMY ITEMS · HISTORICAL", lifestealDetected: "Common enemy item tendencies suggest sustain; anti-heal is weighted when relevant.", alertHealing: "Enemy healing marked — prioritize anti-heal items.", alertWeapon: "Weapon damage marked — favor bullet defense next.", alertSpirit: "Spirit damage marked — favor spirit defense next.", alertCrowdControl: "Crowd control marked — consider debuff resistance.", patchFreshness: "PATCH DATA", patchFresh: "Latest patch data is being used; new-patch samples may still be stabilizing.", souls: "SOULS AVAILABLE", needSouls: "MORE SOULS NEEDED", affordable: "AFFORDABLE NOW", totalBuildCost: "FULL BUILD COST", remainingCost: "REMAINING", planChecks: "BUILD CHECK", planReady: "16 unique items · no conflicts found", overlay: "MATCH OVERLAY", closeOverlay: "Close match overlay", savePreset: "SAVE SETUP", loadPreset: "LOAD SETUP", presetSaved: "SETUP SAVED", presetMissing: "NO SAVED SETUP", situationalSlots: "SITUATIONAL", enemyDetails: "ENEMY BUILD DETAIL", closeDetails: "Close enemy build detail", commonBuild: "COMMON ITEMS", recommendationReason: "WHY", currentItem: "CURRENT ITEM", markOwned: "MARK OWNED", removeOwned: "REMOVE", duplicatePlan: "Already owned — skipped from next buy", patchCompare: "PATCH STATUS", patchCompareText: "Recommendations use current patch data; early samples can shift as more matches arrive.",
    heroTitleA: "Build for the fight", heroTitleB: "happening right now.",
    heroText: "Choose your hero, mark the enemy carry, and get item recommendations ranked with real matchup data.",
    yourHero: "YOUR HERO", youPlay: "YOU PLAY", chooseHero: "Choose your hero", changeHero: "CHANGE HERO", searchHero: "Search heroes…", heroRoster: "HERO ROSTER", heroesAvailable: "heroes available", selectedHero: "SELECTED", enemyPick: "ENEMY PICK", closeHeroPicker: "Close hero picker",
    enemyTeam: "ENEMY TEAM", chooseEnemy: "Choose an enemy", addEnemy: "+ Add enemy", remove: "Remove", importScreen: "IMPORT SCREENSHOT",
    buildEnemyTeam: "BUILD ENEMY TEAM", enemyRoster: "ENEMY ROSTER", enemySearch: "Search enemy heroes…", teamSelected: "TEAM SELECTED", applyTeam: "APPLY TEAM", cancel: "CANCEL", carryHint: "Click a hero card to mark the enemy carry.", openEnemyPicker: "Open enemy team picker", closeEnemyPicker: "Close enemy team picker", teamSlots: "TEAM SLOTS", ownPick: "YOUR PICK",
    yourTeam: "YOUR TEAM", buildOwnTeam: "BUILD YOUR TEAM", allyRoster: "ALLY ROSTER", allySearch: "Search allied heroes…", alliesSelected: "ALLIES SELECTED", applyAllies: "APPLY ALLIES", openAllyPicker: "Open allied team picker", closeAllyPicker: "Close allied team picker", importAllies: "IMPORT ALLIES", allyPick: "ALLY PICK",
    focusTarget: "FOCUS TARGET", enemyCarry: "ENEMY CARRY", matchupWr: "YOUR MATCHUP WR",
    analyze: "ANALYZE MATCHUP →", analyzing: "ANALYZING …",
    liveRec: "LIVE RECOMMENDATION", bestBuys: "Your best buys", against: "against", enemyLineup: "the full enemy team", vsCarryMode: "VS CARRY", vsTeamMode: "VS TEAM", buyTarget: "RECOMMENDATION TARGET", vsTeam: "percentage points vs. hero baseline across the team",
    autoLive: "LIVE · AUTO-UPDATES", autoUpdating: "UPDATING MATCHUP …", autoHint: "Changes refresh instantly",
    currentMinute: "CURRENT MINUTE", filters: "SMART FILTERS", category: "CATEGORY", all: "All",
    weapon: "Weapon", vitality: "Vitality", spirit: "Spirit", minSample: "MIN. SAMPLE", sort: "SORT BY",
    recommended: "Recommended", buytimeSort: "Buy time", winrate: "Win rate", sample: "Sample size", cost: "Cost",
    laneSetup: "LANE SETUP", lane: "YOUR LANE", laneOpponent: "LANE OPPONENT", anyLane: "Any lane", blue: "Blue", green: "Green", yellow: "Yellow", purple: "Purple",
    laneBoard: "LANE ASSIGNMENTS", laneBoardText: "Drag hero cards between lanes. Your hero's lane controls same-lane matchup statistics.", autoPositions: "AUTO BY POSITION", alliesLabel: "YOUR SIDE", enemiesLabel: "ENEMY SIDE", yourLane: "YOUR LANE", markLaneOpponent: "MARK LANE OPPONENT", dragHero: "Drag to another lane. Use Left or Right Arrow with the card focused.", dropHere: "DROP HERO HERE",
    laneWinRate: "EST. LANE WIN RATE", laneWinHint: "Average of same-lane hero matchups",
    matchup: "MATCHUP", games: "GAMES", focus: "FOCUS", items: "ITEMS FOUND",
    winrateLabel: "WIN RATE", buyTime: "BUY TIME", vsCarry: "percentage points vs. hero baseline",
    copyBuild: "COPY TOP BUILD", copied: "BUILD COPIED ✓", share: "SHARE MATCHUP", linkCopied: "LINK COPIED ✓", empty: "No items match these filters. Try a lower sample size.",
    showFullBuild: "SHOW FULL BUILD", hideFullBuild: "HIDE FULL BUILD", fullBuild: "FULL MATCH BUILD", fullBuildText: "A complete 16-slot final inventory plus the purchase path to reach it.", finalInventory: "FINAL 16-SLOT INVENTORY", flexSlots: "FLEX", buyOrder: "BUY ORDER", earlyBuys: "EARLY FOUNDATION", midUpgrades: "MID-GAME UPGRADES", lateCore: "LATE-GAME CORE", bestAgainst: "BEST AGAINST", sellPlan: "SELL & REPLACE", sellAt: "SELL AFTER 20 MIN", replaceWith: "REPLACE WITH", noSell: "No early sell is needed for this build yet.",
    methodTitle: "How ranking works:", method: "Carry matchup, the full enemy team, your hero baseline and sample confidence are weighted together. Correlation is not a guarantee—adapt to the actual game state.",
    updated: "UPDATED", assetError: "Hero data is temporarily unavailable.", statsError: "Live statistics are temporarily unavailable. Please try again.",
    footer: "Community project · Data by", disclaimer: "· Not affiliated with Valve.", early: "EARLY", mid: "MID GAME", late: "LATE",
    importerTitle: "Import enemy team", importerText: "Upload a match screenshot where the enemy hero names are visible. Recognition runs locally on your device.",
    allyImporterText: "Upload a scoreboard screenshot and select the heroes on your side. Recognition runs locally on your device.",
    autoImporterTitle: "Paste full scoreboard", autoImporterText: "Press Ctrl+V with a scoreboard screenshot. Both teams and Yellow, Blue, and Green lanes are assigned automatically.", pasteHint: "PRESS CTRL+V TO PASTE A SCREENSHOT", autoImport: "IMPORT BOTH TEAMS + LANES", identifyYourHero: "WHICH HERO ARE YOU?", identifyHint: "Choose once—your player name is remembered on this device.", chooseYourHero: "Choose your hero in this match…",
    matchImport: "IMPORT CURRENT MATCH", matchImportText: "Paste a scoreboard for the most reliable import, or find a public Watch-tab match with Steam.",
    rosterCaptured: "Roster captured by the local companion. Lane positions are estimated—paste a scoreboard screenshot to correct them.", liveImport: "FIND LIVE MATCH", screenshotImport: "PASTE SCOREBOARD", liveImportTitle: "IMPORT YOUR LIVE MATCH", liveImportText: "Use a SteamID64, numeric profile URL, account ID, or a Deadlock player name. Only public Watch-tab matches can be found.", steamPlaceholder: "SteamID64, numeric profile URL, or name…", findPlayer: "FIND MATCH", searchingPlayer: "SEARCHING…", chooseSteamProfile: "CHOOSE YOUR STEAM PROFILE", useProfile: "USE & FIND MATCH", liveMatchFound: "LIVE MATCH IMPORTED", liveMatchId: "MATCH", liveMatchMissing: "No public live match was found for this player. Only matches visible in Deadlock's Watch tab can be detected.", steamProfileMissing: "No matching Steam profile was found.", liveImportError: "The live-match service could not be reached. Try the screenshot import instead.", steamProfileLinkUnsupported: "Custom Steam profile links are unavailable on this static site. Paste your SteamID64 or numeric profile URL instead.", savedProfile: "SAVED PROFILE", forgetProfile: "FORGET", lanesEstimated: "Teams were imported automatically. Lane positions are estimated—paste a scoreboard screenshot to correct them.", closeLiveImport: "Close live match import",
    sampleConfidence: "CONFIDENCE", highConfidence: "HIGH", mediumConfidence: "MEDIUM", lowConfidence: "LIMITED", whyItem: "WHY THIS ITEM?", whyItemText: "This rank combines matchup lift, sample confidence, buy-time fit, and the selected target.",
    dropTitle: "Drop match screenshot here", dropText: "or click to choose a PNG, JPG, or WebP", scanning: "READING HERO NAMES", detected: "DETECTED HEROES", confidence: "match",
    importHeroes: "IMPORT SELECTED HEROES", scanAgain: "CHOOSE ANOTHER SCREENSHOT", noHeroes: "No hero names were detected. Try a sharper screenshot with the scoreboard fully visible.", close: "Close screenshot importer", localOnly: "PRIVATE · IMAGE NEVER LEAVES YOUR DEVICE",
    moreOptions: "MORE OPTIONS", apiFilters: "MATCH DATA", queue: "QUEUE", both: "Ranked + Unranked", ranked: "Ranked only", unranked: "Unranked only", dataWindow: "DATA WINDOW", days: "days", laneOnly: "SAME LANE ONLY",
    itemRules: "ITEM RULES", maxBudget: "MAX. BUDGET", noLimit: "No limit", itemTier: "ITEM TIER", anyTier: "Any tier", resultCount: "RESULT COUNT", positiveLift: "POSITIVE LIFT ONLY", reanalyzeHint: "Queue, time window, and lane filters apply after Analyze Matchup.",
    counterpickKicker: "DRAFT ASSISTANT", counterpickTitle: "Heroes that counter", counterpickText: "Lineup score is normalized against each hero's overall baseline, revealing matchup-specific counters instead of generally strong heroes.", bestPick: "BEST PICK", teamWr: "LINEUP EDGE", carryWr: "VS. CARRY", useHero: "PLAY THIS HERO", coverage: "matchups covered", currentPick: "CURRENT PICK", showAllHeroes: "SHOW ALL HEROES", hideAllHeroes: "HIDE FULL TABLE", heroColumn: "HERO", gamesColumn: "MATCHES",
  },
  de: {
    home: "Counterlock Startseite", heroKicker: "DEADLOCK MATCHUP-ANALYSE", lightMode: "HELL", darkMode: "DUNKEL", latestPatch: "LETZTER PATCH", loadingPatch: "PATCH WIRD GEPRÜFT…", patchUnavailable: "Patch-Notizen sind momentan nicht verfügbar.", openPatch: "VOLLE PATCH-NOTIZEN ÖFFNEN", companionConnected: "LOKALER COMPANION VERBUNDEN", companionSearching: "WARTE AUF LOKALES MATCH", companionUnavailable: "LOKALER COMPANION OFFLINE",
    nextBuy: "NÄCHSTER KAUF", nextBuyText: "Beste Wahl für den aktuellen Match-Zustand", matchState: "MATCH-STATUS", ahead: "VORAUS", even: "GLEICH", behind: "HINTEN", buildPath: "BUILD-PFAD", balanced: "AUSGEWOGEN", safe: "SICHER", greedy: "GIERIG", threats: "GEGNERISCHE GEFAHREN", healing: "HEILUNG", weaponDamage: "WAFFE", spiritDamage: "SPIRIT", crowdControl: "CROWD CONTROL", counterAlerts: "COUNTER-ALARME", enemyBuildSignals: "HÄUFIGE GEGNER-ITEMS · HISTORISCH", lifestealDetected: "Häufige gegnerische Item-Tendenzen deuten auf Sustain; Anti-Heal wird passend gewichtet.", alertHealing: "Gegnerische Heilung markiert — Anti-Heal-Items priorisieren.", alertWeapon: "Waffenschaden markiert — als Nächstes Bullet-Defense bevorzugen.", alertSpirit: "Spirit-Schaden markiert — als Nächstes Spirit-Defense bevorzugen.", alertCrowdControl: "Crowd Control markiert — Debuff-Resistenz erwägen.", patchFreshness: "PATCH-DATEN", patchFresh: "Daten des neuesten Patches werden genutzt; new-patch samples may still be stabilizing.", souls: "VERFÜGBARE SEELEN", needSouls: "MEHR SEELEN NÖTIG", affordable: "JETZT KAUFBAR", totalBuildCost: "BUILD-GESAMTKOSTEN", remainingCost: "VERBLEIBEND", planChecks: "BUILD-CHECK", planReady: "16 einzigartige Items · keine Konflikte", overlay: "MATCH-OVERLAY", closeOverlay: "Match-Overlay schließen", savePreset: "SETUP SPEICHERN", loadPreset: "SETUP LADEN", presetSaved: "SETUP GESPEICHERT", presetMissing: "KEIN GESPEICHERTES SETUP", situationalSlots: "SITUATIV", enemyDetails: "GEGNER-BUILD-DETAIL", closeDetails: "Gegner-Build-Detail schließen", commonBuild: "HÄUFIGE ITEMS", recommendationReason: "WARUM", currentItem: "AKTUELLES ITEM", markOwned: "ALS BESITZT MARKIEREN", removeOwned: "ENTFERNEN", duplicatePlan: "Bereits vorhanden — beim nächsten Kauf übersprungen", patchCompare: "PATCH-STATUS", patchCompareText: "Empfehlungen nutzen Daten des aktuellen Patches; frühe Stichproben können sich noch verändern.",
    heroTitleA: "Baue für den Kampf,", heroTitleB: "der gerade passiert.",
    heroText: "Wähle deinen Helden, markiere den gegnerischen Carry und erhalte Item-Empfehlungen aus echten Matchup-Daten.",
    yourHero: "DEIN HELD", youPlay: "DU SPIELST", chooseHero: "Helden auswählen", changeHero: "HELD WECHSELN", searchHero: "Helden suchen…", heroRoster: "HELDEN-ROSTER", heroesAvailable: "Helden verfügbar", selectedHero: "AUSGEWÄHLT", enemyPick: "GEGNER-PICK", closeHeroPicker: "Heldenauswahl schließen",
    enemyTeam: "GEGNERISCHES TEAM", chooseEnemy: "Gegner auswählen", addEnemy: "+ Gegner", remove: "Entfernen", importScreen: "SCREENSHOT IMPORTIEREN",
    buildEnemyTeam: "GEGNERTEAM BAUEN", enemyRoster: "GEGNER-ROSTER", enemySearch: "Gegnerische Helden suchen…", teamSelected: "TEAM AUSGEWÄHLT", applyTeam: "TEAM ÜBERNEHMEN", cancel: "ABBRECHEN", carryHint: "Klicke auf eine Heldenkarte, um den gegnerischen Carry zu markieren.", openEnemyPicker: "Gegnerteam-Auswahl öffnen", closeEnemyPicker: "Gegnerteam-Auswahl schließen", teamSlots: "TEAM-PLÄTZE", ownPick: "DEIN PICK",
    yourTeam: "DEIN TEAM", buildOwnTeam: "EIGENES TEAM BAUEN", allyRoster: "VERBÜNDETEN-ROSTER", allySearch: "Verbündete Helden suchen…", alliesSelected: "VERBÜNDETE AUSGEWÄHLT", applyAllies: "VERBÜNDETE ÜBERNEHMEN", openAllyPicker: "Verbündetenauswahl öffnen", closeAllyPicker: "Verbündetenauswahl schließen", importAllies: "VERBÜNDETE IMPORTIEREN", allyPick: "VERBÜNDETER",
    focusTarget: "FOKUS-ZIEL", enemyCarry: "GEGNERISCHER CARRY", matchupWr: "DEINE MATCHUP-WR",
    analyze: "MATCHUP ANALYSIEREN →", analyzing: "ANALYSE LÄUFT …",
    liveRec: "LIVE-EMPFEHLUNG", bestBuys: "Deine besten Käufe", against: "gegen", enemyLineup: "das gesamte Gegnerteam", vsCarryMode: "GEGEN CARRY", vsTeamMode: "GEGEN TEAM", buyTarget: "EMPFEHLUNGSZIEL", vsTeam: "Prozentpunkte gegen die Helden-Basis im gesamten Team",
    autoLive: "LIVE · AUTO-UPDATE", autoUpdating: "MATCHUP WIRD AKTUALISIERT …", autoHint: "Änderungen werden sofort übernommen",
    currentMinute: "AKTUELLE MINUTE", filters: "INTELLIGENTE FILTER", category: "KATEGORIE", all: "Alle",
    weapon: "Waffe", vitality: "Vitalität", spirit: "Spirit", minSample: "MIN. STICHPROBE", sort: "SORTIERUNG",
    recommended: "Empfehlung", buytimeSort: "Kaufzeit", winrate: "Winrate", sample: "Stichprobe", cost: "Kosten",
    laneSetup: "LANE-SETUP", lane: "DEINE LANE", laneOpponent: "LANE-GEGNER", anyLane: "Beliebige Lane", blue: "Blau", green: "Grün", yellow: "Gelb", purple: "Lila",
    laneBoard: "LANE-ZUORDNUNG", laneBoardText: "Ziehe Heldenkarten zwischen den Lanes. Die Lane deines Helden steuert die Same-Lane-Statistiken.", autoPositions: "AUTO NACH POSITION", alliesLabel: "DEINE SEITE", enemiesLabel: "GEGNERSEITE", yourLane: "DEINE LANE", markLaneOpponent: "ALS LANE-GEGNER MARKIEREN", dragHero: "In eine andere Lane ziehen. Mit Fokus funktionieren auch die Pfeiltasten Links und Rechts.", dropHere: "HELD HIER ABLEGEN",
    laneWinRate: "GESCHÄTZTE LANE-WINRATE", laneWinHint: "Durchschnitt der Same-Lane-Heldenduelle",
    matchup: "MATCHUP", games: "SPIELE", focus: "FOKUS", items: "ITEMS GEFUNDEN",
    winrateLabel: "WINRATE", buyTime: "KAUFZEIT", vsCarry: "Prozentpunkte gegen die Helden-Basis",
    copyBuild: "TOP-BUILD KOPIEREN", copied: "BUILD KOPIERT ✓", share: "MATCHUP TEILEN", linkCopied: "LINK KOPIERT ✓", empty: "Keine Items passen zu diesen Filtern. Versuche eine kleinere Stichprobe.",
    showFullBuild: "VOLLSTÄNDIGEN BUILD ZEIGEN", hideFullBuild: "BUILD AUSBLENDEN", fullBuild: "BUILD FÜR DAS GESAMTE MATCH", fullBuildText: "Ein vollständiges finales 16-Slot-Inventar mit Kaufweg.", finalInventory: "FINALES 16-SLOT-INVENTAR", flexSlots: "FLEX", buyOrder: "KAUFREIHENFOLGE", earlyBuys: "EARLY-GRUNDLAGE", midUpgrades: "MID-GAME-UPGRADES", lateCore: "LATE-GAME-KERN", bestAgainst: "AM BESTEN GEGEN", sellPlan: "VERKAUFEN & ERSETZEN", sellAt: "NACH 20 MIN VERKAUFEN", replaceWith: "ERSETZEN DURCH", noSell: "Für diesen Build muss aktuell kein Early-Item verkauft werden.",
    methodTitle: "So wird gerankt:", method: "Carry-Matchup, gesamtes Gegnerteam, Basis-Winrate deines Helden und Stichprobenqualität werden gewichtet. Korrelation ist keine Garantie—passe den Kauf an den Spielstand an.",
    updated: "AKTUALISIERT", assetError: "Heldendaten sind momentan nicht erreichbar.", statsError: "Die Live-Statistiken sind gerade nicht erreichbar. Bitte versuche es erneut.",
    footer: "Community-Projekt · Daten von", disclaimer: "· Nicht mit Valve verbunden.", early: "EARLY", mid: "MID GAME", late: "LATE",
    importerTitle: "Gegnerteam importieren", importerText: "Lade einen Match-Screenshot hoch, auf dem die gegnerischen Heldennamen sichtbar sind. Die Erkennung läuft lokal auf deinem Gerät.",
    allyImporterText: "Lade einen Scoreboard-Screenshot hoch und wähle die Helden auf deiner Seite. Die Erkennung läuft lokal auf deinem Gerät.",
    autoImporterTitle: "Gesamtes Scoreboard einfügen", autoImporterText: "Drücke Strg+V mit einem Scoreboard-Screenshot. Beide Teams sowie gelbe, blaue und grüne Lane werden automatisch zugeordnet.", pasteHint: "STRG+V DRÜCKEN, UM EINEN SCREENSHOT EINFÜGEN", autoImport: "BEIDE TEAMS + LANES IMPORTIEREN", identifyYourHero: "WELCHER HELD BIST DU?", identifyHint: "Einmal auswählen—dein Spielername wird auf diesem Gerät gespeichert.", chooseYourHero: "Deinen Helden in diesem Match wählen…",
    matchImport: "AKTUELLES MATCH IMPORTIEREN", matchImportText: "Füge für den zuverlässigsten Import ein Scoreboard ein oder finde ein öffentliches Watch-Tab-Match über Steam.",
    rosterCaptured: "Aufstellung vom lokalen Companion erfasst. Die Lanes sind geschätzt—füge einen Scoreboard-Screenshot ein, um sie zu korrigieren.", liveImport: "LIVE-MATCH FINDEN", screenshotImport: "SCOREBOARD EINFÜGEN", liveImportTitle: "DEIN LIVE-MATCH IMPORTIEREN", liveImportText: "Nutze SteamID64, numerische Profil-URL, Account-ID oder einen Deadlock-Spielernamen. Nur öffentliche Watch-Tab-Matches sind auffindbar.", steamPlaceholder: "SteamID64, numerische Profil-URL oder Name…", findPlayer: "MATCH FINDEN", searchingPlayer: "SUCHE…", chooseSteamProfile: "WÄHLE DEIN STEAM-PROFIL", useProfile: "NUTZEN & MATCH FINDEN", liveMatchFound: "LIVE-MATCH IMPORTIERT", liveMatchId: "MATCH", liveMatchMissing: "Für diesen Spieler wurde kein öffentliches Live-Match gefunden. Erkannt werden nur Matches, die in Deadlocks Watch-Tab sichtbar sind.", steamProfileMissing: "Kein passendes Steam-Profil gefunden.", liveImportError: "Der Live-Match-Dienst ist gerade nicht erreichbar. Nutze stattdessen den Screenshot-Import.", steamProfileLinkUnsupported: "Benutzerdefinierte Steam-Profil-Links sind auf dieser statischen Website nicht verfügbar. Füge stattdessen SteamID64 oder eine numerische Profil-URL ein.", savedProfile: "GESPEICHERTES PROFIL", forgetProfile: "ENTFERNEN", lanesEstimated: "Beide Teams wurden automatisch importiert. Die Lanes sind geschätzt—füge einen Scoreboard-Screenshot ein, um sie zu korrigieren.", closeLiveImport: "Live-Match-Import schließen",
    sampleConfidence: "SICHERHEIT", highConfidence: "HOCH", mediumConfidence: "MITTEL", lowConfidence: "BEGRENZT", whyItem: "WARUM DIESES ITEM?", whyItemText: "Das Ranking kombiniert Matchup-Lift, Stichprobenqualität, Kaufzeit und das gewählte Ziel.",
    dropTitle: "Match-Screenshot hier ablegen", dropText: "oder klicken, um PNG, JPG oder WebP auszuwählen", scanning: "HELDENNAMEN WERDEN GELESEN", detected: "ERKANNTE HELDEN", confidence: "Treffer",
    importHeroes: "AUSGEWÄHLTE HELDEN IMPORTIEREN", scanAgain: "ANDEREN SCREENSHOT WÄHLEN", noHeroes: "Keine Heldennamen erkannt. Versuche einen schärferen Screenshot mit vollständig sichtbarem Scoreboard.", close: "Screenshot-Import schließen", localOnly: "PRIVAT · DAS BILD BLEIBT AUF DEINEM GERÄT",
    moreOptions: "MEHR OPTIONEN", apiFilters: "MATCH-DATEN", queue: "WARTESCHLANGE", both: "Ranked + Unranked", ranked: "Nur Ranked", unranked: "Nur Unranked", dataWindow: "ZEITRAUM", days: "Tage", laneOnly: "NUR GLEICHE LANE",
    itemRules: "ITEM-REGELN", maxBudget: "MAX. BUDGET", noLimit: "Kein Limit", itemTier: "ITEM-TIER", anyTier: "Alle Tiers", resultCount: "ANZAHL ERGEBNISSE", positiveLift: "NUR POSITIVER LIFT", reanalyzeHint: "Warteschlange, Zeitraum und Lane-Filter gelten nach der nächsten Matchup-Analyse.",
    counterpickKicker: "DRAFT-ASSISTENT", counterpickTitle: "Helden als Counter", counterpickText: "Der Lineup-Wert wird gegen die normale Basis jedes Helden gerechnet und zeigt dadurch matchup-spezifische Counter.", bestPick: "BESTER PICK", teamWr: "LINEUP-VORTEIL", carryWr: "GEGEN CARRY", useHero: "DIESEN HELDEN SPIELEN", coverage: "Matchups abgedeckt", currentPick: "AKTUELLER PICK", showAllHeroes: "ALLE HELDEN ZEIGEN", hideAllHeroes: "TABELLE AUSBLENDEN", heroColumn: "HELD", gamesColumn: "MATCHES",
  },
} as const;

const phaseRanges: Record<Phase, [number, number]> = { early: [0, 660], mid: [540, 1260], late: [1080, Infinity] };

function adjustedRate(stat?: ItemStat) { return stat ? (stat.wins + 60) / (stat.matches + 120) : 0.5; }
function pct(value: number) { return `${(value * 100).toFixed(1)}%`; }
function formatMatches(value: number, lang: Lang) { return new Intl.NumberFormat(lang === "de" ? "de-DE" : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatTime(seconds: number, lang: Lang) { return `~${Math.max(0, Math.round(seconds / 60))} ${lang === "de" ? "Min." : "min"}`; }
function confidenceTier(matches: number) { return matches >= 50_000 ? "high" : matches >= 5_000 ? "medium" : "low"; }

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
function detectHeroNames(text: string, heroes: Hero[], excludedHeroIds: number[]): Detection[] {
  const compactText = normalizeText(text);
  const words = text.split(/\s+/).map(normalizeText).filter(Boolean);
  return heroes.filter((hero) => !excludedHeroIds.includes(hero.id)).map((hero) => {
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

function detectPositionedHeroes(lines: OcrWord[][], heroes: Hero[]): Detection[] {
  return heroes.map((hero) => {
    const target = normalizeText(hero.name); let best: Detection | null = null;
    lines.forEach((words) => { for (let size = 1; size <= 3; size += 1) for (let index = 0; index <= words.length - size; index += 1) {
      const group = words.slice(index, index + size); const candidate = normalizeText(group.map((word) => word.text).join(""));
      const similarity = candidate === target ? 1 : 1 - editDistance(target, candidate) / Math.max(target.length, candidate.length, 1);
      if (similarity >= (target.length <= 4 ? .78 : .66) && (!best || similarity > best.confidence)) best = { id: hero.id, confidence: similarity, x: group.reduce((sum, word) => sum + (word.bbox.x0 + word.bbox.x1) / 2, 0) / group.length, y: group.reduce((sum, word) => sum + (word.bbox.y0 + word.bbox.y1) / 2, 0) / group.length };
    } });
    return best as Detection | null;
  }).filter((entry): entry is Detection => Boolean(entry)).sort((a, b) => (a.y ?? 0) - (b.y ?? 0));
}

async function createScoreboardSheet(file: File): Promise<ScoreboardSheet | null> {
  let bitmap: ImageBitmap;
  try { bitmap = await createImageBitmap(file); } catch { return null; }
  try {
    if (bitmap.width / bitmap.height < 2.6) return null;
    const cardWidth = Math.max(48, Math.round(bitmap.width * .07));
    const cardHeight = Math.max(36, Math.round(bitmap.height * .151));
    const cardY = Math.round(bitmap.height * .345);
    const scale = 5, gap = 40, rowHeight = cardHeight * scale + gap;
    const canvas = document.createElement("canvas");
    canvas.width = cardWidth * scale; canvas.height = rowHeight * 12;
    const output = canvas.getContext("2d", { willReadFrequently: true });
    if (!output) return null;
    output.fillStyle = "white"; output.fillRect(0, 0, canvas.width, canvas.height); output.imageSmoothingEnabled = false;

    for (let slot = 0; slot < 12; slot += 1) {
      const sideOffset = slot < 6 ? 0 : bitmap.width * .58;
      const sideSlot = slot % 6;
      const cardX = Math.round(sideOffset + sideSlot * bitmap.width * .07);
      const source = document.createElement("canvas"); source.width = cardWidth; source.height = cardHeight;
      const context = source.getContext("2d", { willReadFrequently: true });
      if (!context) continue;
      context.drawImage(bitmap, cardX, cardY, cardWidth, cardHeight, 0, 0, cardWidth, cardHeight);
      const image = context.getImageData(0, 0, cardWidth, cardHeight);
      const gray = new Uint8Array(cardWidth * cardHeight);
      for (let pixel = 0; pixel < gray.length; pixel += 1) {
        const offset = pixel * 4;
        gray[pixel] = Math.round(image.data[offset] * .299 + image.data[offset + 1] * .587 + image.data[offset + 2] * .114);
      }
      const integral = new Uint32Array((cardWidth + 1) * (cardHeight + 1));
      for (let y = 0; y < cardHeight; y += 1) {
        let rowSum = 0;
        for (let x = 0; x < cardWidth; x += 1) {
          rowSum += gray[y * cardWidth + x];
          integral[(y + 1) * (cardWidth + 1) + x + 1] = integral[y * (cardWidth + 1) + x + 1] + rowSum;
        }
      }
      const radius = 3;
      for (let y = 0; y < cardHeight; y += 1) for (let x = 0; x < cardWidth; x += 1) {
        const x0 = Math.max(0, x - radius), x1 = Math.min(cardWidth - 1, x + radius);
        const y0 = Math.max(0, y - radius), y1 = Math.min(cardHeight - 1, y + radius);
        const stride = cardWidth + 1;
        const sum = integral[(y1 + 1) * stride + x1 + 1] - integral[y0 * stride + x1 + 1] - integral[(y1 + 1) * stride + x0] + integral[y0 * stride + x0];
        const mean = sum / ((x1 - x0 + 1) * (y1 - y0 + 1));
        const value = gray[y * cardWidth + x] > mean + 8 ? 0 : 255;
        const offset = (y * cardWidth + x) * 4;
        image.data[offset] = value; image.data[offset + 1] = value; image.data[offset + 2] = value; image.data[offset + 3] = 255;
      }
      context.putImageData(image, 0, 0);
      output.drawImage(source, 0, slot * rowHeight, canvas.width, cardHeight * scale);
    }
    return { canvas, rowHeight };
  } finally { bitmap.close(); }
}

function detectScoreboardRows(words: OcrWord[], heroes: Hero[], rowHeight: number): Detection[] {
  const used = new Set<number>(); const found: Detection[] = [];
  for (let slot = 0; slot < 12; slot += 1) {
    const rawRowWords = words.filter((word) => {
      const center = (word.bbox.y0 + word.bbox.y1) / 2;
      return center >= slot * rowHeight && center < (slot + 1) * rowHeight;
    }).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
    const rowWords = rawRowWords.map((word) => normalizeText(word.text)).filter(Boolean);
    let best: { hero: Hero; confidence: number } | null = null;
    for (const hero of heroes) {
      if (used.has(hero.id)) continue;
      const target = normalizeText(hero.name); let confidence = 0;
      for (let size = 1; size <= Math.min(3, rowWords.length); size += 1) for (let index = 0; index <= rowWords.length - size; index += 1) {
        const candidate = rowWords.slice(index, index + size).join("");
        const similarity = candidate === target ? 1 : 1 - editDistance(target, candidate) / Math.max(target.length, candidate.length, 1);
        confidence = Math.max(confidence, similarity);
      }
      if (confidence >= (target.length <= 4 ? .72 : .66) && (!best || confidence > best.confidence)) best = { hero, confidence };
    }
    if (!best) continue;
    used.add(best.hero.id);
    const index = slot % 6;
    const playerName = rawRowWords.find((word) => {
      const normalized = normalizeText(word.text);
      return normalized.length >= 3 && normalized !== normalizeText(best.hero.name) && !["kda", "kills", "assists"].includes(normalized);
    })?.text.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, "");
    found.push({ id: best.hero.id, confidence: best.confidence, x: slot < 6 ? index : index + 8, y: 0, side: slot < 6 ? "ally" : "enemy", isOwn: false, playerName, lane: index < 2 ? "yellow" : index < 4 ? "blue" : "green" });
  }
  return found;
}

function attachPlayerNames(detections: Detection[], words: OcrWord[], heroes: Hero[]): Detection[] {
  const heroNames = new Set(heroes.map((hero) => normalizeText(hero.name)));
  return detections.map((entry) => {
    if (entry.x == null || entry.y == null) return entry;
    const candidate = words.filter((word) => {
      const x = (word.bbox.x0 + word.bbox.x1) / 2, y = (word.bbox.y0 + word.bbox.y1) / 2;
      const normalized = normalizeText(word.text);
      return normalized.length >= 3 && !heroNames.has(normalized) && Math.abs(x - entry.x!) < 90 && y < entry.y! && entry.y! - y < 70;
    }).sort((a, b) => b.bbox.y1 - a.bbox.y1)[0];
    return { ...entry, playerName: candidate?.text.replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, ""), isOwn: false };
  });
}

function markRememberedPlayer(detections: Detection[]): Detection[] {
  const remembered = normalizeText(window.localStorage.getItem("counterbuild-player-name") ?? "");
  if (!remembered) return detections.map((entry) => ({ ...entry, isOwn: false }));
  const own = detections.find((entry) => entry.side === "ally" && normalizeText(entry.playerName ?? "") === remembered);
  return detections.map((entry) => ({ ...entry, isOwn: entry.id === own?.id }));
}

function classifyScoreboard(detections: Detection[], ownHeroId: number): Detection[] {
  if (detections.length < 2) return detections;
  const split = (axis: "x" | "y") => { const ordered = [...detections].sort((a, b) => (a[axis] ?? 0) - (b[axis] ?? 0)); let splitAt = Math.ceil(ordered.length / 2), biggestGap = -1; for (let index = 1; index < ordered.length; index += 1) { const gap = (ordered[index][axis] ?? 0) - (ordered[index - 1][axis] ?? 0); if (gap > biggestGap) { biggestGap = gap; splitAt = index; } } return { groups: [ordered.slice(0, splitAt), ordered.slice(splitAt)].filter((group) => group.length), gap: biggestGap }; };
  const horizontal = split("x"), vertical = split("y"), usesColumns = horizontal.gap > vertical.gap * 2;
  const groups = usesColumns ? horizontal.groups : vertical.groups;
  const knownOwnGroup = groups.findIndex((group) => group.some((entry) => entry.id === ownHeroId));
  const allyGroupIndex = usesColumns ? 0 : knownOwnGroup >= 0 ? knownOwnGroup : 0;
  const allyGroup = groups[allyGroupIndex] ?? groups[0];
  const detectedOwn = usesColumns ? [...allyGroup].sort((a, b) => (b.x ?? 0) - (a.x ?? 0))[0] : allyGroup.find((entry) => entry.id === ownHeroId) ?? allyGroup[0];
  return groups.flatMap((group, groupIndex) => [...group].sort((a, b) => (a.x ?? 0) - (b.x ?? 0)).map((entry, index) => ({ ...entry, side: groupIndex === allyGroupIndex ? "ally" as const : "enemy" as const, isOwn: entry.id === detectedOwn?.id, lane: (index < 2 ? "yellow" : index < 4 ? "blue" : "green") as Exclude<Lane, "all"> })));
}

function HeroPortrait({ hero, size = "normal" }: { hero?: Hero; size?: "small" | "normal" }) {
  return <span className={`portrait portrait-${size}`}>{hero?.images?.icon_image_small_webp ? <img src={hero.images.icon_image_small_webp} alt="" /> : hero?.name.slice(0, 1) ?? "?"}</span>;
}

export default function Home() {
  const [lang, setLang] = useState<Lang>("en");
  const [heroes, setHeroes] = useState<Hero[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [heroId, setHeroId] = useState(72);
  const [heroPickerOpen, setHeroPickerOpen] = useState(false);
  const [heroSearch, setHeroSearch] = useState("");
  const [allyPickerOpen, setAllyPickerOpen] = useState(false);
  const [allySearch, setAllySearch] = useState("");
  const [allyIds, setAllyIds] = useState<number[]>([14, 19, 79, 17, 65]);
  const [pendingAllyIds, setPendingAllyIds] = useState<number[]>([]);
  const [enemyPickerOpen, setEnemyPickerOpen] = useState(false);
  const [enemySearch, setEnemySearch] = useState("");
  const [pendingEnemyIds, setPendingEnemyIds] = useState<number[]>([]);
  const [enemyIds, setEnemyIds] = useState<number[]>([31, 10, 6, 58, 3, 66]);
  const [carryId, setCarryId] = useState(31);
  const [gameMinute, setGameMinute] = useState(15);
  const [category, setCategory] = useState<Category>("all");
  const [minSample, setMinSample] = useState(250);
  const [sortMode, setSortMode] = useState<SortMode>("buytime");
  const [buyTarget, setBuyTarget] = useState<BuyTarget>("carry");
  const [showFullBuild, setShowFullBuild] = useState(false);
  const [showAllCounters, setShowAllCounters] = useState(false);
  const [queueMode, setQueueMode] = useState<QueueMode>("all");
  const [dataWindow, setDataWindow] = useState(30);
  const [laneOnly, setLaneOnly] = useState(false);
  const [lane, setLane] = useState<Lane>("all");
  const [laneOpponentId, setLaneOpponentId] = useState(31);
  const [laneAssignments, setLaneAssignments] = useState<Record<number, Exclude<Lane, "all">>>({});
  const [draggedHeroId, setDraggedHeroId] = useState<number | null>(null);
  const [dragOverLane, setDragOverLane] = useState<Exclude<Lane, "all"> | null>(null);
  const [maxBudget, setMaxBudget] = useState(0);
  const [itemTier, setItemTier] = useState(0);
  const [resultCount, setResultCount] = useState(8);
  const [positiveLiftOnly, setPositiveLiftOnly] = useState(false);
  const [buildStyle, setBuildStyle] = useState<BuildStyle>("balanced");
  const [matchState, setMatchState] = useState<"ahead" | "even" | "behind">("even");
  const [threats, setThreats] = useState({ healing: false, weapon: false, spirit: false, crowdControl: false });
  const [souls, setSouls] = useState(0);
  const [ownedItemIds, setOwnedItemIds] = useState<number[]>([]);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [selectedEnemySignal, setSelectedEnemySignal] = useState<EnemyBuildSignal | null>(null);
  const [presetMessage, setPresetMessage] = useState("");
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [itemFlow, setItemFlow] = useState<import("./lib/data/deadlock-api").ItemFlowStats | null>(null);
  const [enemyBuildSignals, setEnemyBuildSignals] = useState<EnemyBuildSignal[]>([]);
  const [matchup, setMatchup] = useState<CounterStat | null>(null);
  const [allCounterStats, setAllCounterStats] = useState<CounterStat[]>([]);
  const [laneCounterStats, setLaneCounterStats] = useState<CounterStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [statlockerStatus, setStatlockerStatus] = useState<StatlockerStatus>("not_configured");
  const [liveProfiles, setLiveProfiles] = useState<Record<number, StatlockerProfile>>({});
  const [personalHeroProfile, setPersonalHeroProfile] = useState<PersonalHeroProfile | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [darkMode, setDarkMode] = useState(true);
  const [patchNote, setPatchNote] = useState<PatchNote | null>(null);
  const [patchOpen, setPatchOpen] = useState(false);
  const [patchBusy, setPatchBusy] = useState(false);
  const [patchError, setPatchError] = useState(false);
  const [liveImportOpen, setLiveImportOpen] = useState(false);
  const [steamQuery, setSteamQuery] = useState("");
  const [savedSteamProfile, setSavedSteamProfile] = useState<SteamProfile | null>(null);
  const [steamCandidates, setSteamCandidates] = useState<SteamProfile[]>([]);
  const [liveImportBusy, setLiveImportBusy] = useState(false);
  const [liveImportMessage, setLiveImportMessage] = useState("");
  const [importedMatchId, setImportedMatchId] = useState<number | null>(null);
  const [companionStatus, setCompanionStatus] = useState<"offline" | "waiting" | "connected">("offline");
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null);
  const [desktopLiveMatch, setDesktopLiveMatch] = useState<DesktopMatch | null>(null);
  const [desktopSoulsKnown, setDesktopSoulsKnown] = useState<boolean | null>(null);
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences | null>(null);
  const [desktopTab, setDesktopTab] = useState<"match" | "build" | "review" | "history" | "system">("match");
  const [matchCompleteNotice, setMatchCompleteNotice] = useState<{ matchId: number; ready: boolean } | null>(null);
  const [unseenReviewMatchId, setUnseenReviewMatchId] = useState<number | null>(null);
  const [desktopLastMatch, setDesktopLastMatch] = useState<DesktopMatch | null>(null);
  const [desktopAdvice, setDesktopAdvice] = useState<DesktopAdvice | null>(null);
  const [desktopOwnedItemIds, setDesktopOwnedItemIds] = useState<number[]>([]);
  const [desktopCaptureBusy, setDesktopCaptureBusy] = useState(false);
  const [desktopCaptureError, setDesktopCaptureError] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateBusy, setUpdateBusy] = useState(false);
  const [desktopMonitors, setDesktopMonitors] = useState<DesktopMonitor[]>([]);
  const [desktopMonitorIndex, setDesktopMonitorIndex] = useState(0);
  const effectiveGameTimeSeconds = desktopStatus?.in_game && desktopLiveMatch?.game_time_s != null ? desktopLiveMatch.game_time_s : gameMinute * 60;
  const profileRosterKey = desktopLiveMatch?.players.map((player) => player.account_id).filter((id): id is number => id != null).sort((a, b) => a - b).filter((id, index, ids) => index === 0 || id !== ids[index - 1]).join(",") ?? "";
  const playerProfiles = useMemo(() => savedSteamProfile ? { ...liveProfiles, [savedSteamProfile.account_id]: liveProfiles[savedSteamProfile.account_id] ?? { accountId: savedSteamProfile.account_id, name: savedSteamProfile.personaname, avatarUrl: savedSteamProfile.avatar || null, ppScore: null, estimatedRankNumber: null, region: null } } : liveProfiles, [liveProfiles, savedSteamProfile]);
  const ownAccountId = desktopLiveMatch?.account_id ?? savedSteamProfile?.account_id ?? null;

  useEffect(() => {
    if (!matchCompleteNotice) return;
    const timer = window.setTimeout(() => setMatchCompleteNotice(null), 9000);
    return () => window.clearTimeout(timer);
  }, [matchCompleteNotice]);

  useEffect(() => {
    const profile = ownAccountId == null ? null : playerProfiles[ownAccountId];
    if (!profile || !heroId) return;
    let active = true;
    void syncPersonalHeroProfile(ownAccountId!, heroId, profile).then((result) => { if (active) setPersonalHeroProfile(result); });
    return () => { active = false; };
  }, [heroId, historyRevision, ownAccountId, playerProfiles]);

  useEffect(() => {
    if (!profileRosterKey) return;
    let active = true;
    const ids = profileRosterKey.split(",").map(Number);
    const load = () => void fetchStatlockerProfiles(ids).then((result) => {
        if (!active) return;
        setLiveProfiles((current) => ({ ...current, ...Object.fromEntries(result.profiles.map((profile) => [profile.accountId, profile])) }));
        setStatlockerStatus(result.status);
      }).catch(() => { /* profile enrichment never blocks a live match */ });
    load();
    const timer = window.setInterval(load, 15 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [profileRosterKey]);
  const [importerOpen, setImporterOpen] = useState(false);
  const [importTarget, setImportTarget] = useState<ImportTarget>("enemy");
  const [screenshotUrl, setScreenshotUrl] = useState("");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrComplete, setOcrComplete] = useState(false);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [selectedDetections, setSelectedDetections] = useState<number[]>([]);
  const enemyRosterRef = useRef<HTMLDivElement>(null);
  const analysisRunRef = useRef(0);
  const analysisContextRef = useRef<string | null>(null);
  const analysisTriggerRef = useRef<string | null>(null);
  const companionMatchRef = useRef<number | null>(null);
  const companionCaptureRef = useRef<number | null>(null);
  const companionRosterRef = useRef<number | null>(null);
  const desktopBuildRef = useRef<string | null>(null);
  const desktopRosterKeyRef = useRef<string | null>(null);
  const desktopSnapshotRef = useRef<DesktopMatch | null>(null);
  const desktopSnapshotGapRef = useRef<number | null>(null);
  const t = copy[lang];
  const phase: Phase = gameMinute < 11 ? "early" : gameMinute < 21 ? "mid" : "late";

  useEffect(() => {
    if (enemyPickerOpen) requestAnimationFrame(() => { if (enemyRosterRef.current) enemyRosterRef.current.scrollTop = 0; });
  }, [enemyPickerOpen]);

  const heroMap = useMemo(() => new Map(heroes.map((hero) => [hero.id, hero])), [heroes]);
  const liveThreatSignalKey = desktopLiveMatch?.players.filter((player) => enemyIds.includes(player.hero_id ?? -1)).map((player) => [player.hero_id, player.net_worth == null ? null : Math.floor(player.net_worth / 1500), player.kills, player.deaths, player.assists].join(":")).join("|") ?? "manual";
  const profileSignalKey = Object.values(playerProfiles).map((profile) => `${profile.accountId}:${profile.ppScore ?? ""}:${profile.estimatedRankNumber ?? ""}`).sort().join("|");
  const analysisInputKey = JSON.stringify({ heroId, enemies: enemyIds, carryId, dataWindow, queueMode, laneOnly, phase: itemFlowPhase(effectiveGameTimeSeconds), timeWindow: Math.floor(effectiveGameTimeSeconds / 300), liveThreatSignalKey, profileSignalKey, threats, buildStyle, matchState, heroCount: heroMap.size, itemCount: items.length });
  const ownHero = heroMap.get(heroId);
  const carryHero = heroMap.get(carryId);
  const allyTeamIds = useMemo(() => [heroId, ...allyIds], [allyIds, heroId]);
  const allMatchHeroIds = useMemo(() => [...allyTeamIds, ...enemyIds], [allyTeamIds, enemyIds]);

  // Keep lane assignments for newly selected roster entries in sync with the roster.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes derived lane state after roster edits
    setLaneAssignments((current) => {
      const next: Record<number, Exclude<Lane, "all">> = {};
      const assignMissing = (ids: number[]) => ids.forEach((id, index) => { next[id] = current[id] ?? (index < 2 ? "yellow" : index < 4 ? "blue" : "green"); });
      assignMissing(allyTeamIds); assignMissing(enemyIds);
      return JSON.stringify(next) === JSON.stringify(current) ? current : next;
    });
  }, [allyTeamIds, enemyIds]);

  // Apply the selected hero's lane to the matchup controls after lineup changes.
  useEffect(() => {
    const ownLane = laneAssignments[heroId]; if (!ownLane) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes dependent matchup controls
    setLane(ownLane); setLaneOnly(true);
    const laneEnemies = enemyIds.filter((id) => laneAssignments[id] === ownLane);
    if (laneEnemies.length && !laneEnemies.includes(laneOpponentId)) setLaneOpponentId(laneEnemies[0]);
  }, [enemyIds, heroId, laneAssignments, laneOpponentId]);

  // Restore browser-persisted preferences and shared-link inputs after hydration.
  useEffect(() => {
    const saved = window.localStorage.getItem("counterbuild-language");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrates state from browser storage and URL
    if (saved === "de" || saved === "en") setLang(saved);
    const savedTheme = window.localStorage.getItem("counterlock-theme");
    if (savedTheme === "light" || savedTheme === "dark") setDarkMode(savedTheme === "dark");
    try {
      const savedProfile = window.localStorage.getItem("counterlock-steam-profile");
      if (savedProfile) {
        const profile = JSON.parse(savedProfile) as SteamProfile;
        if (profile.account_id && profile.personaname) { setSavedSteamProfile(profile); setSteamQuery(profile.personaname); }
      }
    } catch { window.localStorage.removeItem("counterlock-steam-profile"); }
    const params = new URLSearchParams(window.location.search);
    const sharedHero = Number(params.get("hero")), sharedCarry = Number(params.get("carry"));
    const sharedEnemies = (params.get("enemies") ?? "").split(",").map(Number).filter((id) => Number.isFinite(id) && id > 0).slice(0, 6);
    const sharedAllies = (params.get("allies") ?? "").split(",").map(Number).filter((id) => Number.isFinite(id) && id > 0).slice(0, 5);
    if (sharedHero) setHeroId(sharedHero);
    if (sharedEnemies.length) setEnemyIds(sharedEnemies);
    if (sharedAllies.length) setAllyIds(sharedAllies);
    if (sharedCarry) setCarryId(sharedCarry);
    const minute = Number(params.get("minute")); if (minute >= 1 && minute <= 40) setGameMinute(minute);
    const queue = params.get("queue"); if (queue === "ranked" || queue === "unranked") setQueueMode(queue);
    const windowDays = Number(params.get("window")); if ([7, 30, 90].includes(windowDays)) setDataWindow(windowDays);
    if (params.get("target") === "team") setBuyTarget("team");
    const sharedLane = params.get("lane"); if (["blue", "green", "yellow", "purple"].includes(sharedLane ?? "")) { setLane(sharedLane as Lane); setLaneOnly(true); }
    const sharedLaneOpponent = Number(params.get("laneOpponent")); if (sharedLaneOpponent) setLaneOpponentId(sharedLaneOpponent);
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

  useEffect(() => {
    document.documentElement.dataset.theme = darkMode ? "dark" : "light";
    window.localStorage.setItem("counterlock-theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  useEffect(() => {
    if (desktopAvailable()) return;
    let mounted = true;
    const pollCompanion = async () => {
      try {
        const response = await fetch("http://127.0.0.1:9876/v1/status", { cache: "no-store" });
        if (!response.ok) throw new Error("companion unavailable");
        const status = await response.json() as CompanionStatus;
        if (!mounted) return;
        setCompanionStatus(status.in_game ? "connected" : "waiting");
        if (status.in_game && status.match_id && status.hud_capture_available && companionCaptureRef.current !== status.match_id) {
          companionCaptureRef.current = status.match_id;
          try {
            const image = await fetch("http://127.0.0.1:9876/v1/hud-capture", { cache: "no-store" });
            if (!image.ok) throw new Error("capture unavailable");
            const blob = await image.blob();
            if (!mounted || !blob.size) return;
            setImportTarget("auto"); setImporterOpen(true);
            void readScreenshot(new File([blob], "counterlock-live-hud.png", { type: "image/png" }), "auto");
          } catch { companionCaptureRef.current = null; }
        }
        if (!status.in_game || !status.match_id || importedMatchId === status.match_id) return;
        companionMatchRef.current = status.match_id;
        setLiveImportOpen(true);
        if (status.roster_available && companionRosterRef.current !== status.match_id) {
          companionRosterRef.current = status.match_id;
          try { await importCompanionRoster(); if (mounted) return; } catch { companionRosterRef.current = null; }
          if (!mounted) return;
        }
        if (!status.account_id) return;
        void importLiveMatch({ account_id: status.account_id, personaname: `Steam ${status.account_id}`, profileurl: "", avatar: "" });
      } catch { if (mounted) setCompanionStatus("offline"); }
    };
    void pollCompanion();
    const timer = window.setInterval(() => void pollCompanion(), 8_000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [importedMatchId]);

  useEffect(() => {
    if (!desktopAvailable()) return;
    let active = true;
    const stops: Array<() => void> = [];
    const applyStatus = (status: Awaited<ReturnType<typeof getDesktopStatus>>) => {
      if (active) { setDesktopStatus(status); setCompanionStatus(status.in_game ? "connected" : "waiting"); }
    };
    const applySnapshot = (snapshot: DesktopMatch | null) => {
      if (!active) return;
      if (!snapshot) {
        if (desktopSnapshotGapRef.current != null) window.clearTimeout(desktopSnapshotGapRef.current);
        desktopSnapshotGapRef.current = window.setTimeout(() => {
          desktopSnapshotGapRef.current = null;
          if (!active) return;
          const endedMatchId = desktopSnapshotRef.current?.match_id;
          desktopSnapshotRef.current = null; setDesktopLiveMatch(null); desktopRosterKeyRef.current = null;
          setDesktopSoulsKnown(null); setDesktopOwnedItemIds([]); setDesktopAdvice(null);
          void getLastMatch().then((last) => {
            if (!active) return;
            setDesktopLastMatch(last);
            if (endedMatchId && last?.match_id === endedMatchId) {
              const accountId = last.account_id ?? savedSteamProfile?.account_id;
              const completed = accountId ? recommendationOutcomeCache(accountId, window.localStorage).completed[endedMatchId] : null;
              setMatchCompleteNotice({ matchId: endedMatchId, ready: Boolean(completed) });
            }
          });
        }, 12_000);
        return;
      }
      if (desktopSnapshotGapRef.current != null) window.clearTimeout(desktopSnapshotGapRef.current);
      desktopSnapshotGapRef.current = null;
      const previous = desktopSnapshotRef.current;
      let stableSnapshot = snapshot;
      if (previous && previous.match_id === snapshot.match_id && previous.account_id === snapshot.account_id) {
        const keyOf = (player: DesktopMatch["players"][number], index: number) => player.account_id != null ? `account:${player.account_id}` : `bot:${player.team ?? "?"}:${player.hero_id ?? index}`;
        const incoming = new Map(snapshot.players.map((player, index) => [keyOf(player, index), player]));
        const seen = new Set<string>();
        const merged = previous.players.map((player, index) => {
          const key = keyOf(player, index); seen.add(key);
          const fresh = incoming.get(key);
          if (!fresh) return player;
          return { ...player, ...fresh, hero_id: fresh.hero_id ?? player.hero_id, team: fresh.team ?? player.team,
            kills: fresh.kills ?? player.kills, deaths: fresh.deaths ?? player.deaths, assists: fresh.assists ?? player.assists,
            net_worth: fresh.net_worth ?? player.net_worth, unspent_souls: fresh.unspent_souls ?? player.unspent_souls,
            owned_item_class_tokens: fresh.owned_item_class_tokens ?? player.owned_item_class_tokens, items: fresh.items ?? player.items };
        });
        snapshot.players.forEach((player, index) => { if (!seen.has(keyOf(player, index))) merged.push(player); });
        stableSnapshot = { ...previous, ...snapshot, game_time_s: snapshot.game_time_s ?? previous.game_time_s, players: merged };
      }
      desktopSnapshotRef.current = stableSnapshot;
      setDesktopLiveMatch(stableSnapshot);
      const own = stableSnapshot.players.find((entry) => entry.account_id != null && entry.account_id === stableSnapshot.account_id);
      setDesktopSoulsKnown(own?.unspent_souls != null);
      if (own?.unspent_souls != null) setSouls(own.unspent_souls);
      // An empty inventory is meaningful only when the selected provider can read it.
      const rosterKey = JSON.stringify([stableSnapshot.match_id, stableSnapshot.account_id, stableSnapshot.players.map((entry) => [entry.account_id, entry.hero_id, entry.team])]);
      if (stableSnapshot.players.length && stableSnapshot.account_id != null && desktopRosterKeyRef.current !== rosterKey) {
        if (applyMatchRoster(stableSnapshot.players, stableSnapshot.account_id, stableSnapshot)) {
          desktopRosterKeyRef.current = rosterKey;
          setImportedMatchId(stableSnapshot.match_id);
        }
      }
    };
    void getDesktopStatus().then(applyStatus).catch(() => active && setCompanionStatus("offline"));
    void getDesktopMatch().then(applySnapshot);
    void getLastMatch().then((last) => { if (active) setDesktopLastMatch(last); });
    void onDesktopStatus(applyStatus).then((stop) => { if (active) stops.push(stop); else stop(); });
    void onDesktopMatch(applySnapshot).then((stop) => { if (active) stops.push(stop); else stop(); });
    return () => { active = false; if (desktopSnapshotGapRef.current != null) window.clearTimeout(desktopSnapshotGapRef.current); stops.forEach((stop) => stop()); };
  }, [importedMatchId]);

  useEffect(() => {
    if (!desktopAvailable()) return;
    let active = true;
    let stop: (() => void) | null = null;
    void getDesktopPreferences().then((preferences) => { if (active) setDesktopPreferences(preferences); });
    void getDesktopMonitors().then((monitors) => {
      if (!active) return;
      setDesktopMonitors(monitors);
      const savedRaw = window.localStorage.getItem("counterlock-capture-monitor");
      const saved = Number(savedRaw);
      const largest = monitors.reduce((best, monitor) => monitor.width * monitor.height > (monitors[best]?.width ?? 0) * (monitors[best]?.height ?? 0) ? monitor.index : best, 0);
      setDesktopMonitorIndex(savedRaw !== null && Number.isInteger(saved) && saved >= 0 && saved < monitors.length ? saved : largest);
    }).catch(() => {});
    void onOpenSettings(() => { if (active) setDesktopTab("system"); }).then((unlisten) => { if (active) stop = unlisten; else unlisten(); });
    return () => { active = false; stop?.(); };
  }, []);

  const enemyBuildInsights = useMemo(() => enemyBuildSignals.map((signal) => ({ ...signal, items: signal.stats.map((stat) => ({ stat, item: items.find((item) => item.id === stat.item_id) })).filter((entry): entry is { stat: ItemStat; item: Item } => Boolean(entry.item)) })), [enemyBuildSignals, items]);
  const lifestealDetected = useMemo(() => enemyBuildInsights.some((signal) => signal.items.some(({ item }) => tagsForItem(item.class_name).includes("healing"))), [enemyBuildInsights]);

  useEffect(() => {
    if (!desktopAvailable()) return;
    let active = true;
    let stop: (() => void) | null = null;
    const applyAdvice = (advice: DesktopAdvice | null) => {
      if (!active || !advice) return; // A transient incomplete snapshot must not erase the last usable live plan.
      setDesktopAdvice(advice);
      setDesktopOwnedItemIds(advice.inventory_known ? advice.owned_item_ids ?? [] : []);
    };
    void getRecommendations().then(applyAdvice);
    void onRecommendations(applyAdvice).then((unlisten) => { if (active) stop = unlisten; else unlisten(); });
    return () => { active = false; stop?.(); };
  }, []);

  async function updateDesktopPreferences(patch: Partial<DesktopPreferences>) {
    if (!desktopPreferences) return;
    const next = { ...desktopPreferences, ...patch };
    await saveDesktopPreferences(next);
    setDesktopPreferences(next);
  }

  async function checkDesktopUpdates() {
    setUpdateBusy(true);
    setUpdateStatus(lang === "de" ? "Suche nach Updates …" : "Checking for updates…");
    try {
      const update = await checkForDesktopUpdate();
      if (!update) {
        setUpdateStatus(lang === "de" ? "Du verwendest die aktuelle Version." : "You’re up to date.");
        return;
      }
      const prompt = lang === "de"
        ? `Counterlock ${update.version} ist verfügbar. Jetzt installieren?`
        : `Counterlock ${update.version} is available. Install it now?`;
      if (!window.confirm(prompt)) {
        setUpdateStatus(lang === "de" ? `Version ${update.version} verfügbar.` : `Version ${update.version} is available.`);
        return;
      }
      setUpdateStatus(lang === "de" ? "Update wird installiert …" : "Installing update…");
      await installDesktopUpdate(update);
    } catch (error) {
      setUpdateStatus(`${lang === "de" ? "Update fehlgeschlagen" : "Update failed"}: ${String(error)}`);
    } finally {
      setUpdateBusy(false);
    }
  }

  const analyze = useCallback(async () => {
    if (!items.length || !enemyIds.length) return;
    const contextKey = `${heroId}:${enemyIds.join(",")}:${carryId}`;
    if (analysisContextRef.current && analysisContextRef.current !== contextKey) {
      setRecommendations([]);
      setItemFlow(null);
      setAllCounterStats([]);
      setLaneCounterStats([]);
    }
    analysisContextRef.current = contextKey;
    const runId = ++analysisRunRef.current;
    setLoading(true); setError(""); setCopied(false);
    try {
      // Keep a usable build pool for less frequently played heroes and recent
      // balance windows. The UI can still apply its own higher confidence
      // threshold when displaying statistical comparisons.
      const commonParams = new URLSearchParams({ min_matches: "10", game_mode: "normal", min_unix_timestamp: String(Math.floor(Date.now() / 1000) - dataWindow * 86400) });
      const playerRank = ownAccountId == null ? null : playerProfiles[ownAccountId]?.estimatedRankNumber ?? null;
      const cohort = rankCohort(playerRank);
      if (cohort) { commonParams.set("min_average_badge", String(cohort.min)); commonParams.set("max_average_badge", String(cohort.max)); }
      if (queueMode !== "all") commonParams.set("match_mode", queueMode);
      const common = commonParams.toString();
      const matchupParams = new URLSearchParams(commonParams); matchupParams.set("same_lane_filter", String(laneOnly));
      const matchupCommon = matchupParams.toString();
      const livePurchaseParams = desktopStatus?.in_game && desktopLiveMatch?.game_time_s != null ? new URLSearchParams(matchupCommon) : null;
      if (livePurchaseParams) {
        const windowCenter = Math.floor(effectiveGameTimeSeconds / 300) * 300;
        livePurchaseParams.set("min_bought_at_s", String(Math.max(0, windowCenter - 300)));
        livePurchaseParams.set("max_bought_at_s", String(windowCenter + 600));
      }
      const laneCounterParams = new URLSearchParams(commonParams); laneCounterParams.set("same_lane_filter", "true");
      const laneItemParams = new URLSearchParams(commonParams); laneItemParams.set("same_lane_filter", "true"); laneItemParams.set("min_bought_at_s", "0"); laneItemParams.set("max_bought_at_s", "600");
      const responses = await Promise.allSettled([
        cachedJson<ItemStat[]>(itemStatsUrl(heroId, new URLSearchParams(common))),
        cachedJson<ItemStat[]>(itemStatsUrl(heroId, new URLSearchParams(matchupCommon), enemyIds, true)),
        cachedJson<ItemStat[]>(itemStatsUrl(heroId, new URLSearchParams(matchupCommon), [carryId])),
        cachedJson<CounterStat[]>(`${API}/analytics/hero-counter-stats?${matchupCommon}`),
        cachedJson<CounterStat[]>(`${API}/analytics/hero-counter-stats?${laneCounterParams}`),
        Promise.allSettled(enemyIds.map((enemyId) => cachedJson<ItemStat[]>(itemStatsUrl(heroId, new URLSearchParams(matchupCommon), [enemyId])))),
        Promise.allSettled(enemyIds.map((enemyId) => cachedJson<ItemStat[]>(itemStatsUrl(enemyId, new URLSearchParams(common))))),
        livePurchaseParams ? Promise.allSettled(enemyIds.map((enemyId) => cachedJson<ItemStat[]>(itemStatsUrl(heroId, new URLSearchParams(livePurchaseParams), [enemyId])))) : Promise.resolve([]),
        effectiveGameTimeSeconds < 600 && enemyIds.includes(laneOpponentId) ? cachedJson<ItemStat[]>(itemStatsUrl(heroId, laneItemParams, [laneOpponentId])) : Promise.resolve([] as ItemStat[]),
      ] as const);
      const unwrap = <T,>(result: PromiseSettledResult<T>, label: string, fallback: T): T => {
        if (result.status === "fulfilled") return result.value;
        console.warn(`Deadlock API ${label} unavailable; recommendations will use remaining evidence.`, result.reason);
        return fallback;
      };
      let baseStats = unwrap(responses[0], "hero item stats", [] as ItemStat[]);
      if (cohort && !rankDataHasCoverage(baseStats.map((stat) => stat.matches))) {
        const broadParams = new URLSearchParams(commonParams);
        broadParams.delete("min_average_badge"); broadParams.delete("max_average_badge");
        baseStats = await cachedJson<ItemStat[]>(itemStatsUrl(heroId, broadParams)).catch(() => baseStats);
      }
      const teamStats = unwrap(responses[1], "exact enemy lineup item stats", [] as ItemStat[]);
      const carryStats = unwrap(responses[2], "focus enemy item stats", [] as ItemStat[]);
      const counterStats = unwrap(responses[3], "hero matchup stats", [] as CounterStat[]);
      const laneStats = unwrap(responses[4], "lane matchup stats", [] as CounterStat[]);
      const settlePerEnemy = (results: PromiseSettledResult<ItemStat[]>[], label: string) => results.map((result, index) => {
        if (result.status === "fulfilled") return result.value;
        console.warn(`Deadlock API ${label} unavailable for hero ${enemyIds[index]}; other enemy evidence remains usable.`, result.reason);
        return [] as ItemStat[];
      });
      const individualEnemyStats = settlePerEnemy(unwrap(responses[5], "individual enemy item stats", []), "individual enemy item stats");
      const enemyBuildStats = settlePerEnemy(unwrap(responses[6], "common enemy item stats", []), "common enemy item stats");
      const livePurchaseStats = settlePerEnemy(unwrap(responses[7], "live purchase-time matchup statistics", []), "live purchase-time matchup statistics");
      const laneItemStats = unwrap(responses[8], "same-lane early item statistics", [] as ItemStat[]);
      const flowQuery = new URLSearchParams(commonParams); flowQuery.set("hero_ids", String(heroId));
      const flowResult = await Promise.allSettled([itemFlowStats(`${API}/analytics/item-flow-stats?${flowQuery}`)]);
      if (runId !== analysisRunRef.current) return;
      setItemFlow(flowResult[0].status === "fulfilled" ? flowResult[0].value : null);
      if (flowResult[0].status === "rejected") console.warn("Optional Deadlock item-flow data unavailable; continuing with item and matchup statistics.", flowResult[0].reason);
      if (runId !== analysisRunRef.current) return;
      const abilityResults = await Promise.allSettled(enemyIds.map((enemyId) => cachedJson<HeroAbilityEvidence[]>(`${API}/assets/items/by-hero-id/${enemyId}?language=english`, 24 * 60 * 60 * 1000)));
      const enemyThreatProfiles = new Map(enemyIds.map((enemyId, index) => [enemyId, mergedHeroThreats(enemyId, abilityResults[index].status === "fulfilled" ? abilityResults[index].value : [])]));
      if (runId !== analysisRunRef.current) return;
      const baseMap = new Map(baseStats.map((stat) => [stat.item_id, stat]));
      const teamMap = new Map(teamStats.map((stat) => [stat.item_id, stat]));
      const carryMap = new Map(carryStats.map((stat) => [stat.item_id, stat]));
      const individualEnemyMaps = individualEnemyStats.map((stats, index) => {
        const historical = new Map(livePurchaseStats[index].map((stat) => [stat.item_id, stat]));
        const general = new Map(stats.map((stat) => [stat.item_id, stat]));
        // Ten-minute match-time window; fall back item-by-item when evidence is sparse.
        return new Map([...new Set([...general.keys(), ...historical.keys()])].map((id) => {
          const timed = historical.get(id);
          return [id, timed && timed.matches >= 40 ? timed : general.get(id)!] as const;
        }).filter((entry): entry is readonly [number, ItemStat] => Boolean(entry[1])));
      });
      setEnemyBuildSignals(enemyIds.map((heroId, index) => ({ heroId, stats: enemyBuildStats[index].sort((a, b) => b.matches - a.matches).slice(0, 4) })));
      const calculated = items.map((item) => {
        const base = baseMap.get(item.id), team = teamMap.get(item.id), carry = carryMap.get(item.id);
        if (!base && !team && !carry && !individualEnemyMaps.some((map) => map.has(item.id))) return null;
        const carryItemEvidence = individualEnemyMaps[enemyIds.indexOf(carryId)]?.get(item.id);
        const baselineRate = adjustedRate(base), winRate = team ? adjustedRate(team) : baselineRate, carryRate = carry ? adjustedRate(carry) : carryItemEvidence ? adjustedRate(carryItemEvidence) : baselineRate;
        const carryMatches = carry?.matches ?? carryItemEvidence?.matches ?? 0;
        const carryConfidence = carryMatches ? Math.min(1, Math.log10(Math.max(10, carryMatches)) / 4.7) : 0;
        const carryUplift = Math.max(-0.06, Math.min(0.06, carryRate - baselineRate));
        const enemyRates = enemyIds.map((enemyId, index) => { const stat = individualEnemyMaps[index].get(item.id); const rate = adjustedRate(stat); return stat ? { heroId: enemyId, rate, matches: stat.matches, lift: rate - baselineRate } : null; }).filter((entry): entry is EnemyItemRate => Boolean(entry)).sort((a, b) => b.lift - a.lift);
        const laneStat = laneItemStats.find(stat => stat.item_id === item.id);
        const liveOwnNow = desktopLiveMatch?.players.find(player => player.account_id != null && player.account_id === desktopLiveMatch.account_id);
        const laneEnemyNow = desktopLiveMatch?.players.find(player => player.hero_id === laneOpponentId);
        const lane = laneState(liveOwnNow?.net_worth ?? null, [laneEnemyNow?.net_worth ?? null]);
        const laneIntentWeight = effectiveGameTimeSeconds < 600 ? 1 : 0;
        const laneFit = laneStat ? laneBuyScore({ matchupFit: Math.max(0, adjustedRate(laneStat)-baselineRate)*10, earlyHeroFit: item.item_tier===1?1:.35, sustainNeed: lane==="behind"&&item.item_slot_type==="vitality"?.8:.25, pressureFit: lane==="ahead"&&(item.item_slot_type==="weapon"||item.item_slot_type==="spirit")?.8:.3, earlyTimingFit: laneStat.avg_buy_time_s<=600?1:.35, affordabilityFit: (item.cost??99999)<=1500?.8:.3, lanePowerSpikeFit: item.item_tier===1?.75:.25, deviationPenalty: .02, gameTimeSeconds:effectiveGameTimeSeconds })*laneIntentWeight:0;
        return { item, carryScore: (carryRate * .65 + winRate * .15 + baselineRate * .2 + carryUplift * .35) * carryConfidence + baselineRate * (1 - carryConfidence) + laneFit, teamScore: 0, laneFit, teamRate: winRate, baselineRate, carryRate, carryMatches, teamMatches: Math.max(team?.matches ?? 0, ...enemyRates.map((rate) => rate.matches)), exactMatches: team?.matches ?? 0, carryBuyTime: carry?.avg_buy_time_s ?? carryItemEvidence?.avg_buy_time_s ?? base?.avg_buy_time_s ?? 0, teamBuyTime: team?.avg_buy_time_s ?? base?.avg_buy_time_s ?? 0, enemyRates } satisfies Recommendation;
      }).filter((value): value is NonNullable<typeof value> => Boolean(value));
      const liveOwn = desktopLiveMatch?.players.find((player) => player.account_id != null && player.account_id === desktopLiveMatch.account_id);
      const liveEnemies = desktopLiveMatch?.players.filter((player) => liveOwn?.team != null && player.team != null && player.team !== liveOwn.team && player.hero_id != null) ?? [];
      const ppByAccount = new Map(Object.values(playerProfiles).map((profile) => [profile.accountId, profile.ppScore]));
      const liveByHero = new Map(liveEnemies.map((player) => [player.hero_id!, player]));
      const threatInputs = enemyIds.map((enemyId) => {
        const player = liveByHero.get(enemyId);
        return { heroId: enemyId, netWorth: player?.net_worth, soulsPerMinute: desktopLiveMatch?.game_time_s && player?.net_worth != null ? player.net_worth / Math.max(1, desktopLiveMatch.game_time_s / 60) : null, kills: player?.kills, deaths: player?.deaths, assists: player?.assists, statlockerPP: player?.account_id == null ? null : ppByAccount.get(player.account_id) ?? null };
      });
      const currentThreats = scoreThreats(threatInputs, effectiveGameTimeSeconds);
      const weightedThreatProfile = currentThreats.reduce((all, threat) => {
        Object.entries(enemyThreatProfiles.get(threat.heroId) ?? {}).forEach(([tag, strength]) => { all[tag] = (all[tag] ?? 0) + (strength ?? 0) * threat.weight; });
        return all;
      }, {} as Record<string, number>);
      const personal = personalSignals(personalHeroProfile?.heroId === heroId && personalHeroProfile.accountId === ownAccountId ? personalHeroProfile : null);
      const coverageByItem = new Map(calculated.map(entry => {
        const coverage = counterCoverage(threatInputs.map(enemy => { const player=liveByHero.get(enemy.heroId); return {...enemy,accountId:player?.account_id??null,playerName:player?.account_id==null?null:playerProfiles[player.account_id]?.name??null}; }), new Map(enemyIds.map(enemyId => [enemyId,{strength:Math.max(counterCapability(entry.item.class_name,enemyThreatProfiles.get(enemyId)??{}),tagMatchesManualThreat(entry.item.class_name,{...threats,healing:threats.healing||lifestealDetected}) ? 0.72 : 0),reasons:[...tagsForItem(entry.item.class_name)]}])));
        return [entry.item.id,coverage] as const;
      }));
      const ranked = rankItems(calculated.map((entry) => {
        const flow = flowResult[0].status === "fulfilled" ? flowResult[0].value : null;
        const core = flowCoreFit(flow, entry.item.id, itemFlowPhase(effectiveGameTimeSeconds));
        const itemThreats = { ...threats, healing: threats.healing || lifestealDetected };
        const mechanicFit = Math.max(counterCapability(entry.item.class_name, weightedThreatProfile), tagMatchesManualThreat(entry.item.class_name, itemThreats) ? 0.72 : 0,coverageByItem.get(entry.item.id)?.weightedThreatCoverage??0);
        const preferenceFit = (buildStyle === "safe" && entry.item.item_slot_type === "vitality") ||
          (buildStyle === "greedy" && (entry.item.cost ?? 0) >= 3200) ||
          (matchState === "behind" && entry.item.item_slot_type === "vitality") ||
          (matchState === "ahead" && (entry.item.item_slot_type === "weapon" || entry.item.item_slot_type === "spirit")) ? 1 : 0;
        return {
          itemId: entry.item.id, baselineRate: entry.baselineRate, coreRate: core?.rate ?? null,
          coreMatches: core?.matches ?? 0, exactRate: entry.teamRate, exactMatches: entry.exactMatches,
          averageBuyTimeSeconds: entry.teamBuyTime || null,
          mechanicFit, preferenceFit,
          enemyRates: entry.enemyRates.map((rate) => ({ heroId: rate.heroId, rate: rate.rate, matches: rate.matches })),
        };
      }),
        threatInputs, effectiveGameTimeSeconds, personal);
      const rankedById = new Map(ranked.map((entry) => [entry.itemId, entry]));
      const carryThreats = threatInputs.filter((enemy) => enemy.heroId === carryId);
      const carryRanked = rankItems(calculated.map((entry) => {
        const core = flowCoreFit(flowResult[0].status === "fulfilled" ? flowResult[0].value : null, entry.item.id, itemFlowPhase(effectiveGameTimeSeconds));
        return { itemId: entry.item.id, baselineRate: entry.baselineRate, coreRate: core?.rate ?? null, coreMatches: core?.matches ?? 0,
          exactRate: null, exactMatches: 0, averageBuyTimeSeconds: entry.carryBuyTime || null,
          mechanicFit: Math.max(counterCapability(entry.item.class_name, enemyThreatProfiles.get(carryId) ?? {}), tagMatchesManualThreat(entry.item.class_name, { ...threats, healing: threats.healing || lifestealDetected }) ? 0.72 : 0),
          preferenceFit: buildStyle === "safe" && entry.item.item_slot_type === "vitality" ? 1 : buildStyle === "greedy" && (entry.item.cost ?? 0) >= 3200 ? 1 : 0,
          enemyRates: entry.enemyRates.filter((rate) => rate.heroId === carryId).map(({ heroId, rate, matches }) => ({ heroId, rate, matches })) };
      }), carryThreats, effectiveGameTimeSeconds, personal);
      const carryRankedById = new Map(carryRanked.map((entry) => [entry.itemId, entry]));
      if (calculated.length) setRecommendations(calculated.map((entry) => { const scored = rankedById.get(entry.item.id); const carryScored = carryRankedById.get(entry.item.id); const selectedScore = buyTarget === "team" ? scored : carryScored; const advisorReason = selectedScore?.reason.replace(/Hero #(\d+)/g, (_match, id: string) => heroMap.get(Number(id))?.name ?? `Hero #${id}`); return { ...entry, coveredEnemyIds:coverageByItem.get(entry.item.id)?.coveredEnemies.map(enemy=>enemy.heroId)??[],carryScore: (carryScored?.score ?? 0) + (entry.laneFit ?? 0), teamScore: (scored?.score ?? 0) + (entry.laneFit ?? 0), advisorReason: entry.laneFit ? `Same-lane early timing and matchup fit. ${advisorReason ?? ""}` : advisorReason, coreFit: selectedScore?.coreFit, counterFit: selectedScore?.counterFit, counterUrgency: selectedScore?.counterUrgency, mechanicFit: selectedScore?.mechanicFit, exactFit: selectedScore?.exactFit, personalFit: selectedScore?.personalFit, threatTargets: selectedScore?.threatTargets }; }));
      setAllCounterStats(counterStats);
      setLaneCounterStats(laneStats);
      setMatchup(counterStats.find((stat) => stat.hero_id === heroId && stat.enemy_hero_id === carryId) ?? null);
      setUpdatedAt(new Date());
    } catch (error) { console.warn("Counterlock analysis failed; inspect Deadlock API responses and match inputs.", error); if (runId === analysisRunRef.current) setError(copy[lang].statsError); }
    finally { if (runId === analysisRunRef.current) setLoading(false); }
  }, [buildStyle, buyTarget, carryId, dataWindow, desktopLiveMatch, desktopStatus?.in_game, effectiveGameTimeSeconds, enemyIds, heroId, heroMap, items, laneOpponentId, laneOnly, lang, lifestealDetected, matchState, ownAccountId, personalHeroProfile, playerProfiles, queueMode, threats]);

  useEffect(() => {
    if (!desktopAvailable()) return;
    const build = desktopStatus?.build_id ?? null;
    if (desktopBuildRef.current && build && desktopBuildRef.current !== build) void analyze();
    desktopBuildRef.current = build;
  }, [desktopStatus?.build_id, analyze]);

  useEffect(() => {
    if (!items.length || !enemyIds.length || analysisTriggerRef.current === analysisInputKey) return;
    analysisTriggerRef.current = analysisInputKey;
    void analyze();
  }, [analysisInputKey, analyze, enemyIds.length, items.length]);

  function updateContext(action: () => void) { action(); setSortMode("recommended"); }

  const allOwnedItemIds = useMemo(() => Array.from(new Set([
    ...ownedItemIds,
    ...(desktopStatus?.in_game && desktopAdvice?.inventory_known && desktopAdvice.match_id === desktopLiveMatch?.match_id ? desktopOwnedItemIds : []),
  ])), [desktopAdvice?.inventory_known, desktopAdvice?.match_id, desktopLiveMatch?.match_id, desktopOwnedItemIds, desktopStatus?.in_game, ownedItemIds]);
  const ownedItemClasses = useMemo(() => new Set(items.filter((item) => allOwnedItemIds.includes(item.id) && item.class_name).map((item) => item.class_name!)), [allOwnedItemIds, items]);
  // Keep useful duplicate counter candidates in the pool; actual redundancy is a
  // score penalty and can be overcome when the live threat still warrants stacking.
  const buildRecommendations = recommendations;

  const visibleRecommendations = useMemo(() => {
    const [start, end] = phaseRanges[phase];
    const values = (entry: Recommendation) => buyTarget === "team" ? { rate: entry.teamRate, matches: entry.teamMatches, buyTime: entry.teamBuyTime, score: entry.teamScore } : { rate: entry.carryRate, matches: entry.carryMatches, buyTime: entry.carryBuyTime, score: entry.carryScore };
    const filtered = buildRecommendations.filter((entry) => { const value = values(entry); return value.buyTime >= start && value.buyTime <= end && value.matches >= minSample && (category === "all" || entry.item.item_slot_type === category) && (!maxBudget || (entry.item.cost ?? 0) <= maxBudget) && (!itemTier || entry.item.item_tier === itemTier) && (!positiveLiftOnly || value.rate > entry.baselineRate); });
    return filtered.sort((a, b) => { const av = values(a), bv = values(b); return sortMode === "buytime" ? av.buyTime - bv.buyTime : sortMode === "winrate" ? bv.rate - av.rate : sortMode === "sample" ? bv.matches - av.matches : sortMode === "cost" ? (a.item.cost ?? 0) - (b.item.cost ?? 0) : bv.score - av.score; }).slice(0, resultCount);
  }, [buildRecommendations, buyTarget, category, itemTier, maxBudget, minSample, phase, positiveLiftOnly, resultCount, sortMode]);

  const fullBuildPlan = useMemo(() => {
    const values = (entry: Recommendation) => buyTarget === "team" ? { rate: entry.teamRate, matches: entry.teamMatches, buyTime: entry.teamBuyTime, score: entry.teamScore } : { rate: entry.carryRate, matches: entry.carryMatches, buyTime: entry.carryBuyTime, score: entry.carryScore };
    // Build planning is independent of the user's presentation filters.
    const pool = buildRecommendations;
    const itemComponents = buildUpgradeGraph(items);
    const allowedIds = new Set(pool.map((entry) => entry.item.id));
    const planningCandidates: PlanCandidate[] = buildRecommendations.map((entry) => ({ itemId: entry.item.id, score: values(entry).score,
      buyTime: values(entry).buyTime || null, tier: entry.item.item_tier, cost: entry.item.cost, category: entry.item.item_slot_type,
      counterUrgency: entry.counterUrgency ?? 0, coreFit: entry.coreFit ?? 0,
      redundancyPenalty: hasCounterRoleOverlap(entry.item.class_name, ownedItemClasses) ? (entry.mechanicFit ?? 0) >= .7 ? .005 : .04 : 0,
      mechanicFit: entry.mechanicFit ?? 0, components: itemComponents.get(entry.item.id) ?? [], owned: allOwnedItemIds.includes(entry.item.id) }));
    const flow = bestFlowPath(itemFlow, 4);
    const flowSet = new Set(flow);
    const normalCoreNextId = flow.find((id) => !allOwnedItemIds.includes(id)) ?? null;
    const pathCandidates = planningCandidates.filter((entry) => allowedIds.has(entry.itemId));
    const own = desktopStatus?.in_game && desktopLiveMatch ? desktopLiveMatch.players.find((player) => player.account_id != null && player.account_id === desktopLiveMatch.account_id) : null;
    const liveSouls = own?.unspent_souls ?? null;
    const activePersonalProfile = personalHeroProfile?.heroId === heroId && personalHeroProfile.accountId === ownAccountId ? personalHeroProfile : null;
    const nextCore = pathCandidates.find(entry => entry.itemId === normalCoreNextId);
    const nearSpike = nextCore && liveSouls != null && nextCore.cost != null ? { itemId: nextCore.itemId, score: nextCore.coreFit, estimatedSoulsRemaining: Math.max(0,nextCore.cost-liveSouls), currentProgress: Math.max(0,Math.min(1,liveSouls/Math.max(1,nextCore.cost))), reason: "Core path item-flow timing" } : null;
    const nextBuyOrder = rankNextBuys(pathCandidates.map((entry) => { const deviation = buildDeviation({normalNextItemId:normalCoreNextId,candidateItemId:entry.itemId,delayedItems:entry.itemId===normalCoreNextId?[]:[normalCoreNextId??0].filter(Boolean),soulDelayCost:entry.itemId===normalCoreNextId?0:Math.min(.08,(entry.cost??0)/50000),flowTransitionPenalty:entry.itemId===normalCoreNextId||flowSet.has(entry.itemId)?0:.025,slotPressurePenalty:0,powerSpikeDelay:entry.itemId!==normalCoreNextId&&shouldPreservePowerSpike(nearSpike,entry.counterUrgency)? .08:0}); return { ...entry, pathSynergy: Math.max(flowSet.has(entry.itemId) ? 0.08 : 0, personalSequencePrior(activePersonalProfile, allOwnedItemIds, entry.itemId)), timingFit: entry.buyTime == null ? 0.5 : 1 / (1 + Math.abs(entry.buyTime - effectiveGameTimeSeconds) / 900), affordabilityUtility: entry.cost == null || liveSouls == null ? 0 : liveSouls >= entry.cost ? 1 : -Math.min(1, (entry.cost - liveSouls) / 5000), deviationCost: deviation.totalDeviationCost, opportunityCost: entry.cost != null && buildStyle === "safe" && entry.cost > 6400 ? 0.04 : 0 }; }));
    const nextBuyScores = new Map(nextBuyOrder.map((entry) => [entry.itemId, entry.nextBuyScore]));
    const pathIds = planPurchasePath(pathCandidates, itemFlow, 16);
    const priorityIds = [...new Set([...nextBuyOrder.slice(0, 1).map((entry) => entry.itemId), ...pathIds])].slice(0, 16);
    const purchaseOrder = priorityIds.flatMap((id) => { const entry = pool.find((candidate) => candidate.item.id === id); return entry ? [entry] : []; });
    const early = purchaseOrder.filter((entry) => values(entry).buyTime < 720 || (entry.item.item_tier ?? 0) === 1);
    const mid = purchaseOrder.filter((entry) => !early.includes(entry) && (values(entry).buyTime < 1260 || (entry.item.item_tier ?? 0) === 2));
    const late = purchaseOrder.filter((entry) => !early.includes(entry) && !mid.includes(entry));
    const entriesById = new Map(pool.map((entry) => [entry.item.id, entry]));
    // Final inventory includes confirmed manual ownership; future purchases do not.
    const decisions = findSellDecisions(planningCandidates, purchaseOrder.map((entry) => entry.item.id));
    const explicitlyReplaced = new Set(decisions.map((decision) => decision.sellId));
    const slots = optimizeSlots(pool.flatMap((entry) => entry.item.item_slot_type ? [{ id: entry.item.id, category: entry.item.item_slot_type, score: values(entry).score, components: itemComponents.get(entry.item.id) }] : []), 4, 4, allOwnedItemIds.filter((id) => !explicitlyReplaced.has(id)));
    const weapon = slots.fixed.filter((slot) => slot.category === "weapon").map((slot) => entriesById.get(slot.id)!).filter(Boolean);
    const vitality = slots.fixed.filter((slot) => slot.category === "vitality").map((slot) => entriesById.get(slot.id)!).filter(Boolean);
    const spirit = slots.fixed.filter((slot) => slot.category === "spirit").map((slot) => entriesById.get(slot.id)!).filter(Boolean);
    const flex = slots.flex.map((slot) => entriesById.get(slot.id)!).filter(Boolean);
    const sellSuggestions = decisions.flatMap((decision) => { const sell = pool.find((entry) => entry.item.id === decision.sellId); const replacement = pool.find((entry) => entry.item.id === decision.replacementId); return sell && replacement ? [{ sell, replacement, reason: decision.reason }] : []; }).slice(0, 3);
    const adaptiveCounters = purchaseOrder.filter((entry) => (entry.mechanicFit ?? 0) > 0 || (entry.counterFit ?? 0) >= 0.012).slice(0, 5);
    const adaptiveIds = new Set(adaptiveCounters.map((entry) => entry.item.id));
    const corePath = purchaseOrder.filter((entry) => !adaptiveIds.has(entry.item.id)).slice(0, 6);
    const situational = pool.filter((entry) => tagsForItem(entry.item.class_name).length > 0 && !(entry.mechanicFit ?? 0) && !tagMatchesManualThreat(entry.item.class_name, { ...threats, healing: threats.healing || lifestealDetected })).slice(0, 4);
    return { early, mid, late, weapon, vitality, spirit, flex, purchaseOrder, corePath, adaptiveCounters, situational, sellSuggestions, values,
      normalCoreNextId, nextBuyOrder: nextBuyOrder.map((entry) => ({ itemId: entry.itemId, nextBuyScore: entry.nextBuyScore, deviationCost: entry.deviationCost ?? 0 })), nextBuyScores };
  }, [allOwnedItemIds, buildRecommendations, buildStyle, buyTarget, desktopLiveMatch, desktopStatus?.in_game, effectiveGameTimeSeconds, heroId, itemFlow, items, lifestealDetected, ownAccountId, personalHeroProfile, threats]);

  useEffect(() => {
    if (!desktopAvailable() || !buildRecommendations.length || !heroId || !enemyIds.length) return;
    const nextBuyScores = new Map(fullBuildPlan.nextBuyOrder.map((entry) => [entry.itemId, entry.nextBuyScore]));
    void setAdvisorEvidence({ hero_id: heroId, enemy_ids: enemyIds, item_catalog: items.filter((item) => item.class_name && item.item_slot_type && item.cost != null).map((item) => ({ item_id: item.id, class_name: item.class_name! })), items: buildRecommendations.filter((entry) => entry.item.cost != null && !allOwnedItemIds.includes(entry.item.id)).map((entry) => ({
      item_id: entry.item.id, name: entry.item.name, cost: entry.item.cost!, score: nextBuyScores.get(entry.item.id) ?? entry.teamScore,
      reason: entry.advisorReason ?? "Weighted individual matchups and hero baseline.",
    })) });
  }, [buildRecommendations, heroId, enemyIds, allOwnedItemIds, fullBuildPlan, items]);

  useEffect(() => {
    const match = desktopLiveMatch;
    if (!desktopStatus?.in_game || !match?.match_id || !match.account_id || !match.game_time_s || !heroId || typeof window === "undefined") return;
    const ownPlayer = match.players.find(player => player.account_id === match.account_id);
    const enemyPlayers = match.players.filter(player => player.hero_id != null && ownPlayer?.team != null && player.team != null && player.team !== ownPlayer.team);
    const enemyThreats = scoreThreats(enemyPlayers.map(player=>({heroId:player.hero_id!,netWorth:player.net_worth,soulsPerMinute:player.souls_per_minute,kills:player.kills,deaths:player.deaths,assists:player.assists,statlockerPP:player.account_id==null?null:playerProfiles[player.account_id]?.ppScore??null})),match.game_time_s)
      .slice(0,5).map(threat=>({heroId:threat.heroId,weight:threat.weight,playerName:(enemyPlayers.find(player=>player.hero_id===threat.heroId)?.account_id==null?null:playerProfiles[enemyPlayers.find(player=>player.hero_id===threat.heroId)!.account_id!]?.name)??null}));
    const selected = fullBuildPlan.nextBuyOrder[0];
    const selectedRecommendation = selected ? buildRecommendations.find(entry=>entry.item.id===selected.itemId) : undefined;
    const reasonCodes = [
      ...(selectedRecommendation?.laneFit ? ["lane_matchup"] : []),
      ...(selectedRecommendation?.coreFit && selectedRecommendation.coreFit > .05 ? ["core_path"] : []),
      ...(selectedRecommendation?.mechanicFit && selectedRecommendation.mechanicFit > .2 ? ["counter_mechanics"] : []),
      ...(selectedRecommendation?.coveredEnemyIds && selectedRecommendation.coveredEnemyIds.length > 1 ? ["multi_enemy_coverage"] : []),
      ...(selected?.deviationCost != null && selected.deviationCost < .035 ? ["low_build_deviation"] : []),
    ];
    const laneEnemy = enemyPlayers.find(player=>player.hero_id===laneOpponentId);
    const choices = selected ? [{ itemId:selected.itemId,score:selected.nextBuyScore,reasonCodes,enemyThreats,phase:match.game_time_s<600?"early" as const:match.game_time_s<1200?"mid" as const:"late" as const,normalCoreItemId:fullBuildPlan.normalCoreNextId,laneState:match.game_time_s<600?laneState(ownPlayer?.net_worth??null,[laneEnemy?.net_worth??null]):"unknown" as const }] : [];
    if (choices.length) { const ownProfile=playerProfiles[match.account_id]; recordRecommendationSnapshot(match.account_id, match.match_id, heroId, match.game_time_s, choices, window.localStorage,{matchMode:match.match_mode_parsed,rankSnapshot:ownProfile?{estimatedRankNumber:ownProfile.estimatedRankNumber,ppScore:ownProfile.ppScore,playerName:ownProfile.name}:null}); }
  }, [buildRecommendations, desktopLiveMatch, desktopStatus?.in_game, fullBuildPlan.nextBuyOrder, fullBuildPlan.normalCoreNextId, heroId, laneOpponentId, playerProfiles]);

  useEffect(() => {
    const matchId = desktopLastMatch?.match_id;
    const accountId = desktopLastMatch?.account_id ?? savedSteamProfile?.account_id ?? null;
    if (!matchId || !accountId || desktopStatus?.in_game || typeof window === "undefined") return;
    const cache = recommendationOutcomeCache(accountId, window.localStorage);
    if (cache.completed[matchId] || !cache.pending[matchId]) return;
    let active = true;
    const retry = window.setTimeout(() => { if (active) setHistoryRevision(value => value + 1); }, 30_000);
    void fetch("/api/statlocker/matches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify([matchId]) })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: unknown) => {
        if (!active || !payload || typeof payload !== "object" || !Array.isArray((payload as Record<string, unknown>).matches)) return;
        const detail = (payload as { matches: unknown[] }).matches.find((entry) => entry && typeof entry === "object" && ((entry as Record<string, unknown>).matchId ?? (entry as Record<string, unknown>).match_id) === matchId);
        if (detail) {
          const wasComplete = Boolean(recommendationOutcomeCache(accountId, window.localStorage).completed[matchId]);
          if (completeRecommendationOutcome(accountId, detail, window.localStorage)) {
            setHistoryRevision(value => value + 1);
            if (!wasComplete) { setMatchCompleteNotice({ matchId, ready: true }); setUnseenReviewMatchId(matchId); }
          }
        }
      }).catch((error) => console.warn("Recommendation outcome sync is deferred; saved recommendations remain local.", error));
    return () => { active = false; window.clearTimeout(retry); };
  }, [desktopLastMatch?.match_id, desktopLastMatch?.account_id, desktopStatus?.in_game, savedSteamProfile?.account_id, historyRevision]);

  const counterPicks = useMemo<CounterPick[]>(() => {
    if (!allCounterStats.length || !enemyIds.length) return [];
    const statsMap = new Map(allCounterStats.map((stat) => [`${stat.hero_id}:${stat.enemy_hero_id}`, stat]));
    const heroBaselines = new Map<number, { wins: number; matches: number }>();
    allCounterStats.forEach((stat) => { const current = heroBaselines.get(stat.hero_id) ?? { wins: 0, matches: 0 }; current.wins += stat.wins; current.matches += stat.matches_played; heroBaselines.set(stat.hero_id, current); });
    return heroes.filter((hero) => !enemyIds.includes(hero.id)).map((hero) => {
      let weightedLift = 0, totalWeight = 0, matches = 0, coverage = 0, carryRate = .5;
      const baselineStat = heroBaselines.get(hero.id); const baseline = baselineStat ? (baselineStat.wins + 100) / (baselineStat.matches + 200) : .5;
      enemyIds.forEach((enemyId) => {
        const stat = statsMap.get(`${hero.id}:${enemyId}`);
        if (!stat) return;
        const rate = (stat.wins + 50) / (stat.matches_played + 100);
        const weight = enemyId === carryId ? 2 : 1;
        weightedLift += (rate - baseline) * weight; totalWeight += weight; matches += stat.matches_played; coverage += 1;
        if (enemyId === carryId) carryRate = rate;
      });
      if (!totalWeight) return null;
      const coverageFactor = .8 + .2 * (coverage / enemyIds.length);
      return { hero, score: Math.max(.35, Math.min(.65, .5 + (weightedLift / totalWeight) * coverageFactor)), carryRate, matches, coverage };
    }).filter((entry): entry is CounterPick => Boolean(entry)).sort((a, b) => b.score - a.score);
  }, [allCounterStats, carryId, enemyIds, heroes]);
  const liveAdviceForMatch = desktopAdvice?.match_id === desktopLiveMatch?.match_id ? desktopAdvice : null;
  const localLiveNextBuyId = fullBuildPlan.nextBuyOrder.find((entry) => !allOwnedItemIds.includes(entry.itemId))?.itemId;
  const normalCoreNext = recommendations.find((entry) => entry.item.id === fullBuildPlan.normalCoreNextId) ?? null;
  const nextBuy = desktopStatus?.in_game
    ? buildRecommendations.find((entry) => entry.item.id === liveAdviceForMatch?.recommended?.item_id && !allOwnedItemIds.includes(entry.item.id))
      ?? buildRecommendations.find((entry) => entry.item.id === localLiveNextBuyId && !allOwnedItemIds.includes(entry.item.id))
    : visibleRecommendations.find((entry) => !allOwnedItemIds.includes(entry.item.id));
  const liveAdvice = desktopStatus?.in_game ? liveAdviceForMatch?.recommended : null;
  const activeAlerts = [lifestealDetected ? t.lifestealDetected : null, threats.healing ? t.alertHealing : null, threats.weapon ? t.alertWeapon : null, threats.spirit ? t.alertSpirit : null, threats.crowdControl ? t.alertCrowdControl : null].filter((alert): alert is NonNullable<typeof alert> => alert !== null);
  const fullBuildCost = fullBuildPlan.purchaseOrder.reduce((sum, entry) => sum + (entry.item.cost ?? 0), 0);
  const remainingBuildCost = fullBuildPlan.purchaseOrder.filter((entry) => !allOwnedItemIds.includes(entry.item.id)).reduce((sum, entry) => sum + (entry.item.cost ?? 0), 0);
  const selectedEnemyInsight = selectedEnemySignal ? enemyBuildInsights.find((signal) => signal.heroId === selectedEnemySignal.heroId) : null;

  const filteredHeroes = useMemo(() => {
    const query = heroSearch.trim().toLocaleLowerCase(lang);
    return query ? heroes.filter((hero) => hero.name.toLocaleLowerCase(lang).includes(query)) : heroes;
  }, [heroSearch, heroes, lang]);

  const filteredEnemyHeroes = useMemo(() => {
    const query = enemySearch.trim().toLocaleLowerCase(lang);
    return query ? heroes.filter((hero) => hero.name.toLocaleLowerCase(lang).includes(query)) : heroes;
  }, [enemySearch, heroes, lang]);

  const filteredAllyHeroes = useMemo(() => {
    const query = allySearch.trim().toLocaleLowerCase(lang);
    return query ? heroes.filter((hero) => hero.name.toLocaleLowerCase(lang).includes(query)) : heroes;
  }, [allySearch, heroes, lang]);

  function removeEnemy(id: number) { const next = enemyIds.filter((enemyId) => enemyId !== id); setEnemyIds(next); if (carryId === id && next.length) setCarryId(next[0]); if (laneOpponentId === id && next.length) setLaneOpponentId(next[0]); }
  function openEnemyPicker() { setPendingEnemyIds(enemyIds); setEnemySearch(""); setEnemyPickerOpen(true); }
  function closeEnemyPicker() { setEnemyPickerOpen(false); setEnemySearch(""); setPendingEnemyIds([]); }
  function togglePendingEnemy(id: number) {
    if (id === heroId || allyIds.includes(id)) return;
    setPendingEnemyIds((current) => current.includes(id) ? current.filter((enemyId) => enemyId !== id) : current.length < 6 ? [...current, id] : current);
  }
  function applyEnemyTeam() {
    if (!pendingEnemyIds.length) return;
    setEnemyIds(pendingEnemyIds);
    if (!pendingEnemyIds.includes(carryId)) setCarryId(pendingEnemyIds[0]);
    if (!pendingEnemyIds.includes(laneOpponentId)) setLaneOpponentId(pendingEnemyIds[0]);
    closeEnemyPicker();
  }
  function openAllyPicker() { setPendingAllyIds(allyIds); setAllySearch(""); setAllyPickerOpen(true); }
  function closeAllyPicker() { setAllyPickerOpen(false); setAllySearch(""); setPendingAllyIds([]); }
  function togglePendingAlly(id: number) {
    if (id === heroId || enemyIds.includes(id)) return;
    setPendingAllyIds((current) => current.includes(id) ? current.filter((allyId) => allyId !== id) : current.length < 5 ? [...current, id] : current);
  }
  function applyAllies() { setAllyIds(pendingAllyIds); closeAllyPicker(); }
  function removeAlly(id: number) { setAllyIds((current) => current.filter((allyId) => allyId !== id)); }
  function openImporter(target: ImportTarget) { setImportTarget(target); setImporterOpen(true); }
  async function captureCurrentScoreboard() {
    setDesktopCaptureBusy(true);
    setDesktopCaptureError("");
    try {
      const bytes = await captureHud(desktopMonitors.length ? desktopMonitorIndex : undefined);
      if (!bytes.length) throw new Error("empty capture");
      const file = new File([new Uint8Array(bytes)], "counterlock-local-scoreboard.png", { type: "image/png" });
      openImporter("auto");
      await readScreenshot(file, "auto");
    } catch {
      setDesktopCaptureError("Could not capture the game screen. Check screenshot permission and keep the scoreboard visible.");
    } finally {
      setDesktopCaptureBusy(false);
    }
  }
  function cycleCaptureMonitor() {
    if (desktopMonitors.length < 2) return;
    const next = (desktopMonitorIndex + 1) % desktopMonitors.length;
    setDesktopMonitorIndex(next);
    window.localStorage.setItem("counterlock-capture-monitor", String(next));
  }
  function accountIdFromSteamInput(value: string) {
    const trimmed = value.trim();
    const profileNumber = trimmed.match(/steamcommunity\.com\/profiles\/(\d+)/i)?.[1];
    const numeric = profileNumber ?? (/^\d+$/.test(trimmed) ? trimmed : "");
    if (!numeric) return null;
    try {
      const parsed = BigInt(numeric);
      const maxAccountId = BigInt("4294967295");
      const accountId = parsed > maxAccountId ? parsed - BigInt("76561197960265728") : parsed;
      return accountId > BigInt(0) && accountId <= maxAccountId ? Number(accountId) : null;
    } catch { return null; }
  }
  function applyMatchRoster(players: ActiveMatchPlayer[], ownAccountId: number, meta: { duration_s?: number | null; start_time?: number | null; match_mode_parsed?: string | null }) {
    const ownPlayer = players.find((player) => player.account_id === ownAccountId);
    if (ownPlayer?.hero_id == null || ownPlayer.team == null) return false;
    const allies = players.filter((player) => player.team === ownPlayer.team && player.account_id !== ownAccountId && player.hero_id).map((player) => player.hero_id!).slice(0, 5);
    const enemies = players.filter((player) => player.team !== ownPlayer.team && player.hero_id).map((player) => player.hero_id!).slice(0, 6);
    if (!enemies.length) return false;
    const assignments: Record<number, Exclude<Lane, "all">> = {};
    const assignByPosition = (ids: number[]) => ids.forEach((id, index) => { assignments[id] = index < 2 ? "yellow" : index < 4 ? "blue" : "green"; });
    assignByPosition([ownPlayer.hero_id, ...allies]); assignByPosition(enemies);
    setHeroId(ownPlayer.hero_id); setAllyIds(allies); setEnemyIds(enemies); setCarryId(enemies[0]); setLaneOpponentId(enemies[0]); setLaneAssignments(assignments);
    setLane(assignments[ownPlayer.hero_id] ?? "yellow"); setLaneOnly(true); setBuyTarget("team");
    const elapsed = meta.duration_s ?? (meta.start_time ? Math.floor(Date.now() / 1000) - meta.start_time : 0);
    if (elapsed > 0) setGameMinute(Math.max(1, Math.min(40, Math.round(elapsed / 60))));
    if (meta.match_mode_parsed?.toLowerCase().includes("ranked")) setQueueMode("ranked");
    else if (meta.match_mode_parsed?.toLowerCase().includes("unranked")) setQueueMode("unranked");
    return true;
  }
  async function importCompanionRoster() {
    const response = await fetch("http://127.0.0.1:9876/v1/roster", { cache: "no-store" });
    if (!response.ok) throw new Error("roster unavailable");
    const roster = await response.json() as CompanionRoster;
    if (!roster.account_id || !roster.players?.length) throw new Error("roster incomplete");
    if (!applyMatchRoster(roster.players, roster.account_id, roster)) throw new Error("roster incomplete");
    setImportedMatchId(roster.match_id); setLiveImportMessage(t.rosterCaptured);
    return roster.match_id;
  }
  async function importLiveMatch(profile: SteamProfile) {
    setLiveImportBusy(true); setSteamCandidates([]); setLiveImportMessage(""); setImportedMatchId(null);
    window.localStorage.setItem("counterlock-steam-profile", JSON.stringify(profile));
    setSavedSteamProfile(profile); setSteamQuery(profile.personaname);
    try {
      const response = await fetch(`${API}/matches/active?account_ids=${profile.account_id}`);
      if (!response.ok) throw new Error("active-match lookup failed");
      const matches = await response.json() as ActiveMatch[];
      const match = matches.find((entry) => entry.players.some((player) => player.account_id === profile.account_id));
      if (!match || !applyMatchRoster(match.players, profile.account_id, match)) { setLiveImportMessage(t.liveMatchMissing); return; }
      setImportedMatchId(match.match_id); setLiveImportMessage(t.lanesEstimated);
    } catch { setLiveImportMessage(t.liveImportError); }
    finally { setLiveImportBusy(false); }
  }
  async function findLiveMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = steamQuery.trim(); if (!query) return;
    setLiveImportBusy(true); setSteamCandidates([]); setLiveImportMessage(""); setImportedMatchId(null);
    try {
      const directId = accountIdFromSteamInput(query);
      if (directId) {
        const profile: SteamProfile = savedSteamProfile?.account_id === directId ? savedSteamProfile : { account_id: directId, personaname: `Steam ${directId}`, profileurl: "", avatar: "" };
        await importLiveMatch(profile); return;
      }
      const vanityName = query.match(/steamcommunity\.com\/id\/([^/?#]+)/i)?.[1];
      if (vanityName) {
        if (window.location.hostname.endsWith("github.io")) { setLiveImportMessage(t.steamProfileLinkUnsupported); return; }
        const resolver = new URL("api/steam-resolve", window.location.href);
        resolver.searchParams.set("url", query);
        const resolved = await fetch(resolver);
        if (resolved.ok) { await importLiveMatch(await resolved.json() as SteamProfile); return; }
      }
      const searchQuery = decodeURIComponent(vanityName ?? query);
      const response = await fetch(`${API}/players/steam-search?search_query=${encodeURIComponent(searchQuery)}&limit=5&min_matches_played_last_30d=0`);
      if (!response.ok) { setLiveImportMessage(t.steamProfileMissing); return; }
      const profiles = await response.json() as SteamProfile[];
      const exact = profiles.find((profile) => normalizeText(profile.personaname) === normalizeText(searchQuery) || profile.profileurl.replace(/\/$/, "") === query.replace(/\/$/, ""));
      if (exact || profiles.length === 1) { await importLiveMatch(exact ?? profiles[0]); return; }
      if (!profiles.length) setLiveImportMessage(t.steamProfileMissing);
      else setSteamCandidates(profiles);
    } catch { setLiveImportMessage(t.liveImportError); }
    finally { setLiveImportBusy(false); }
  }
  function forgetSteamProfile() { window.localStorage.removeItem("counterlock-steam-profile"); setSavedSteamProfile(null); setSteamQuery(""); setSteamCandidates([]); setLiveImportMessage(""); setImportedMatchId(null); }
  function toggleLiveImport() { if (liveImportOpen) { setLiveImportOpen(false); return; } setLiveImportOpen(true); if (savedSteamProfile) void importLiveMatch(savedSteamProfile); }
  async function showLatestPatch() {
    setPatchOpen(true); setPatchError(false);
    if (patchNote || patchBusy) return;
    setPatchBusy(true);
    try {
      const response = await fetch(`${API}/patches`);
      if (!response.ok) throw new Error("patch lookup failed");
      const patches = await response.json() as PatchNote[];
      if (!patches[0]) throw new Error("no patches");
      setPatchNote(patches[0]);
    } catch { setPatchError(true); }
    finally { setPatchBusy(false); }
  }
  function saveSetup() {
    window.localStorage.setItem("counterlock-match-setup", JSON.stringify({ buildStyle, matchState, threats, souls, ownedItemIds }));
    setPresetMessage(t.presetSaved);
  }
  function loadSetup() {
    try {
      const saved = window.localStorage.getItem("counterlock-match-setup");
      if (!saved) { setPresetMessage(t.presetMissing); return; }
      const setup = JSON.parse(saved) as { buildStyle?: BuildStyle; matchState?: "ahead" | "even" | "behind"; threats?: typeof threats; souls?: number; ownedItemIds?: number[] };
      if (setup.buildStyle) setBuildStyle(setup.buildStyle); if (setup.matchState) setMatchState(setup.matchState); if (setup.threats) setThreats(setup.threats); if (typeof setup.souls === "number") setSouls(setup.souls); if (setup.ownedItemIds) setOwnedItemIds(setup.ownedItemIds); setSortMode("recommended"); setPresetMessage(t.presetSaved);
    } catch { setPresetMessage(t.presetMissing); }
  }
  function toggleOwnedItem(id: number) { setOwnedItemIds((current) => current.includes(id) ? current.filter((itemId) => itemId !== id) : [...current, id].slice(-16)); }
  function selectLane(value: Lane) { setLane(value); setLaneOnly(value !== "all"); }
  function autoAssignLanes() {
    const next: Record<number, Exclude<Lane, "all">> = {};
    const assign = (ids: number[]) => ids.forEach((id, index) => { next[id] = index < 2 ? "yellow" : index < 4 ? "blue" : "green"; });
    assign(allyTeamIds); assign(enemyIds); setLaneAssignments(next);
  }
  function updateHeroLane(id: number, value: Exclude<Lane, "all">) { setLaneAssignments((current) => ({ ...current, [id]: value })); }
  function startHeroDrag(event: DragEvent<HTMLElement>, id: number) { setDraggedHeroId(id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(id)); }
  function finishHeroDrag() { setDraggedHeroId(null); setDragOverLane(null); }
  function dropHero(event: DragEvent<HTMLElement>, value: Exclude<Lane, "all">) { event.preventDefault(); const id = Number(event.dataTransfer.getData("text/plain") || draggedHeroId); if (allMatchHeroIds.includes(id)) updateHeroLane(id, value); finishHeroDrag(); }
  function moveHeroByKey(event: KeyboardEvent<HTMLElement>, id: number) { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const lanes = ["yellow", "blue", "green"] as const; const assigned = laneAssignments[id]; const current = lanes.indexOf(assigned === "purple" ? "yellow" : assigned ?? "yellow"); const offset = event.key === "ArrowRight" ? 1 : -1; updateHeroLane(id, lanes[(current + offset + lanes.length) % lanes.length]); }
  async function readScreenshot(file: File, target: ImportTarget = importTarget) {
    if (!file.type.startsWith("image/")) return;
    if (screenshotUrl) URL.revokeObjectURL(screenshotUrl);
    setScreenshotUrl(URL.createObjectURL(file)); setOcrRunning(true); setOcrComplete(false); setOcrProgress(0); setDetections([]); setSelectedDetections([]);
    let worker: Awaited<ReturnType<typeof import("tesseract.js")["createWorker"]>> | null = null;
    try {
      const { createWorker, PSM } = await import("tesseract.js");
      worker = await createWorker("eng", 1, { logger: (message) => { if (message.status === "recognizing text") setOcrProgress(Math.round(message.progress * 100)); } });
      const excluded = target === "ally" ? [heroId, ...enemyIds] : target === "enemy" ? [heroId, ...allyIds] : [];
      const limit = target === "auto" ? 12 : target === "ally" ? 5 : 6;
      const sheet = await createScoreboardSheet(file);
      let found: Detection[] = [];
      if (sheet) {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        const result = await worker.recognize(sheet.canvas, {}, { blocks: true });
        const words = (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.flatMap((line) => line.words as OcrWord[])));
        found = detectScoreboardRows(words, heroes, sheet.rowHeight);
      }
      if (found.length < 8) {
        await worker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
        const result = await worker.recognize(file, {}, { blocks: true });
        const lines = (result.data.blocks ?? []).flatMap((block) => block.paragraphs.flatMap((paragraph) => paragraph.lines.map((line) => line.words as OcrWord[])));
        const positioned = attachPlayerNames(classifyScoreboard(detectPositionedHeroes(lines, heroes), heroId), lines.flat(), heroes);
        const fallback = positioned.length >= 2 ? positioned : detectHeroNames(result.data.text, heroes, excluded);
        const existing = new Set(found.map((entry) => entry.id)); found = [...found, ...fallback.filter((entry) => !existing.has(entry.id))];
      }
      found = markRememberedPlayer(found.filter((entry) => !excluded.includes(entry.id)).slice(0, limit));
      setDetections(found); setSelectedDetections(found.slice(0, limit).map((entry) => entry.id)); setOcrComplete(true);
    } catch { setDetections([]); setOcrComplete(true); }
    finally { if (worker) await worker.terminate(); setOcrRunning(false); }
  }
  function closeImporter() { if (screenshotUrl) URL.revokeObjectURL(screenshotUrl); setScreenshotUrl(""); setImporterOpen(false); setDetections([]); setSelectedDetections([]); setOcrComplete(false); }
  function importDetectedHeroes() {
    const ids = selectedDetections.filter((id) => id !== heroId).slice(0, importTarget === "auto" ? 12 : importTarget === "ally" ? 5 : 6);
    if (!ids.length) return;
    if (importTarget === "auto") {
      const selected = detections.filter((entry) => selectedDetections.includes(entry.id));
      const detectedOwn = selected.find((entry) => entry.isOwn) ?? selected.find((entry) => entry.id === heroId);
      const detectedHeroId = detectedOwn?.id ?? heroId;
      const allies = selected.filter((entry) => entry.side === "ally" && entry.id !== detectedHeroId).map((entry) => entry.id).slice(0, 5);
      const enemies = selected.filter((entry) => entry.side === "enemy").map((entry) => entry.id).slice(0, 6);
      if (detectedOwn) { setHeroId(detectedHeroId); if (detectedOwn.playerName) window.localStorage.setItem("counterbuild-player-name", normalizeText(detectedOwn.playerName)); }
      if (allies.length) setAllyIds(allies);
      if (enemies.length) { setEnemyIds(enemies); if (!enemies.includes(carryId)) setCarryId(enemies[0]); }
      if (desktopAvailable() && desktopStatus?.in_game && detectedOwn && enemies.length) {
        void submitLocalRoster({ own_hero_id: detectedHeroId, ally_hero_ids: allies, enemy_hero_ids: enemies })
          .catch((error) => setDesktopCaptureError(String(error)));
      }
      const detectedAssignments: Record<number, Exclude<Lane, "all">> = {}; selected.forEach((entry) => { if (entry.lane) detectedAssignments[entry.id] = entry.lane; }); if (Object.keys(detectedAssignments).length) setLaneAssignments(detectedAssignments);
      const ownDetection = detectedOwn; const detectedLane = ownDetection?.lane;
      if (detectedLane) { selectLane(detectedLane); const opponent = selected.find((entry) => entry.side === "enemy" && entry.lane === detectedLane); if (opponent) setLaneOpponentId(opponent.id); }
    }
    else if (importTarget === "ally") setAllyIds(ids);
    else { setEnemyIds(ids); if (!ids.includes(carryId)) setCarryId(ids[0]); if (!ids.includes(laneOpponentId)) setLaneOpponentId(ids[0]); }
    closeImporter();
  }

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => { if (desktopAvailable()) return; const file = Array.from(event.clipboardData?.items ?? []).find((entry) => entry.kind === "file" && entry.type.startsWith("image/"))?.getAsFile() ?? Array.from(event.clipboardData?.files ?? []).find((entry) => entry.type.startsWith("image/")); if (!file) return; event.preventDefault(); setImportTarget("auto"); setImporterOpen(true); void readScreenshot(file, "auto"); };
    window.addEventListener("paste", handlePaste); return () => window.removeEventListener("paste", handlePaste);
  });
  async function copyTopBuild() {
    const text = `${ownHero?.name ?? "Hero"} vs ${carryHero?.name ?? "Carry"}: ${visibleRecommendations.slice(0, 5).map((entry, index) => `${index + 1}. ${entry.item.name}`).join(" · ")}`;
    try { await navigator.clipboard.writeText(text); setCopied(true); window.setTimeout(() => setCopied(false), 2200); } catch { setCopied(false); }
  }
  async function shareMatchup() {
    const params = new URLSearchParams({ hero: String(heroId), allies: allyIds.join(","), enemies: enemyIds.join(","), carry: String(carryId), minute: String(gameMinute), queue: queueMode, window: String(dataWindow), target: buyTarget, lane, laneOpponent: String(laneOpponentId) });
    const url = `${window.location.origin}${window.location.pathname}?${params}`;
    try { await navigator.clipboard.writeText(url); window.history.replaceState(null, "", url); setLinkCopied(true); window.setTimeout(() => setLinkCopied(false), 2200); } catch { setLinkCopied(false); }
  }
  function chooseOwnHero(id: number) {
    const nextEnemies = enemyIds.filter((enemyId) => enemyId !== id);
    const nextAllies = allyIds.filter((allyId) => allyId !== id);
    setHeroId(id);
    if (nextEnemies.length !== enemyIds.length) setEnemyIds(nextEnemies);
    if (nextAllies.length !== allyIds.length) setAllyIds(nextAllies);
    if (carryId === id && nextEnemies.length) setCarryId(nextEnemies[0]);
    setHeroPickerOpen(false); setHeroSearch("");
  }
  function selectCounterPick(id: number) {
    chooseOwnHero(id);
    document.getElementById("top")?.scrollIntoView({ behavior: "smooth" });
  }

  const matchupWinRate = matchup ? matchup.wins / matchup.matches_played : null;
  const laneWinRates = useMemo(() => {
    const stats = new Map(laneCounterStats.map((entry) => [`${entry.hero_id}:${entry.enemy_hero_id}`, entry]));
    return Object.fromEntries((["yellow", "blue", "green"] as const).map((laneKey) => {
      const allies = allyTeamIds.filter((id) => laneAssignments[id] === laneKey);
      const enemies = enemyIds.filter((id) => laneAssignments[id] === laneKey);
      const matchups = allies.flatMap((allyId) => enemies.map((enemyId) => stats.get(`${allyId}:${enemyId}`))).filter((entry): entry is CounterStat => Boolean(entry?.matches_played));
      const totalWeight = matchups.reduce((sum, entry) => sum + Math.sqrt(entry.matches_played), 0);
      const rate = totalWeight ? matchups.reduce((sum, entry) => sum + ((entry.wins + 40) / (entry.matches_played + 80)) * Math.sqrt(entry.matches_played), 0) / totalWeight : null;
      return [laneKey, rate];
    })) as Record<"yellow" | "blue" | "green", number | null>;
  }, [allyTeamIds, enemyIds, laneAssignments, laneCounterStats]);
  const localOutcomeCache = typeof window !== "undefined" && ownAccountId ? recommendationOutcomeCache(ownAccountId, window.localStorage) : { pending: {}, completed: {} };
  const completedOutcomes = Object.values(localOutcomeCache.completed);
  const heroNameMap = useMemo(() => new Map(heroes.map(hero => [hero.id, hero.name])), [heroes]);
  const itemNameMap = useMemo(() => new Map(items.map(item => [item.id, item.name])), [items]);
  const itemCategoryMap = useMemo(() => new Map(items.flatMap(item => item.item_slot_type ? [[item.id, item.item_slot_type] as const] : [])), [items]);
  const heroImageMap = useMemo(() => new Map(heroes.flatMap(hero => hero.images?.icon_hero_card_webp ? [[hero.id, hero.images.icon_hero_card_webp] as const] : [])), [heroes]);
  const itemImageMap = useMemo(() => new Map(items.flatMap(item => item.shop_image_webp ? [[item.id, item.shop_image_webp] as const] : [])), [items]);
  return (
    <main className={desktopStatus ? "desktop-shell" : undefined}>
      {desktopStatus && <aside className="desktop-sidebar"><a className="desktop-brand" href="#top"><span>CL</span><b>COUNTERLOCK</b></a><nav aria-label="Desktop navigation">{(["match", "build", "review", "history", "system"] as const).map((tab) => <button key={tab} type="button" className={desktopTab === tab ? "active" : ""} aria-current={desktopTab === tab ? "page" : undefined} onClick={() => { setDesktopTab(tab); if (tab === "review") setUnseenReviewMatchId(null); }}><i>{tab === "match" ? "◉" : tab === "build" ? "◇" : tab === "review" ? "▤" : tab === "history" ? "◷" : "⚙"}</i>{tab === "match" ? "Current Match" : tab === "build" ? "Build Lab" : tab === "review" ? "Match Review" : tab === "history" ? "My Matches" : "Settings"}{tab === "review" && unseenReviewMatchId ? <b className="nav-new">NEW</b> : null}</button>)}</nav><div className="desktop-sidebar-status"><b>DEADLOCK</b><span><i />{desktopStatus.game_running ? "Connected" : "Waiting"}</span><small>v0.1.6</small></div></aside>}
      <div className={desktopStatus ? "desktop-workspace" : undefined}>
      <header className={desktopStatus ? "desktop-topbar" : "site-header"}>
        {!desktopStatus && <a className="brand" href="#top" aria-label={t.home}><span className="brand-mark">CL</span><span><strong>COUNTER</strong>LOCK</span></a>}
        {desktopStatus && <div className={`desktop-context-title ${desktopTab === "review" || desktopTab === "history" ? "report-context" : ""}`}><small>{desktopTab === "review" ? "MATCH REVIEW" : desktopTab === "history" ? "PERSONAL HISTORY" : desktopStatus.in_game ? "LIVE MATCH" : "DEADLOCK COMPANION"}</small><strong>{desktopTab === "review" ? "Completed match report" : desktopTab === "history" ? "My matches" : desktopStatus.in_game && desktopLiveMatch?.game_time_s != null ? `${Math.floor(desktopLiveMatch.game_time_s / 60)}:${String(desktopLiveMatch.game_time_s % 60).padStart(2, "0")}` : desktopStatus.game_running ? "Waiting for match" : "Ready"}</strong></div>}
        <div className="header-actions">
          {!desktopStatus && <div className={`live-pill companion-${companionStatus}`}><span /> {companionStatus === "connected" ? t.companionConnected : companionStatus === "waiting" ? t.companionSearching : t.companionUnavailable}</div>}
          {!desktopStatus && <button className="header-button patch-button" type="button" onClick={() => void showLatestPatch()}>{t.latestPatch}</button>}
          {!desktopStatus && <button className="header-button theme-toggle" type="button" onClick={() => setDarkMode((current) => !current)} aria-pressed={darkMode}>{darkMode ? `☾ ${t.darkMode}` : `☀ ${t.lightMode}`}</button>}
          <div className="language-toggle" aria-label="Language / Sprache" style={desktopStatus ? { display: "none" } : undefined}>
            <button className={lang === "en" ? "active" : ""} onClick={() => setLang("en")}>EN</button>
            <button className={lang === "de" ? "active" : ""} onClick={() => setLang("de")}>DE</button>
          </div>
        </div>
      </header>
      {desktopStatus && matchCompleteNotice && <aside className="match-complete-toast" role="status" aria-live="polite"><span className="toast-mark">✓</span><div><strong>MATCH COMPLETE</strong><small>{matchCompleteNotice.ready ? "Analysis available" : "Analysis pending"}</small></div><button type="button" onClick={() => { setDesktopTab("review"); setUnseenReviewMatchId(null); setMatchCompleteNotice(null); }}>{matchCompleteNotice.ready ? "VIEW REVIEW" : "VIEW STATUS"}</button><button className="toast-dismiss" type="button" aria-label="Dismiss match complete notice" onClick={() => setMatchCompleteNotice(null)}>×</button></aside>}
      {patchOpen && !desktopStatus && <aside className="patch-panel" aria-live="polite"><button type="button" className="patch-close" onClick={() => setPatchOpen(false)} aria-label="Close">×</button><small>{t.latestPatch}</small>{patchBusy && <strong>{t.loadingPatch}</strong>}{patchError && <strong>{t.patchUnavailable}</strong>}{patchNote && <><strong>{patchNote.title}</strong><time>{new Date(patchNote.pub_date).toLocaleDateString(lang === "de" ? "de-DE" : "en-US", { year: "numeric", month: "long", day: "numeric" })}</time><a href={patchNote.link} target="_blank" rel="noreferrer">{t.openPatch} →</a></>}</aside>}

      {desktopStatus && desktopTab === "match" && <DesktopLivePanel status={desktopStatus} match={desktopLiveMatch} heroes={heroMap} profiles={playerProfiles} advice={desktopAdvice} recommendations={buildRecommendations} laneOpponentId={laneOpponentId} laneName={lane === "all" ? "unknown" : lane} onOpenBuild={() => setDesktopTab("build")} />}
      {desktopStatus && desktopTab === "build" && <DesktopBuildLab status={desktopStatus} match={desktopLiveMatch} heroes={heroMap} items={items} profiles={playerProfiles} lang={lang} plan={fullBuildPlan} cost={fullBuildCost} remainingCost={remainingBuildCost} ownedItemIds={allOwnedItemIds} liveOwnedItemIds={desktopOwnedItemIds} onToggleOwned={toggleOwnedItem} onSave={saveSetup} onLoad={loadSetup} presetMessage={presetMessage} buyTarget={buyTarget} advice={liveAdviceForMatch} recommendations={buildRecommendations} />}
      {desktopStatus && (desktopTab === "review" || desktopTab === "history") && <MatchHistory key={desktopTab} outcomes={completedOutcomes} pendingMatches={Object.entries(localOutcomeCache.pending).map(([matchId, value]) => ({ matchId: Number(matchId), ...value }))} heroNames={heroNameMap} itemNames={itemNameMap} itemCategories={itemCategoryMap} heroImages={heroImageMap} itemImages={itemImageMap} initialReview={desktopTab === "review"} />}
      {desktopStatus && desktopTab === "system" && <section className="desktop-system-page" aria-label="System diagnostics"><div className="desktop-system-heading"><small>COUNTERLOCK / SYSTEM</small><h1>System & diagnostics</h1><p>Runtime details and local desktop preferences.</p></div><div className="desktop-system-grid">
        <article><h2>Game connection</h2><dl><div><dt>Deadlock</dt><dd>{desktopStatus.game_running ? "Running" : "Not running"}</dd></div><div><dt>Process ID</dt><dd>{desktopStatus.pid ?? "—"}</dd></div><div><dt>Steam build</dt><dd>{desktopStatus.build_id ?? "Unknown"}</dd></div><div><dt>Live source</dt><dd>{desktopStatus.provider}</dd></div><div><dt>Console phase</dt><dd>{desktopStatus.console_phase ?? "No verified event"}</dd></div><div><dt>Match ID</dt><dd>{desktopStatus.match_id ?? "Unavailable"}</dd></div><div><dt>Inventory</dt><dd>{desktopStatus.capabilities.items ? "Available" : "Not available"}</dd></div><div><dt>Install path</dt><dd>{desktopStatus.installation_path ?? "Not detected"}</dd></div></dl>{desktopStatus.last_error && <p className="desktop-system-error">{desktopStatus.last_error}</p>}{desktopLastMatch && <p className="desktop-system-note">Last match: {desktopLastMatch.match_id ?? "ID unknown"} · {desktopLastMatch.source}</p>}</article>
        <article><h2>Desktop settings</h2><label><input type="checkbox" checked={desktopPreferences?.close_to_tray ?? true} onChange={(event) => void updateDesktopPreferences({ close_to_tray: event.target.checked })} />{lang === "de" ? "Beim Schließen im Tray weiterlaufen" : "Keep running in tray when closing"}</label><label><input type="checkbox" checked={desktopPreferences?.compact_always_on_top ?? true} onChange={(event) => void updateDesktopPreferences({ compact_always_on_top: event.target.checked })} />{lang === "de" ? "Kompaktfenster immer im Vordergrund" : "Keep compact window always on top"}</label><p>Game memory is read locally. Screenshots and unspent shop balance are separate capabilities.</p><hr /><h2>{lang === "de" ? "Software-Updates" : "Software updates"}</h2><button type="button" disabled={updateBusy} onClick={() => void checkDesktopUpdates()}>{updateBusy ? (lang === "de" ? "BITTE WARTEN …" : "PLEASE WAIT…") : (lang === "de" ? "NACH UPDATES SUCHEN" : "CHECK FOR UPDATES")}</button>{updateStatus && <p role="status">{updateStatus}</p>}</article>
      </div></section>}
      {!desktopStatus && <section className="hero-section" id="top">
        <div className="eyebrow">{t.heroKicker}</div>
        <h1>{t.heroTitleA}<br /><em>{t.heroTitleB}</em></h1>
        <p>{t.heroText}</p>
      </section>}

      <div className="desktop-build-content" style={{ display: desktopStatus ? "none" : undefined }}>
      <section className="match-import-bar"><div><span>▣</span><p><strong>{t.matchImport}</strong><small>{desktopAvailable() ? (desktopStatus?.provider === "attached" ? "Reading your current match from Deadlock memory. Scoreboard capture is optional." : "Waiting for a verified memory profile or local match event. Scoreboard capture is optional.") : t.matchImportText}</small>{desktopCaptureError && <small role="alert">{desktopCaptureError}</small>}</p></div><div className="match-import-actions"><button className="screenshot-primary" type="button" onClick={() => openImporter("auto")}>{t.screenshotImport} <b>CTRL+V</b></button>{desktopAvailable() ? <>{desktopMonitors.length > 1 && <button className="live-match-secondary" type="button" title={desktopMonitors[desktopMonitorIndex] ? `${desktopMonitors[desktopMonitorIndex].name} · ${desktopMonitors[desktopMonitorIndex].width}×${desktopMonitors[desktopMonitorIndex].height}` : "Choose display"} onClick={cycleCaptureMonitor}>SCREEN {desktopMonitorIndex + 1}/{desktopMonitors.length}</button>}<button className="live-match-secondary" type="button" disabled={desktopCaptureBusy} onClick={() => void captureCurrentScoreboard()}>{desktopCaptureBusy ? "CAPTURING…" : "CAPTURE GAME SCREEN"} →</button></> : <button className="live-match-secondary" type="button" onClick={toggleLiveImport}>{t.liveImport} →</button>}</div></section>

      {liveImportOpen && <section className="live-import-panel" aria-labelledby="live-import-title">
        <button className="live-import-close" type="button" onClick={() => setLiveImportOpen(false)} aria-label={t.closeLiveImport}>×</button>
        <div className="live-import-copy"><div className="eyebrow">STEAM · ACTIVE MATCH</div><h2 id="live-import-title">{t.liveImportTitle}</h2><p>{t.liveImportText}</p></div>
        <form className="live-import-form" onSubmit={findLiveMatch}>
          <label><span>STEAM</span><input value={steamQuery} onChange={(event) => setSteamQuery(event.target.value)} placeholder={t.steamPlaceholder} autoComplete="off" /></label>
          <button type="submit" disabled={liveImportBusy || !steamQuery.trim()}>{liveImportBusy ? t.searchingPlayer : `${t.findPlayer} →`}</button>
        </form>
        {savedSteamProfile && <div className="saved-steam-profile">{savedSteamProfile.avatar ? <img src={savedSteamProfile.avatar} alt="" /> : <i className="steam-avatar-fallback">S</i>}<span><small>{t.savedProfile}</small><strong>{savedSteamProfile.personaname}</strong></span><button type="button" onClick={() => void importLiveMatch(savedSteamProfile)} disabled={liveImportBusy}>{t.liveImport}</button><button type="button" onClick={forgetSteamProfile}>{t.forgetProfile}</button></div>}
        {steamCandidates.length > 0 && <div className="steam-candidates"><small>{t.chooseSteamProfile}</small>{steamCandidates.map((profile) => <button type="button" key={profile.account_id} onClick={() => void importLiveMatch(profile)}>{profile.avatar ? <img src={profile.avatar} alt="" /> : <i className="steam-avatar-fallback">S</i>}<span><strong>{profile.personaname}</strong><small>{profile.account_id}</small></span><b>{t.useProfile} →</b></button>)}</div>}
        {liveImportMessage && <div className={`live-import-message ${importedMatchId ? "success" : "warning"}`}><span>{importedMatchId ? "✓" : "!"}</span><p>{importedMatchId && <strong>{t.liveMatchFound} · {t.liveMatchId} {importedMatchId}</strong>}<small>{liveImportMessage}</small></p>{!importedMatchId && <button type="button" onClick={() => openImporter("auto")}>{t.screenshotImport} →</button>}</div>}
      </section>}

      <div className="analyzer">
        <div className="step-block">
          <div className="step-label"><span>01</span> {t.yourHero}</div>
          <button className="selected-hero-button" type="button" onClick={() => setHeroPickerOpen(true)} aria-haspopup="dialog"><HeroPortrait hero={ownHero} /><span><small>{t.youPlay}</small><strong>{ownHero?.name ?? "—"}</strong><i>{t.changeHero}</i></span><b>⌄</b></button>
        </div>
        <div className="step-block ally-block">
          <div className="step-label"><span>02</span> {t.yourTeam} <b>{allyIds.length + 1}/6</b></div>
          <div className="ally-squad"><div className="ally-chip own"><HeroPortrait hero={ownHero} size="small" /><span><small>{t.ownPick}</small><strong>{ownHero?.name}</strong></span></div>{allyIds.map((id) => { const hero = heroMap.get(id); return <div className="ally-chip" key={id}><HeroPortrait hero={hero} size="small" /><span><small>{t.allyPick}</small><strong>{hero?.name}</strong></span><button type="button" onClick={() => removeAlly(id)} aria-label={`${t.remove} ${hero?.name}`}>×</button></div>; })}{allyIds.length < 5 && <button className="ally-empty" type="button" onClick={openAllyPicker}>＋</button>}</div>
          <div className="ally-tools single"><button type="button" onClick={openAllyPicker}><span>▦</span>{t.buildOwnTeam}</button></div>
        </div>
        <div className="step-block enemy-block">
          <div className="step-label"><span>03</span> {t.enemyTeam} <b>{enemyIds.length}/6</b></div>
          <div className="enemy-squad">{enemyIds.map((id, index) => { const hero = heroMap.get(id); const isCarry = id === carryId; return <article className={`enemy-squad-card ${isCarry ? "is-carry" : ""}`} key={id}>
            <button className="enemy-focus-button" type="button" onClick={() => setCarryId(id)}><HeroPortrait hero={hero} size="small" /><span><small>{isCarry ? t.enemyCarry : `ENEMY 0${index + 1}`}</small><strong>{hero?.name}</strong></span><i>{isCarry ? "★" : "○"}</i></button>
            <button className="enemy-remove-card" type="button" onClick={() => removeEnemy(id)} aria-label={`${t.remove} ${hero?.name}`}>×</button>
          </article>; })}{enemyIds.length < 6 && <button className="empty-enemy-slot" type="button" onClick={openEnemyPicker}><span>＋</span><b>{t.addEnemy}</b></button>}</div>
          <p className="carry-hint"><span>★</span> {t.carryHint}</p>
          <div className="enemy-tools single"><button className="manage-enemy-button" type="button" onClick={openEnemyPicker} aria-label={t.openEnemyPicker}><span>▦</span> {t.buildEnemyTeam}</button></div>
        </div>
        <div className="step-block carry-block">
          <div className="step-label"><span>04</span> {t.focusTarget}</div>
          <div className="carry-card"><HeroPortrait hero={carryHero} /><div><small>{t.enemyCarry}</small><strong>{carryHero?.name ?? "–"}</strong></div>{matchupWinRate !== null && <div className="threat"><small>{t.matchupWr}</small><strong>{pct(matchupWinRate)}</strong></div>}</div>
          <div className={`auto-update-status ${loading ? "updating" : ""}`}><span /><div><strong>{loading ? t.autoUpdating : t.autoLive}</strong><small>{t.autoHint}</small></div></div>
        </div>
      </div>

      <section className="lane-board">
        <div className="lane-board-head"><div><div className="eyebrow">05 · {t.laneSetup} · {allMatchHeroIds.length}/12</div><h2>{t.laneBoard}</h2><p>{t.laneBoardText}</p></div><div className="lane-board-actions"><span><small>{t.yourLane}</small><strong className={`lane-text-${lane}`}>{lane === "all" ? t.anyLane : t[lane]}</strong></span><button type="button" onClick={autoAssignLanes}>{t.autoPositions}</button></div></div>
        <div className="lane-columns">{(["yellow", "blue", "green"] as const).map((laneKey) => {
          const allyLane = allyTeamIds.filter((id) => laneAssignments[id] === laneKey), enemyLane = enemyIds.filter((id) => laneAssignments[id] === laneKey);
          return <section className={`lane-column lane-column-${laneKey} ${dragOverLane === laneKey ? "is-drop-target" : ""}`} key={laneKey} onDragEnter={() => setDragOverLane(laneKey)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverLane(laneKey); }} onDrop={(event) => dropHero(event, laneKey)}>
            <div className="lane-column-title"><span /><strong>{t[laneKey]} LANE</strong><div className="lane-rate" title={t.laneWinHint}><small>{t.laneWinRate}</small><em>{laneWinRates[laneKey] === null ? "—" : pct(laneWinRates[laneKey]!)}</em></div><b>{allyLane.length}v{enemyLane.length}</b></div>
            {dragOverLane === laneKey && draggedHeroId !== null && laneAssignments[draggedHeroId] !== laneKey && <div className="lane-drop-hint">↓ {t.dropHere}</div>}
            <div className="lane-side ally-side"><small>{t.alliesLabel}</small>{allyLane.map((id) => { const hero = heroMap.get(id); return <article draggable tabIndex={0} aria-label={`${hero?.name}. ${t.dragHero}`} onDragStart={(event) => startHeroDrag(event, id)} onDragEnd={finishHeroDrag} onKeyDown={(event) => moveHeroByKey(event, id)} className={`${id === heroId ? "is-you" : ""} ${draggedHeroId === id ? "is-dragging" : ""}`} key={id}><HeroPortrait hero={hero} size="small" /><span><small>{id === heroId ? t.ownPick : t.allyPick}</small><strong>{hero?.name}</strong></span><i className="drag-handle" aria-hidden="true">⠿</i></article>; })}</div>
            <div className="lane-versus">VS</div>
            <div className="lane-side enemy-side"><small>{t.enemiesLabel}</small>{enemyLane.map((id) => { const hero = heroMap.get(id); const isOpponent = id === laneOpponentId; return <article draggable tabIndex={0} aria-label={`${hero?.name}. ${t.dragHero}`} onDragStart={(event) => startHeroDrag(event, id)} onDragEnd={finishHeroDrag} onKeyDown={(event) => moveHeroByKey(event, id)} className={`${isOpponent ? "is-opponent" : ""} ${draggedHeroId === id ? "is-dragging" : ""}`} key={id}><HeroPortrait hero={hero} size="small" /><span><small>{isOpponent ? t.laneOpponent : t.enemyPick}</small><strong>{hero?.name}</strong></span><button type="button" onClick={() => setLaneOpponentId(id)} title={t.markLaneOpponent}>{isOpponent ? "◆" : "◇"}</button><i className="drag-handle" aria-hidden="true">⠿</i></article>; })}</div>
          </section>;
        })}</div>
      </section>

      {Boolean(counterPicks.length) && <section className="counterpick-section">
        <div className="counterpick-heading"><div><div className="eyebrow">{t.counterpickKicker}</div><h2>{t.counterpickTitle} <span>{enemyIds.length > 1 ? t.enemyTeam : carryHero?.name}</span></h2></div><p>{t.counterpickText}</p></div>
        <div className="counterpick-grid">{counterPicks.slice(0, 4).map((pick, index) => <article className={pick.hero.id === heroId ? "current" : ""} key={pick.hero.id}>
          <div className="pick-rank">{index === 0 ? t.bestPick : `#0${index + 1}`}</div>
          <div className="pick-hero"><HeroPortrait hero={pick.hero} /><div><h3>{pick.hero.name}</h3><small>{pick.coverage}/{enemyIds.length} {t.coverage}</small></div></div>
          <div className="pick-metrics"><div><small>{t.teamWr}</small><strong>{pct(pick.score)}</strong></div><div><small>{t.carryWr}</small><strong>{pct(pick.carryRate)}</strong></div><div><small>{t.sample}</small><strong>{formatMatches(pick.matches, lang)}</strong></div></div>
          <button type="button" onClick={() => selectCounterPick(pick.hero.id)} disabled={pick.hero.id === heroId}>{pick.hero.id === heroId ? t.currentPick : `${t.useHero} →`}</button>
        </article>)}</div>
        <button className="show-all-counters" type="button" onClick={() => setShowAllCounters((current) => !current)}>{showAllCounters ? t.hideAllHeroes : `${t.showAllHeroes} · ${counterPicks.length}`} →</button>
        {showAllCounters && <div className="counter-table"><div className="counter-table-head"><span>#</span><span>{t.heroColumn}</span><span>{t.teamWr}</span><span>{t.carryWr}</span><span>{t.gamesColumn}</span><span>{t.coverage}</span><span /></div>{counterPicks.map((pick, index) => <div className="counter-table-row" key={pick.hero.id}><b>{String(index + 1).padStart(2, "0")}</b><div><HeroPortrait hero={pick.hero} size="small" /><strong>{pick.hero.name}</strong></div><strong>{pct(pick.score)}</strong><strong>{pct(pick.carryRate)}</strong><span>{formatMatches(pick.matches, lang)}</span><span>{pick.coverage}/{enemyIds.length}</span><button type="button" onClick={() => selectCounterPick(pick.hero.id)} disabled={pick.hero.id === heroId}>{pick.hero.id === heroId ? "✓" : "→"}</button></div>)}</div>}
      </section>}

      <section className="results" aria-live="polite">
        <div className="results-heading"><div><div className="eyebrow">{t.liveRec}</div><h2>{t.bestBuys} <span>{t.against} {buyTarget === "team" ? t.enemyLineup : carryHero?.name}</span></h2></div><div className="result-controls"><div className="buy-target-switch" aria-label={t.buyTarget}><small>{t.buyTarget}</small><div><button className={buyTarget === "carry" ? "active" : ""} type="button" onClick={() => setBuyTarget("carry")}>{t.vsCarryMode}</button><button className={buyTarget === "team" ? "active" : ""} type="button" onClick={() => setBuyTarget("team")}>{t.vsTeamMode}</button></div></div><div className="result-actions"><button className={`copy-build full-build-trigger ${showFullBuild ? "active" : ""}`} type="button" onClick={() => setShowFullBuild((current) => !current)}>{showFullBuild ? t.hideFullBuild : t.showFullBuild}</button><button className="copy-build" onClick={shareMatchup}>{linkCopied ? t.linkCopied : t.share}</button><button className="copy-build" onClick={copyTopBuild} disabled={!visibleRecommendations.length}>{copied ? t.copied : t.copyBuild}</button></div></div></div>

        <section className="in-match-tools">
          <article className="next-buy-card">{nextBuy ? <><div className="next-buy-icon">{nextBuy.item.shop_image_webp ? <img src={nextBuy.item.shop_image_webp} alt="" /> : "◆"}</div><div><small>{t.nextBuy}</small><strong>{nextBuy.item.name}</strong><p>{liveAdvice?.reason ?? t.nextBuyText} · ◈ {nextBuy.item.cost?.toLocaleString(lang === "de" ? "de-DE" : "en-US")}</p>{personalHeroProfile?.heroId === heroId && personalHeroProfile.accountId === ownAccountId && <small>PERSONAL FIT · {personalHeroProfile.matches} {heroMap.get(heroId)?.name ?? "hero"} matches · {personalHeroProfile.itemStats.find((item) => item.itemId === nextBuy.item.id)?.matches ?? 0} matches with this item</small>}{normalCoreNext && normalCoreNext.item.id !== nextBuy.item.id && <small>NORMAL CORE BUY · {normalCoreNext.item.name} · delayed by one purchase</small>}<b className={(nextBuy.item.cost ?? 0) <= souls ? "buy-ready" : "buy-saving"}>{desktopSoulsKnown === false || (liveAdvice && liveAdvice.affordable == null) ? "Live souls unavailable" : (nextBuy.item.cost ?? 0) <= souls ? t.affordable : `${t.needSouls}: ◈ ${((nextBuy.item.cost ?? 0) - souls).toLocaleString(lang === "de" ? "de-DE" : "en-US")}`}</b></div></> : <><div className="next-buy-icon">◆</div><div><small>{t.nextBuy}</small><strong>—</strong><p>{desktopStatus?.in_game ? "Awaiting verified match recommendation" : ownedItemIds.length ? t.duplicatePlan : ""}</p></div></>}</article>
          {desktopStatus?.in_game && Boolean(desktopAdvice?.alternatives.length) && <div className="desktop-advice-alternatives"><small>{lang === "de" ? "ALTERNATIVEN" : "ALTERNATIVES"}</small>{desktopAdvice?.alternatives.map((item) => <span key={item.item_id}>{item.name} · ◈ {item.cost.toLocaleString(lang === "de" ? "de-DE" : "en-US")}</span>)}</div>}
          <div className="context-controls"><div><small>{t.matchState}</small><div className="segmented">{(["ahead", "even", "behind"] as const).map((state) => <button className={matchState === state ? "active" : ""} type="button" key={state} onClick={() => updateContext(() => setMatchState(state))}>{t[state]}</button>)}</div></div><div><small>{t.buildPath}</small><div className="segmented">{(["balanced", "safe", "greedy"] as const).map((style) => <button className={buildStyle === style ? "active" : ""} type="button" key={style} onClick={() => updateContext(() => setBuildStyle(style))}>{t[style]}</button>)}</div></div></div>
          <div className="threat-controls"><small>{t.threats}</small><div>{(["healing", "weapon", "spirit", "crowdControl"] as const).map((threat) => <button className={threats[threat] ? "active" : ""} type="button" key={threat} onClick={() => updateContext(() => setThreats((current) => ({ ...current, [threat]: !current[threat] })))}>{t[threat === "weapon" ? "weaponDamage" : threat === "spirit" ? "spiritDamage" : threat]}</button>)}</div><label className="souls-input"><span>{t.souls}</span><input type="number" min="0" value={souls || ""} onChange={(event) => setSouls(Math.max(0, Number(event.target.value)))} placeholder="0" /></label></div>
        </section>
        {(activeAlerts.length > 0 || patchNote) && <section className="context-alerts"><div><small>{t.counterAlerts}</small>{activeAlerts.map((alert) => <p key={alert}>⚠ {alert}</p>)}</div><button type="button" onClick={() => void showLatestPatch()}><small>{t.patchFreshness}</small><strong>{patchNote?.title ?? t.latestPatch}</strong><span>{t.patchFresh}</span></button></section>}
        {enemyBuildInsights.length > 0 && <section className="enemy-build-signals"><small>{t.enemyBuildSignals}</small><div>{enemyBuildInsights.map((signal) => <article key={signal.heroId} role="button" tabIndex={0} onClick={() => setSelectedEnemySignal({ heroId: signal.heroId, stats: signal.stats })} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setSelectedEnemySignal({ heroId: signal.heroId, stats: signal.stats }); } }}><HeroPortrait hero={heroMap.get(signal.heroId)} size="small" /><div>{signal.items.slice(0, 3).map(({ item, stat }) => <span key={item.id} title={`${item.name} · ${formatMatches(stat.matches, lang)} ${t.games}`}>{item.shop_image_webp ? <img src={item.shop_image_webp} alt="" /> : "◆"}<b>{item.name}</b></span>)}</div></article>)}</div></section>}

        <div className="match-context">
          <label className="minute-control"><span><small>{t.currentMinute}</small><strong>{gameMinute}:00</strong></span><input type="range" min="1" max="40" value={gameMinute} onChange={(event) => setGameMinute(Number(event.target.value))} /><div className="phase-tabs">{(["early", "mid", "late"] as Phase[]).map((value) => <button type="button" key={value} className={phase === value ? "active" : ""} onClick={() => setGameMinute(value === "early" ? 7 : value === "mid" ? 15 : 26)}>{t[value]}</button>)}</div></label>
          <div className="quick-stats"><div><small>{t.matchup}</small><strong>{matchupWinRate === null ? "—" : pct(matchupWinRate)}</strong></div><div><small>{t.games}</small><strong>{formatMatches(matchup?.matches_played ?? 0, lang)}</strong></div><div><small>{t.focus}</small><strong>{carryHero?.name ?? "—"}</strong></div><div><small>{t.items}</small><strong>{visibleRecommendations.length}</strong></div></div>
        </div>

        <div className="filter-bar"><div className="filter-title">{t.filters}</div><label><small>{t.category}</small><select value={category} onChange={(event) => setCategory(event.target.value as Category)}><option value="all">{t.all}</option><option value="weapon">{t.weapon}</option><option value="vitality">{t.vitality}</option><option value="spirit">{t.spirit}</option></select></label><label><small>{t.minSample}</small><select value={minSample} onChange={(event) => setMinSample(Number(event.target.value))}><option value="80">80+</option><option value="250">250+</option><option value="1000">1K+</option><option value="5000">5K+</option></select></label><label><small>{t.sort}</small><select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="buytime">{t.buytimeSort}</option><option value="recommended">{t.recommended}</option><option value="winrate">{t.winrate}</option><option value="sample">{t.sample}</option><option value="cost">{t.cost}</option></select></label></div>

        <details className="advanced-options">
          <summary><span>＋</span> {t.moreOptions}</summary>
          <div className="advanced-grid">
            <section><div className="advanced-title">{t.apiFilters}</div><label><small>{t.queue}</small><select value={queueMode} onChange={(event) => setQueueMode(event.target.value as QueueMode)}><option value="all">{t.both}</option><option value="ranked">{t.ranked}</option><option value="unranked">{t.unranked}</option></select></label><label><small>{t.dataWindow}</small><select value={dataWindow} onChange={(event) => setDataWindow(Number(event.target.value))}><option value="7">7 {t.days}</option><option value="30">30 {t.days}</option><option value="90">90 {t.days}</option></select></label><label className="toggle-option"><input type="checkbox" checked={laneOnly} onChange={(event) => setLaneOnly(event.target.checked)} /><span />{t.laneOnly}</label></section>
            <section><div className="advanced-title">{t.itemRules}</div><label><small>{t.maxBudget}</small><select value={maxBudget} onChange={(event) => setMaxBudget(Number(event.target.value))}><option value="0">{t.noLimit}</option><option value="800">800</option><option value="1600">1,600</option><option value="3200">3,200</option><option value="6400">6,400</option></select></label><label><small>{t.itemTier}</small><select value={itemTier} onChange={(event) => setItemTier(Number(event.target.value))}><option value="0">{t.anyTier}</option><option value="1">Tier 1</option><option value="2">Tier 2</option><option value="3">Tier 3</option><option value="4">Tier 4</option></select></label></section>
            <section><div className="advanced-title">OUTPUT</div><label><small>{t.resultCount}</small><select value={resultCount} onChange={(event) => setResultCount(Number(event.target.value))}><option value="4">4</option><option value="8">8</option><option value="12">12</option></select></label><label className="toggle-option"><input type="checkbox" checked={positiveLiftOnly} onChange={(event) => setPositiveLiftOnly(event.target.checked)} /><span />{t.positiveLift}</label><p>{t.reanalyzeHint}</p></section>
          </div>
        </details>

        {showFullBuild && !loading && !error && <section className="full-build-board">
          <div className="full-build-head"><div><div className="eyebrow">{t.buyOrder} · {buyTarget === "team" ? t.vsTeamMode : t.vsCarryMode}</div><h3>{t.fullBuild}</h3><p>{t.fullBuildText}</p></div><div className="build-enemy-lineup">{enemyIds.map((id) => <span key={id} className={id === carryId ? "carry" : ""} title={heroMap.get(id)?.name}><HeroPortrait hero={heroMap.get(id)} size="small" /></span>)}</div></div>
          <div className="build-summary"><div><small>{t.totalBuildCost}</small><strong>◈ {fullBuildCost.toLocaleString(lang === "de" ? "de-DE" : "en-US")}</strong></div><div><small>{t.remainingCost}</small><strong>◈ {remainingBuildCost.toLocaleString(lang === "de" ? "de-DE" : "en-US")}</strong></div><div><small>{t.planChecks}</small><strong>{fullBuildPlan.purchaseOrder.length === 16 && new Set(fullBuildPlan.purchaseOrder.map((entry) => entry.item.id)).size === 16 ? t.planReady : `${fullBuildPlan.purchaseOrder.length}/16`}</strong></div><div className="preset-actions"><button type="button" onClick={saveSetup}>{t.savePreset}</button><button type="button" onClick={loadSetup}>{t.loadPreset}</button>{presetMessage && <small>{presetMessage}</small>}</div></div>
          <div className="final-inventory"><div className="final-inventory-title">{t.finalInventory}</div>{([
            { key: "weapon", label: t.weapon, items: fullBuildPlan.weapon }, { key: "vitality", label: t.vitality, items: fullBuildPlan.vitality }, { key: "spirit", label: t.spirit, items: fullBuildPlan.spirit }, { key: "flex", label: t.situationalSlots, items: fullBuildPlan.flex },
          ] as const).map((group) => <section className={`inventory-group ${group.key}`} key={group.key}><strong>{group.label}</strong><div>{group.items.map((entry) => <span key={entry.item.id} title={`${entry.item.name} · ${pct(fullBuildPlan.values(entry).rate)}`}>{entry.item.shop_image_webp ? <img src={entry.item.shop_image_webp} alt={entry.item.name} /> : "◆"}<b>T{entry.item.item_tier}</b></span>)}</div></section>)}</div>
          <div className="build-timeline">{([
            { key: "early", label: t.earlyBuys, items: fullBuildPlan.early, offset: 0 },
            { key: "mid", label: t.midUpgrades, items: fullBuildPlan.mid, offset: fullBuildPlan.early.length },
            { key: "late", label: t.lateCore, items: fullBuildPlan.late, offset: fullBuildPlan.early.length + fullBuildPlan.mid.length },
          ] as const).map((stage) => <section className={`build-stage ${stage.key}`} key={stage.key}><div className="build-stage-label"><span>{stage.key === "early" ? "01" : stage.key === "mid" ? "02" : "03"}</span><strong>{stage.label}</strong></div><div className="build-stage-items">{stage.items.map((entry, index) => { const target = entry.enemyRates[0]; return <article className={`build-slot slot-${entry.item.item_slot_type}`} key={entry.item.id}><div className="build-order">{String(stage.offset + index + 1).padStart(2, "0")}</div><div className="build-item-image">{entry.item.shop_image_webp ? <img src={entry.item.shop_image_webp} alt="" /> : "◆"}</div><strong>{entry.item.name}</strong><small>{formatTime(fullBuildPlan.values(entry).buyTime, lang)} · ◈ {entry.item.cost?.toLocaleString(lang === "de" ? "de-DE" : "en-US")}</small>{buyTarget === "team" && target && <span className="build-target" title={`${t.bestAgainst} ${heroMap.get(target.heroId)?.name}`}><HeroPortrait hero={heroMap.get(target.heroId)} size="small" /></span>}</article>; })}</div></section>)}</div>
          <div className="sell-plan"><div className="sell-plan-title"><span>↻</span><div><strong>{t.sellPlan}</strong><small>{t.sellAt}</small></div></div><div className="sell-plan-list">{fullBuildPlan.sellSuggestions.length ? fullBuildPlan.sellSuggestions.map(({ sell, replacement }) => <article key={`${sell.item.id}-${replacement.item.id}`}><div className="sell-pair-item"><div className="mini-item-image">{sell.item.shop_image_webp ? <img src={sell.item.shop_image_webp} alt="" /> : "◆"}</div><span><small>SELL</small><strong>{sell.item.name}</strong></span></div><b>→</b><div className="sell-pair-item replacement"><div className="mini-item-image">{replacement.item.shop_image_webp ? <img src={replacement.item.shop_image_webp} alt="" /> : "◆"}</div><span><small>{t.replaceWith}</small><strong>{replacement.item.name}</strong></span></div></article>) : <p>{t.noSell}</p>}</div></div>
        </section>}

        {error && <div className="error-card">{error}</div>}
        {!error && loading && <div className="loading-grid">{[1,2,3,4].map((n) => <div key={n} />)}</div>}
        {!error && !loading && !visibleRecommendations.length && <div className="empty-card">{t.empty}</div>}
        {!error && !loading && Boolean(visibleRecommendations.length) && <div className="item-grid">{visibleRecommendations.map((entry, index) => { const rate = buyTarget === "team" ? entry.teamRate : entry.carryRate; const matches = buyTarget === "team" ? entry.teamMatches : entry.carryMatches; const buyTime = buyTarget === "team" ? entry.teamBuyTime : entry.carryBuyTime; const lift = (rate - entry.baselineRate) * 100; const confidence = confidenceTier(matches); const confidenceText = confidence === "high" ? t.highConfidence : confidence === "medium" ? t.mediumConfidence : t.lowConfidence; return <article className={`item-card slot-${entry.item.item_slot_type}`} key={entry.item.id}><div className="rank">#{String(index + 1).padStart(2, "0")}</div><div className="item-icon">{entry.item.shop_image_webp ? <img src={entry.item.shop_image_webp} alt="" /> : <span>◆</span>}</div><div className="item-main"><div className="item-meta"><span>{entry.item.item_slot_type && t[entry.item.item_slot_type]}</span><span>{buyTarget === "team" ? t.vsTeamMode : t.vsCarryMode}</span><span>T{entry.item.item_tier}</span><b className={`confidence ${confidence}`} title={t.sampleConfidence}>{confidenceText}</b></div><h3>{entry.item.name}</h3><div className="item-reason">{lift >= 0 ? "+" : ""}{lift.toFixed(1)} {buyTarget === "team" ? t.vsTeam : t.vsCarry}</div><details className="item-why"><summary>{t.whyItem}</summary><p>{t.whyItemText}</p></details>{buyTarget === "team" && Boolean(entry.enemyRates.length) && <div className="team-item-targets"><small>{t.bestAgainst}</small><div>{entry.enemyRates.slice(0, 2).map((target) => { const targetHero = heroMap.get(target.heroId); return <span key={target.heroId} title={`${targetHero?.name} · ${pct(target.rate)}`}><HeroPortrait hero={targetHero} size="small" /><em>{targetHero?.name}</em><b>{target.lift >= 0 ? "+" : ""}{(target.lift * 100).toFixed(1)}</b></span>; })}</div></div>}</div><div className="item-stat"><small>{t.winrateLabel}</small><strong>{pct(rate)}</strong></div><div className="item-stat"><small>{t.sample}</small><strong>{formatMatches(matches, lang)}</strong></div><div className="item-stat"><small>{t.buyTime}</small><strong>{formatTime(buyTime, lang)}</strong></div><div className="cost">◈ {entry.item.cost?.toLocaleString(lang === "de" ? "de-DE" : "en-US")}</div></article>; })}</div>}

        <div className="method-note"><span>i</span><p><strong>{t.methodTitle}</strong> {t.method}</p><button className="overlay-trigger" type="button" onClick={() => setOverlayOpen(true)}>{t.overlay}</button>{updatedAt && <time>{t.updated} {updatedAt.toLocaleTimeString(lang === "de" ? "de-DE" : "en-US", { hour: "2-digit", minute: "2-digit" })}</time>}</div>
      </section>

      {overlayOpen && <aside className="match-overlay" role="dialog" aria-modal="true" aria-label={t.overlay}><button type="button" onClick={() => setOverlayOpen(false)}>{t.closeOverlay} ×</button><small>{t.nextBuy}</small>{nextBuy && <div><div className="overlay-icon">{nextBuy.item.shop_image_webp ? <img src={nextBuy.item.shop_image_webp} alt="" /> : "◆"}</div><strong>{nextBuy.item.name}</strong><b>◈ {nextBuy.item.cost?.toLocaleString(lang === "de" ? "de-DE" : "en-US")}</b></div>}{activeAlerts.length > 0 && <section><small>{t.counterAlerts}</small>{activeAlerts.map((alert) => <p key={alert}>⚠ {alert}</p>)}</section>}<section><small>{t.buildPath}</small><strong>{t[buildStyle]} · {t[matchState]}</strong></section></aside>}
      {selectedEnemyInsight && <aside className="enemy-detail-modal" role="dialog" aria-modal="true" aria-label={t.enemyDetails}><button type="button" onClick={() => setSelectedEnemySignal(null)}>{t.closeDetails} ×</button><div><HeroPortrait hero={heroMap.get(selectedEnemyInsight.heroId)} /><div><small>{t.enemyDetails}</small><h3>{heroMap.get(selectedEnemyInsight.heroId)?.name}</h3></div></div><small>{t.commonBuild}</small>{selectedEnemyInsight.items.map(({ item, stat }) => <article key={item.id}><div>{item.shop_image_webp ? <img src={item.shop_image_webp} alt="" /> : "◆"}</div><strong>{item.name}</strong><span>{formatMatches(stat.matches, lang)} {t.games}</span></article>)}</aside>}

      <footer><div className="brand"><span className="brand-mark">CL</span><span><strong>COUNTER</strong>LOCK</span></div><p>{t.footer} <a href="https://deadlock-api.com/" target="_blank" rel="noreferrer">Deadlock API</a>{statlockerStatus === "connected" ? <> · <a href="https://statlocker.gg/" target="_blank" rel="noreferrer">Powered by Statlocker</a></> : <> · Statlocker: {statlockerStatus === "not_configured" ? (lang === "de" ? "nicht konfiguriert" : "not configured") : (lang === "de" ? "nicht verfügbar" : "unavailable")}</>} {t.disclaimer}</p></footer>
      </div>

      {allyPickerOpen && <div className="import-overlay hero-picker-overlay" role="dialog" aria-modal="true" aria-labelledby="ally-picker-title">
        <div className="import-modal hero-picker-modal ally-picker-modal">
          <button className="modal-close" type="button" onClick={closeAllyPicker} aria-label={t.closeAllyPicker}>×</button>
          <div className="hero-picker-head ally-picker-head"><div><div className="eyebrow">{t.allyRoster} · {heroes.length}</div><h2 id="ally-picker-title">{t.buildOwnTeam}</h2><p>{pendingAllyIds.length}/5 {t.alliesSelected}</p></div><label className="hero-search"><span>⌕</span><input autoFocus value={allySearch} onChange={(event) => setAllySearch(event.target.value)} placeholder={t.allySearch} /></label></div>
          <div className="hero-roster-grid ally-roster-grid">{filteredAllyHeroes.map((hero) => { const selected = pendingAllyIds.includes(hero.id); const unavailable = hero.id === heroId || enemyIds.includes(hero.id); const selectionIndex = pendingAllyIds.indexOf(hero.id); return <button className={`${selected ? "ally-selected" : ""} ${unavailable ? "enemy" : ""}`} type="button" key={hero.id} onClick={() => togglePendingAlly(hero.id)} disabled={unavailable} aria-pressed={selected}>
            <span className="hero-card-art">{hero.images?.icon_hero_card_webp ? <img src={hero.images.icon_hero_card_webp} alt="" /> : <HeroPortrait hero={hero} />}</span><span className="hero-card-name"><strong>{hero.name}</strong><small>{selected ? `${t.teamSlots} · 0${selectionIndex + 1}` : hero.id === heroId ? t.ownPick : enemyIds.includes(hero.id) ? t.enemyPick : `#${String(hero.id).padStart(2, "0")}`}</small></span>{selected && <i>{selectionIndex + 1}</i>}
          </button>; })}</div>
          <div className="enemy-picker-actions ally-picker-actions"><button type="button" onClick={closeAllyPicker}>{t.cancel}</button><div><span>{pendingAllyIds.length}</span><small>/ 5 {t.alliesSelected}</small></div><button type="button" onClick={applyAllies}>{t.applyAllies} →</button></div>
        </div>
      </div>}

      {enemyPickerOpen && <div className="import-overlay hero-picker-overlay" role="dialog" aria-modal="true" aria-labelledby="enemy-picker-title">
        <div className="import-modal hero-picker-modal enemy-picker-modal">
          <button className="modal-close" type="button" onClick={closeEnemyPicker} aria-label={t.closeEnemyPicker}>×</button>
          <div className="hero-picker-head enemy-picker-head"><div><div className="eyebrow">{t.enemyRoster} · {heroes.length}</div><h2 id="enemy-picker-title">{t.buildEnemyTeam}</h2><p>{pendingEnemyIds.length}/6 {t.teamSelected}</p></div><label className="hero-search"><span>⌕</span><input autoFocus value={enemySearch} onChange={(event) => setEnemySearch(event.target.value)} placeholder={t.enemySearch} /></label></div>
          <div className="hero-roster-grid enemy-roster-grid" ref={enemyRosterRef}>{filteredEnemyHeroes.map((hero) => { const selected = pendingEnemyIds.includes(hero.id); const unavailable = hero.id === heroId || allyIds.includes(hero.id); const selectionIndex = pendingEnemyIds.indexOf(hero.id); return <button className={`${selected ? "team-selected" : ""} ${unavailable ? "enemy" : ""}`} type="button" key={hero.id} onClick={() => togglePendingEnemy(hero.id)} disabled={unavailable} aria-pressed={selected}>
            <span className="hero-card-art">{hero.images?.icon_hero_card_webp ? <img src={hero.images.icon_hero_card_webp} alt="" /> : <HeroPortrait hero={hero} />}</span>
            <span className="hero-card-name"><strong>{hero.name}</strong><small>{selected ? `${t.teamSlots} · 0${selectionIndex + 1}` : hero.id === heroId ? t.ownPick : allyIds.includes(hero.id) ? t.allyPick : `#${String(hero.id).padStart(2, "0")}`}</small></span>
            {selected && <i>{selectionIndex + 1}</i>}
          </button>; })}</div>
          <div className="enemy-picker-actions"><button type="button" onClick={closeEnemyPicker}>{t.cancel}</button><div><span>{pendingEnemyIds.length}</span><small>/ 6 {t.teamSelected}</small></div><button type="button" onClick={applyEnemyTeam} disabled={!pendingEnemyIds.length}>{t.applyTeam} →</button></div>
        </div>
      </div>}

      {heroPickerOpen && <div className="import-overlay hero-picker-overlay" role="dialog" aria-modal="true" aria-labelledby="hero-picker-title">
        <div className="import-modal hero-picker-modal">
          <button className="modal-close" type="button" onClick={() => { setHeroPickerOpen(false); setHeroSearch(""); }} aria-label={t.closeHeroPicker}>×</button>
          <div className="hero-picker-head"><div><div className="eyebrow">{t.heroRoster} · {heroes.length}</div><h2 id="hero-picker-title">{t.chooseHero}</h2><p>{heroes.length} {t.heroesAvailable}</p></div><label className="hero-search"><span>⌕</span><input autoFocus value={heroSearch} onChange={(event) => setHeroSearch(event.target.value)} placeholder={t.searchHero} /></label></div>
          <div className="hero-roster-grid">{filteredHeroes.map((hero) => { const selected = hero.id === heroId; const enemy = enemyIds.includes(hero.id); return <button className={`${selected ? "selected" : ""} ${enemy ? "enemy" : ""}`} type="button" key={hero.id} onClick={() => chooseOwnHero(hero.id)} disabled={enemy}>
            <span className="hero-card-art">{hero.images?.icon_hero_card_webp ? <img src={hero.images.icon_hero_card_webp} alt="" /> : <HeroPortrait hero={hero} />}</span>
            <span className="hero-card-name"><strong>{hero.name}</strong><small>{selected ? t.selectedHero : enemy ? t.enemyPick : `#${String(hero.id).padStart(2, "0")}`}</small></span>
            {selected && <i>✓</i>}
          </button>; })}</div>
        </div>
      </div>}

      {importerOpen && <div className="import-overlay" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="import-modal">
          <button className="modal-close" type="button" onClick={closeImporter} aria-label={t.close}>×</button>
          <div className="eyebrow">AUTO TEAM IMPORT · OCR</div>
          <h2 id="import-title">{importTarget === "auto" ? t.autoImporterTitle : importTarget === "ally" ? t.importAllies : t.importerTitle}</h2>
          <p className="import-intro">{importTarget === "auto" ? t.autoImporterText : importTarget === "ally" ? t.allyImporterText : t.importerText}</p>
          <div className="privacy-note">● {t.localOnly}</div>

          {!screenshotUrl && <label className="drop-zone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void readScreenshot(file); }}>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readScreenshot(file); }} />
            <span className="upload-glyph">▣</span><strong>{importTarget === "auto" ? t.pasteHint : t.dropTitle}</strong><small>{t.dropText}</small>
          </label>}

          {screenshotUrl && <div className="scan-layout">
            <div className="screenshot-preview"><img src={screenshotUrl} alt="Match screenshot preview" />{ocrRunning && <div className="scan-line" />}</div>
            <div className="scan-results">
              {ocrRunning && <div className="ocr-progress"><div><span style={{ width: `${ocrProgress}%` }} /></div><strong>{t.scanning} · {ocrProgress}%</strong></div>}
              {ocrComplete && <><div className="detected-title"><span>{t.detected}</span><b>{detections.length}</b></div>{detections.length ? <>
                {importTarget === "auto" && <label className="identify-player"><span><strong>{t.identifyYourHero}</strong><small>{t.identifyHint}</small></span><select value={detections.find((entry) => entry.isOwn)?.id ?? ""} onChange={(event) => { const id = Number(event.target.value); setDetections((current) => current.map((entry) => ({ ...entry, isOwn: entry.id === id }))); }}><option value="">{t.chooseYourHero}</option>{detections.filter((entry) => entry.side === "ally").map((entry) => <option key={entry.id} value={entry.id}>{heroMap.get(entry.id)?.name}{entry.playerName ? ` · ${entry.playerName}` : ""}</option>)}</select></label>}
                <div className="detected-list">{detections.map((entry) => { const hero = heroMap.get(entry.id); const selected = selectedDetections.includes(entry.id); const importLimit = importTarget === "auto" ? 12 : importTarget === "ally" ? 5 : 6; return <label className={`${selected ? "selected" : ""} ${entry.isOwn ? "detected-own" : ""}`} key={entry.id}><input type="checkbox" checked={selected} onChange={() => setSelectedDetections((current) => current.includes(entry.id) ? current.filter((id) => id !== entry.id) : current.length < importLimit ? [...current, entry.id] : current)} /><HeroPortrait hero={hero} size="small" /><span><strong>{hero?.name}{entry.isOwn ? ` · ${t.ownPick}` : ""}</strong><small>{entry.side ? `${entry.side.toUpperCase()} · ${entry.lane?.toUpperCase()} LANE` : `${Math.round(entry.confidence * 100)}% ${t.confidence}`}</small></span><i>{selected ? "✓" : "+"}</i></label>; })}</div>
              </> : <div className="ocr-empty">{t.noHeroes}</div>}</>}
            </div>
          </div>}

          {screenshotUrl && <div className="import-actions"><label className="rescan-button"><input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readScreenshot(file); }} />{t.scanAgain}</label><button type="button" onClick={importDetectedHeroes} disabled={!selectedDetections.length || ocrRunning || (importTarget === "auto" && !detections.some((entry) => entry.isOwn))}>{importTarget === "auto" ? t.autoImport : importTarget === "ally" ? t.applyAllies : t.importHeroes} ({selectedDetections.length}/{importTarget === "auto" ? 12 : importTarget === "ally" ? 5 : 6}) →</button></div>}
        </div>
      </div>}
      </div>
    </main>
  );
}
