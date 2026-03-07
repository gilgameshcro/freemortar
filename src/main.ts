import './style.css';
import { AudioManager } from './AudioManager';
import {
    addWeaponAmmo,
    COLOR_OPTIONS,
    createWeaponsForLoadout,
    getWeaponSellPrice,
    getWeaponShopPrice,
    LOADOUTS,
    LOGICAL_HEIGHT,
    LOGICAL_WIDTH,
    MAX_PLAYERS,
    removeWeaponAmmo,
    ROUND_SHOP_BASE_CREDITS,
    WEAPON_DEFINITIONS
} from './config';
import { Game, type HudSnapshot, type RoundSummary } from './Game';
import { Network } from './Network';
import type {
    GameMessage,
    LobbyPlayer,
    LoadoutId,
    MatchSettings,
    MatchStartPayload,
    PlayerSetup,
    PlayerStatsSnapshot,
    PowerRule,
    RoundOrderMode,
    ScoringSettings,
    TerrainTheme,
    WeaponState,
    WeaponType,
    WindMode
} from './types';

type LobbyMode = 'idle' | 'online-host' | 'online-client' | 'local';
type IntermissionStage = 'hidden' | 'victory' | 'stats' | 'campaign' | 'shop';
type LocalProfile = { name: string; color: string; loadout: LoadoutId };
type ShopSelection = { playerId: string; weaponType: WeaponType; source: 'market' | 'stock' };

type SetupLaunchMode = 'online-host' | 'local';

const SHOP_WEAPON_ORDER: WeaponType[] = ['mortar', 'needle', 'nova', 'merv', 'chaos', 'chaos_mirv', 'driller', 'blast_bomb', 'autocannon', 'wall', 'large_wall', 'bunker_buster', 'homing_missile', 'relocator', 'leech', 'blossom', 'sinker', 'crossfire', 'large_cannon', 'large_mortar', 'large_needle', 'large_nova', 'large_merv', 'large_chaos', 'large_chaos_mirv', 'large_driller', 'large_blast_bomb', 'large_autocannon', 'shield_small', 'shield_medium', 'shield_large'];
const TERRAIN_OPTIONS: Array<{ value: TerrainTheme; name: string; blurb: string }> = [
    { value: 'rolling', name: 'Rolling', blurb: 'Balanced ridges and valleys.' },
    { value: 'flats', name: 'Flats', blurb: 'Low contour, shallow craters.' },
    { value: 'hills', name: 'Hills', blurb: 'Layered humps and firing pockets.' },
    { value: 'mountains', name: 'Mountains', blurb: 'Extreme peaks with deep cuts.' },
    { value: 'highlands', name: 'Highlands', blurb: 'Massive plateaus over low plains.' },
    { value: 'divide', name: 'Divide', blurb: 'One side high, one side low.' }
];

type CampaignPlayer = {
    id: string;
    name: string;
    color: string;
    loadout: LoadoutId;
    isHost: boolean;
    weapons: WeaponState[];
    shield: number;
    credits: number;
    shopReady: boolean;
    stats: PlayerStatsSnapshot;
};

const DEFAULT_SCORING: ScoringSettings = {
    awardDamage: true,
    damagePointValue: 1,
    awardKills: true,
    killPointValue: 50,
    awardPlacement: true,
    firstPlacePoints: 100,
    secondPlacePoints: 50,
    thirdPlacePoints: 25
};

const DEFAULT_SETTINGS: MatchSettings = {
    windMode: 'variable',
    maxWind: 0.45,
    terrainThemes: TERRAIN_OPTIONS.map((option) => option.value),
    terrainCollapse: true,
    powerRule: 'health_linked',
    rounds: 1,
    scoring: { ...DEFAULT_SCORING },
    weaponCostMultiplier: 1,
    roundOrder: 'player_number'
};

const app = document.getElementById('app');
if (!app) throw new Error('App root not found');

app.innerHTML = `
    <div class="app-shell">
        <section id="menuScreen" class="screen menu-screen">
            <div class="hero-strip pixel-panel">
                <div>
                    <p class="eyebrow">FREE MORTAR // TACTICAL PIXEL DUEL</p>
                    <h1>FreeMortar</h1>
                    <p class="hero-copy">Destructible terrain, local or online multiplayer, campaign rounds, carry-over arsenals, and chunky placeholder synth audio.</p>
                </div>
                <div class="audio-controls">
                    <button id="btnMuteMenu" class="pixel-button ghost">Audio On</button>
                    <button id="btnMusicMenu" class="pixel-button ghost">Music On</button>
                    <label class="volume-stack" for="volumeRangeMenu">
                        <span class="field-label compact">Volume</span>
                        <input id="volumeRangeMenu" class="volume-range" type="range" min="0" max="100" value="72" />
                    </label>
                </div>
            </div>

            <section class="pixel-panel profile-panel top-profile-panel">
                <div class="panel-title-row">
                    <div>
                        <p class="eyebrow">PILOT</p>
                        <h2>Pilot Setup</h2>
                    </div>
                    <button id="btnReady" class="pixel-button primary" disabled>Join a lobby first</button>
                </div>
                <div class="top-profile-grid">
                    <div>
                        <label class="field-label" for="playerName">Pilot Name</label>
                        <input id="playerName" class="pixel-input" type="text" maxlength="16" placeholder="Enter a callsign" />
                    </div>
                    <div>
                        <label class="field-label">Color</label>
                        <div id="playerColorPicker" class="color-grid"></div>
                    </div>
                    <div>
                        <label class="field-label" for="playerLoadout">Loadout</label>
                        <select id="playerLoadout" class="pixel-select"></select>
                        <p id="loadoutDescription" class="field-help compact-help"></p>
                    </div>
                </div>
            </section>

            <div class="menu-grid session-grid">
                <section class="pixel-panel session-panel">
                    <div class="mode-card">
                        <div>
                            <p class="eyebrow">ONLINE</p>
                            <h3>Host Match</h3>
                            <p>Open the match rules, tighten the setup, then create a room and share the code.</p>
                        </div>
                        <button id="btnHost" class="pixel-button primary">Create Room</button>
                    </div>

                    <div class="mode-card join-card">
                        <div>
                            <p class="eyebrow">ONLINE</p>
                            <h3>Join Match</h3>
                            <p>Use a 4-character room code and sync into the host lobby.</p>
                        </div>
                        <input id="roomCode" class="pixel-input room-input" type="text" maxlength="4" placeholder="ROOM" />
                        <button id="btnJoin" class="pixel-button secondary">Join Room</button>
                    </div>

                    <div class="mode-card">
                        <div>
                            <p class="eyebrow">OFFLINE</p>
                            <h3>Local Skirmish</h3>
                            <p>Open the match rules, build the local roster, then pass the keyboard between rounds.</p>
                        </div>
                        <div class="inline-controls">
                            <label class="field-label compact" for="localPlayerCount">Pilots</label>
                            <select id="localPlayerCount" class="pixel-select compact"></select>
                        </div>
                        <button id="btnLocal" class="pixel-button accent">Create Local Lobby</button>
                    </div>
                </section>
            </div>

            <section id="battleSetupPanel" class="pixel-panel battle-setup-panel setup-drawer hidden">
                <div class="battle-setup-head compact">
                    <div>
                        <p class="eyebrow">MATCH RULES</p>
                        <h2 id="battleSetupTitle">Battle Setup</h2>
                        <p id="battleSetupLead" class="field-help settings-help compact-help">Choose the rule set, terrain pool, and scoring before launching.</p>
                    </div>
                    <div class="battle-setup-actions">
                        <button id="btnBattleSetupBack" class="pixel-button ghost" type="button">Back</button>
                        <button id="btnBattleSetupConfirm" class="pixel-button primary" type="button">Create Match</button>
                    </div>
                </div>
                <div class="battle-setup-clusters">
                    <section class="rules-cluster">
                        <div class="cluster-head">
                            <div>
                                <p class="eyebrow">ROUND FLOW</p>
                                <h3>Core rules</h3>
                            </div>
                        </div>
                        <div class="battle-setup-grid compact-rules-grid">
                            <label class="setting-field span-2" for="powerRule">
                                <span class="field-label">Power Cap</span>
                                <select id="powerRule" class="pixel-select">
                                    <option value="health_linked">HP Linked (200 max, -2 per HP lost)</option>
                                    <option value="static">Static</option>
                                </select>
                            </label>
                            <label class="setting-field span-1" for="roundCount">
                                <span class="field-label">Rounds</span>
                                <input id="roundCount" class="pixel-input" type="number" min="1" max="99" step="1" value="1" />
                            </label>
                            <label class="setting-field span-2" for="roundOrder">
                                <span class="field-label">Round Order</span>
                                <select id="roundOrder" class="pixel-select">
                                    <option value="player_number">Player Number</option>
                                    <option value="random">Random</option>
                                    <option value="winning_order">Winning Order</option>
                                    <option value="reverse_winning_order">Reverse Winning Order</option>
                                </select>
                            </label>
                            <label class="setting-field span-1" for="weaponCostMultiplier">
                                <span class="field-label">Weapon Cost x</span>
                                <input id="weaponCostMultiplier" class="pixel-input" type="number" min="0.25" max="5" step="0.25" value="1" />
                            </label>
                            <label class="setting-field span-2" for="windMode">
                                <span class="field-label">Wind Mode</span>
                                <select id="windMode" class="pixel-select">
                                    <option value="variable">Variable</option>
                                    <option value="constant">Constant</option>
                                    <option value="disabled">Disabled</option>
                                </select>
                            </label>
                            <label class="setting-field span-1" for="windMax">
                                <span class="field-label">Wind Strength</span>
                                <select id="windMax" class="pixel-select">
                                    <option value="0.25">Low</option>
                                    <option value="0.45" selected>Medium</option>
                                    <option value="0.7">High</option>
                                </select>
                            </label>
                            <label class="toggle-row setting-toggle span-2" for="terrainCollapse">
                                <input id="terrainCollapse" type="checkbox" checked />
                                <span>Terrain Collapse</span>
                            </label>
                        </div>
                    </section>

                    <section class="rules-cluster terrain-cluster">
                        <div class="cluster-head">
                            <div>
                                <p class="eyebrow">TERRAIN POOL</p>
                                <h3>Eligible maps</h3>
                            </div>
                            <p class="field-help compact-help">Every round pulls one map from the enabled set.</p>
                        </div>
                        <div id="terrainThemePool" class="terrain-pool-grid">
                            ${TERRAIN_OPTIONS.map((option) => `
                                <label class="terrain-chip">
                                    <input type="checkbox" name="terrainThemePool" value="${option.value}" checked />
                                    <span>
                                        <strong>${option.name}</strong>
                                        <small>${option.blurb}</small>
                                    </span>
                                </label>
                            `).join('')}
                        </div>
                    </section>

                    <section class="rules-cluster scoring-cluster">
                        <div class="cluster-head">
                            <div>
                                <p class="eyebrow">SCORING</p>
                                <h3>Point sources</h3>
                            </div>
                            <p class="field-help compact-help">Tick what counts, then tune the values.</p>
                        </div>
                        <div class="scoring-rules-grid compact-scoring-grid">
                            <label class="rule-row" for="scoringDamageToggle">
                                <span class="rule-toggle"><input id="scoringDamageToggle" type="checkbox" checked /> Damage</span>
                                <span class="rule-value"><input id="scoringDamageValue" class="pixel-input compact-input" type="number" min="0" max="20" step="1" value="1" /> per point</span>
                            </label>
                            <label class="rule-row" for="scoringKillsToggle">
                                <span class="rule-toggle"><input id="scoringKillsToggle" type="checkbox" checked /> Kills</span>
                                <span class="rule-value"><input id="scoringKillValue" class="pixel-input compact-input" type="number" min="0" max="5000" step="10" value="50" /> per kill</span>
                            </label>
                            <label class="rule-row span-2" for="scoringPlacementToggle">
                                <span class="rule-toggle"><input id="scoringPlacementToggle" type="checkbox" checked /> Placement</span>
                                <span class="rule-value placement-values">
                                    <span><input id="scoringFirstValue" class="pixel-input compact-input placement-input" type="number" min="0" max="10000" step="10" value="100" /> first</span>
                                    <span><input id="scoringSecondValue" class="pixel-input compact-input placement-input" type="number" min="0" max="10000" step="10" value="50" /> second</span>
                                    <span><input id="scoringThirdValue" class="pixel-input compact-input placement-input" type="number" min="0" max="10000" step="10" value="25" /> third</span>
                                </span>
                            </label>
                        </div>
                    </section>
                </div>
            </section>

            <section id="lobbyPanel" class="pixel-panel lobby-panel hidden">
                <div class="lobby-header">
                    <div>
                        <p id="lobbyEyebrow" class="eyebrow">NO ACTIVE LOBBY</p>
                        <h2 id="lobbyTitle">Stand by</h2>
                    </div>
                    <button id="btnLeaveLobby" class="pixel-button ghost">Leave Lobby</button>
                </div>
                <p id="lobbyStatus" class="lobby-status">Host, join, or create a local lobby to begin.</p>
                <div id="lobbyRoster" class="lobby-roster"></div>
            </section>
        </section>

        <section id="gameScreen" class="screen game-screen hidden">
            <div class="game-topbar pixel-panel compact-livebar">
                <div class="livebar-brand">
                    <p class="eyebrow">MATCH LIVE</p>
                    <h2>FreeMortar Arena</h2>
                </div>
                <div class="audio-controls compact-audio">
                    <button id="btnHelpGame" class="info-chip" type="button">i</button>
                    <button id="btnMuteGame" class="pixel-button ghost">Audio On</button>
                    <button id="btnMusicGame" class="pixel-button ghost">Music On</button>
                    <label class="volume-stack compact" for="volumeRangeGame">
                        <span class="field-label compact">Volume</span>
                        <input id="volumeRangeGame" class="volume-range" type="range" min="0" max="100" value="72" />
                    </label>
                    <button id="btnLeaveMatch" class="pixel-button ghost">Leave Match</button>
                </div>
            </div>

            <div class="game-status-row compact-hud-row">
                <section class="pixel-panel hud-card pilot-card-live">
                    <h3 id="hudPilot">No active pilot</h3>
                    <div class="health-meter shield-meter"><div class="health-bar shield-bar"><span id="hudShieldFill"></span></div></div>
                    <div class="health-meter"><div class="health-bar"><span id="hudHealthFill"></span></div></div>
                </section>
                <section class="pixel-panel hud-card arsenal-card compact-arsenal-card">
                    <select id="weaponSelect" class="pixel-select compact"></select>
                    <p id="hudWeapon" class="hud-subline">Ammo | Blast | Damage</p>
                </section>
                <section class="pixel-panel hud-card charge-card">
                    <div class="power-meter compact-power-meter">
                        <div class="power-bar"><span id="hudPowerFill"></span></div>
                        <p id="hudPowerLabel" class="hud-subline">Charge</p>
                        <p id="hudAngle" class="hud-subline">Angle</p>
                    </div>
                </section>
                <section class="pixel-panel hud-card conditions-card compact-conditions-card">
                    <h3 id="hudWind">Wind</h3>
                    <p id="hudCampaign" class="hud-subline">Round status</p>
                </section>
            </div>

            <div class="arena-layout">
                <div class="arena-main">
                    <div class="canvas-frame pixel-panel">
                        <canvas id="gameCanvas" width="${LOGICAL_WIDTH}" height="${LOGICAL_HEIGHT}"></canvas>
                    </div>
                </div>

                <section class="pixel-panel hud-card scoreboard-card compact-scoreboard-card">
                    <p class="eyebrow board-title">Battle Board</p>
                    <div class="board-header compact-board-header">
                        <div class="board-tabs">
                            <button id="boardTabBattle" class="board-tab active" type="button">Battle</button>
                            <button id="boardTabCampaign" class="board-tab" type="button">Campaign</button>
                        </div>
                    </div>
                    <div class="board-layout compact-board-layout">
                        <div id="scoreboard" class="scoreboard"></div>
                    </div>
                </section>
            </div>
            <section id="intermissionScreen" class="pixel-panel intermission-screen hidden"></section>
        </section>
    </div>
`;
const audio = new AudioManager();
const menuScreen = mustElement<HTMLElement>('menuScreen');
const gameScreen = mustElement<HTMLElement>('gameScreen');
const intermissionScreen = mustElement<HTMLElement>('intermissionScreen');
const canvas = mustElement<HTMLCanvasElement>('gameCanvas');
const playerNameInput = mustElement<HTMLInputElement>('playerName');
const playerLoadoutSelect = mustElement<HTMLSelectElement>('playerLoadout');
const playerColorPicker = mustElement<HTMLElement>('playerColorPicker');
const loadoutDescription = mustElement<HTMLElement>('loadoutDescription');
const battleSetupPanel = mustElement<HTMLElement>('battleSetupPanel');
const battleSetupTitle = mustElement<HTMLElement>('battleSetupTitle');
const battleSetupLead = mustElement<HTMLElement>('battleSetupLead');
const btnBattleSetupBack = mustElement<HTMLButtonElement>('btnBattleSetupBack');
const btnBattleSetupConfirm = mustElement<HTMLButtonElement>('btnBattleSetupConfirm');
const powerRuleSelect = mustElement<HTMLSelectElement>('powerRule');
const windModeSelect = mustElement<HTMLSelectElement>('windMode');
const windMaxSelect = mustElement<HTMLSelectElement>('windMax');
const terrainThemeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="terrainThemePool"]'));
const roundCountInput = mustElement<HTMLInputElement>('roundCount');
const roundOrderSelect = mustElement<HTMLSelectElement>('roundOrder');
const weaponCostMultiplierInput = mustElement<HTMLInputElement>('weaponCostMultiplier');
const scoringDamageToggle = mustElement<HTMLInputElement>('scoringDamageToggle');
const scoringDamageValue = mustElement<HTMLInputElement>('scoringDamageValue');
const scoringKillsToggle = mustElement<HTMLInputElement>('scoringKillsToggle');
const scoringKillValue = mustElement<HTMLInputElement>('scoringKillValue');
const scoringPlacementToggle = mustElement<HTMLInputElement>('scoringPlacementToggle');
const scoringFirstValue = mustElement<HTMLInputElement>('scoringFirstValue');
const scoringSecondValue = mustElement<HTMLInputElement>('scoringSecondValue');
const scoringThirdValue = mustElement<HTMLInputElement>('scoringThirdValue');
const terrainCollapseInput = mustElement<HTMLInputElement>('terrainCollapse');
const volumeRangeMenu = mustElement<HTMLInputElement>('volumeRangeMenu');
const volumeRangeGame = mustElement<HTMLInputElement>('volumeRangeGame');
const roomCodeInput = mustElement<HTMLInputElement>('roomCode');
const localPlayerCount = mustElement<HTMLSelectElement>('localPlayerCount');
const lobbyPanel = mustElement<HTMLElement>('lobbyPanel');
const lobbyEyebrow = mustElement<HTMLElement>('lobbyEyebrow');
const lobbyTitle = mustElement<HTMLElement>('lobbyTitle');
const lobbyStatus = mustElement<HTMLElement>('lobbyStatus');
const lobbyRoster = mustElement<HTMLElement>('lobbyRoster');
const btnHost = mustElement<HTMLButtonElement>('btnHost');
const btnJoin = mustElement<HTMLButtonElement>('btnJoin');
const btnLocal = mustElement<HTMLButtonElement>('btnLocal');
const btnReady = mustElement<HTMLButtonElement>('btnReady');
const btnLeaveLobby = mustElement<HTMLButtonElement>('btnLeaveLobby');
const btnLeaveMatch = mustElement<HTMLButtonElement>('btnLeaveMatch');
const btnMuteMenu = mustElement<HTMLButtonElement>('btnMuteMenu');
const btnMusicMenu = mustElement<HTMLButtonElement>('btnMusicMenu');
const btnMuteGame = mustElement<HTMLButtonElement>('btnMuteGame');
const btnMusicGame = mustElement<HTMLButtonElement>('btnMusicGame');
const btnHelpGame = mustElement<HTMLButtonElement>('btnHelpGame');
const hudPilot = mustElement<HTMLElement>('hudPilot');
const hudShieldFill = mustElement<HTMLElement>('hudShieldFill');
const hudHealthFill = mustElement<HTMLElement>('hudHealthFill');
const hudWeapon = mustElement<HTMLElement>('hudWeapon');
const hudPowerFill = mustElement<HTMLElement>('hudPowerFill');
const hudAngle = mustElement<HTMLElement>('hudAngle');
const hudPowerLabel = mustElement<HTMLElement>('hudPowerLabel');
const hudWind = mustElement<HTMLElement>('hudWind');
const hudCampaign = mustElement<HTMLElement>('hudCampaign');
const weaponSelect = mustElement<HTMLSelectElement>('weaponSelect');
const scoreboard = mustElement<HTMLElement>('scoreboard');
const boardTabBattle = mustElement<HTMLButtonElement>('boardTabBattle');
const boardTabCampaign = mustElement<HTMLButtonElement>('boardTabCampaign');

let selectedColor: string = COLOR_OPTIONS[0];
let lobbyMode: LobbyMode = 'idle';
let lobbyPlayers: LobbyPlayer[] = [];
let localLobbyPlayers: LobbyPlayer[] = [];
let network: Network | null = null;
let game: Game | null = null;
let campaignPlayers: CampaignPlayer[] = [];
let currentSettings: MatchSettings = { ...DEFAULT_SETTINGS, terrainThemes: [...DEFAULT_SETTINGS.terrainThemes], scoring: { ...DEFAULT_SETTINGS.scoring } };
let currentRound = 1;
let intermissionStage: IntermissionStage = 'hidden';
let latestRoundSummary: RoundSummary | null = null;
let campaignComplete = false;
let startTimer: number | null = null;
let shopStartTimer: number | null = null;
let activeBoardTab: 'battle' | 'campaign' = 'battle';
let latestHudSnapshot: HudSnapshot | null = null;
let currentHintLabel = 'Arrow left and right aim, arrow up and down change power, hold Ctrl for fine adjustment, and space fires.';
let localShopCursor = 0;
let shopSelection: ShopSelection | null = null;
let shopScrollTop = { stock: 0, market: 0 };
let pendingSetupMode: SetupLaunchMode | null = null;
playerNameInput.value = 'Pilot One';
roomCodeInput.value = '';
powerRuleSelect.value = DEFAULT_SETTINGS.powerRule;
terrainThemeInputs.forEach((input) => { input.checked = DEFAULT_SETTINGS.terrainThemes.includes(input.value as TerrainTheme); });
windModeSelect.value = DEFAULT_SETTINGS.windMode;
windMaxSelect.value = `${DEFAULT_SETTINGS.maxWind}`;
roundCountInput.value = `${DEFAULT_SETTINGS.rounds}`;
roundOrderSelect.value = DEFAULT_SETTINGS.roundOrder;
weaponCostMultiplierInput.value = `${DEFAULT_SETTINGS.weaponCostMultiplier}`;
scoringDamageToggle.checked = DEFAULT_SETTINGS.scoring.awardDamage;
scoringDamageValue.value = `${DEFAULT_SETTINGS.scoring.damagePointValue}`;
scoringKillsToggle.checked = DEFAULT_SETTINGS.scoring.awardKills;
scoringKillValue.value = `${DEFAULT_SETTINGS.scoring.killPointValue}`;
scoringPlacementToggle.checked = DEFAULT_SETTINGS.scoring.awardPlacement;
scoringFirstValue.value = `${DEFAULT_SETTINGS.scoring.firstPlacePoints}`;
scoringSecondValue.value = `${DEFAULT_SETTINGS.scoring.secondPlacePoints}`;
scoringThirdValue.value = `${DEFAULT_SETTINGS.scoring.thirdPlacePoints}`;
terrainCollapseInput.checked = DEFAULT_SETTINGS.terrainCollapse;
volumeRangeMenu.value = `${Math.round(audio.currentVolume * 100)}`;
volumeRangeGame.value = volumeRangeMenu.value;
audio.setVolume(audio.currentVolume);

Object.entries(LOADOUTS).forEach(([value, loadout]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = loadout.name;
    playerLoadoutSelect.appendChild(option);
});
playerLoadoutSelect.value = 'balanced';

for (let count = 2; count <= MAX_PLAYERS; count += 1) {
    const option = document.createElement('option');
    option.value = `${count}`;
    option.textContent = `${count}`;
    localPlayerCount.appendChild(option);
}
localPlayerCount.value = '2';

renderColorPicker();
renderLoadoutDescription();
updateReadyButton();
syncMatchSettingsAvailability();
resetHud();
updateAudioControls();
audio.startMusic();

playerColorPicker.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-color]');
    if (!button) return;
    selectedColor = button.dataset.color ?? selectedColor;
    renderColorPicker();
    handleProfileChanged();
});
playerNameInput.addEventListener('input', handleProfileChanged);
playerLoadoutSelect.addEventListener('change', () => {
    renderLoadoutDescription();
    handleProfileChanged();
});
roomCodeInput.addEventListener('input', () => {
    roomCodeInput.value = roomCodeInput.value.toUpperCase();
});
weaponSelect.addEventListener('change', () => {
    game?.selectWeapon(Number(weaponSelect.value));
});
volumeRangeMenu.addEventListener('input', syncVolumeFromControls);
volumeRangeGame.addEventListener('input', syncVolumeFromControls);
btnMuteMenu.addEventListener('click', async () => { await audio.unlock(); audio.setMuted(!audio.muted); updateAudioControls(); });
btnMuteGame.addEventListener('click', async () => { await audio.unlock(); audio.setMuted(!audio.muted); updateAudioControls(); });
btnMusicMenu.addEventListener('click', async () => { await audio.unlock(); audio.setMusicMuted(!audio.musicOnlyMuted); updateAudioControls(); });
btnMusicGame.addEventListener('click', async () => { await audio.unlock(); audio.setMusicMuted(!audio.musicOnlyMuted); updateAudioControls(); });
btnHelpGame.addEventListener('click', () => { window.alert(currentHintLabel); });
[scoringDamageToggle, scoringKillsToggle, scoringPlacementToggle].forEach((input) => {
    input.addEventListener('change', () => {
        syncMatchSettingsAvailability();
    });
});
terrainThemeInputs.forEach((input) => {
    input.addEventListener('change', () => {
        if (!terrainThemeInputs.some((entry) => entry.checked)) input.checked = true;
    });
});

btnHost.addEventListener('click', async () => {
    await audio.unlock();
    openBattleSetup('online-host');
});
btnJoin.addEventListener('click', async () => {
    await audio.unlock();
    closeBattleSetup();
    const roomCode = roomCodeInput.value.trim().toUpperCase();
    if (!roomCode) {
        window.alert('Enter a room code first.');
        return;
    }
    btnHost.disabled = true;
    btnJoin.disabled = true;
    try {
        network?.destroy();
        network = new Network();
        bindNetwork(network);
        await network.joinGame(roomCode, readProfileForm());
        lobbyMode = 'online-client';
        syncMatchSettingsAvailability();
        lobbyPanel.classList.remove('hidden');
        lobbyStatus.textContent = `Connected to room ${roomCode}. Waiting for the host and other pilots.`;
        renderLobby();
        updateReadyButton();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to join the room.';
        window.alert('Unable to join the room. ' + message);
    } finally {
        btnHost.disabled = false;
        btnJoin.disabled = false;
    }
});

btnLocal.addEventListener('click', async () => {
    await audio.unlock();
    openBattleSetup('local');
});
btnBattleSetupBack.addEventListener('click', closeBattleSetup);
btnBattleSetupConfirm.addEventListener('click', async () => {
    await audio.unlock();
    await confirmBattleSetup();
});
btnReady.addEventListener('click', async () => {
    await audio.unlock();
    if (!network || lobbyMode === 'idle' || lobbyMode === 'local') return;
    const activeNetwork = network;
    const localPlayer = lobbyPlayers.find((player) => player.id === activeNetwork.myId);
    activeNetwork.setReady(!(localPlayer?.ready ?? false));
    audio.playReady();
});

btnLeaveLobby.addEventListener('click', leaveLobby);
btnLeaveMatch.addEventListener('click', leaveMatch);
intermissionScreen.addEventListener('click', handleIntermissionClick);
window.addEventListener('keydown', handleShopKeydown);
boardTabBattle.addEventListener('click', () => { activeBoardTab = 'battle'; syncBoardTabs(); if (latestHudSnapshot) renderBoard(latestHudSnapshot); });
boardTabCampaign.addEventListener('click', () => { activeBoardTab = 'campaign'; syncBoardTabs(); if (latestHudSnapshot) renderBoard(latestHudSnapshot); });

window.addEventListener('beforeunload', () => {
    game?.stop();
    network?.destroy();
    audio.dispose();
});

function mustElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing required element: ${id}`);
    return element as T;
}

function syncVolumeFromControls(event: Event) {
    const value = Number((event.target as HTMLInputElement).value);
    volumeRangeMenu.value = `${value}`;
    volumeRangeGame.value = `${value}`;
    audio.setVolume(value / 100);
    updateAudioControls();
}

function readProfileForm(): LocalProfile {
    return {
        name: playerNameInput.value.trim() || 'Pilot One',
        color: selectedColor,
        loadout: playerLoadoutSelect.value as LoadoutId
    };
}

function readMatchSettingsForm(): MatchSettings {
    return {
        windMode: windModeSelect.value as WindMode,
        maxWind: Number(windMaxSelect.value),
        terrainThemes: terrainThemeInputs.filter((input) => input.checked).map((input) => input.value as TerrainTheme).length ? terrainThemeInputs.filter((input) => input.checked).map((input) => input.value as TerrainTheme) : [...DEFAULT_SETTINGS.terrainThemes],
        terrainCollapse: terrainCollapseInput.checked,
        powerRule: powerRuleSelect.value as PowerRule,
        rounds: clampSetting(Number(roundCountInput.value), 1, 99, DEFAULT_SETTINGS.rounds),
        roundOrder: roundOrderSelect.value as RoundOrderMode,
        scoring: readScoringSettingsForm(),
        weaponCostMultiplier: clampSetting(Number(weaponCostMultiplierInput.value), 0.25, 5, DEFAULT_SETTINGS.weaponCostMultiplier)
    };
}

function readScoringSettingsForm(): ScoringSettings {
    return {
        awardDamage: scoringDamageToggle.checked,
        damagePointValue: clampSetting(Number(scoringDamageValue.value), 0, 20, DEFAULT_SCORING.damagePointValue),
        awardKills: scoringKillsToggle.checked,
        killPointValue: clampSetting(Number(scoringKillValue.value), 0, 5000, DEFAULT_SCORING.killPointValue),
        awardPlacement: scoringPlacementToggle.checked,
        firstPlacePoints: clampSetting(Number(scoringFirstValue.value), 0, 10000, DEFAULT_SCORING.firstPlacePoints),
        secondPlacePoints: clampSetting(Number(scoringSecondValue.value), 0, 10000, DEFAULT_SCORING.secondPlacePoints),
        thirdPlacePoints: clampSetting(Number(scoringThirdValue.value), 0, 10000, DEFAULT_SCORING.thirdPlacePoints)
    };
}

function cloneMatchSettings(settings: MatchSettings): MatchSettings {
    return {
        ...settings,
        terrainThemes: [...settings.terrainThemes],
        scoring: { ...settings.scoring }
    };
}

function openBattleSetup(mode: SetupLaunchMode) {
    pendingSetupMode = mode;
    battleSetupPanel.classList.remove('hidden');
    battleSetupTitle.textContent = mode === 'online-host' ? 'Host Match Rules' : 'Local Match Rules';
    battleSetupLead.textContent = mode === 'online-host'
        ? 'Tune the room rules, terrain pool, and scoring, then create the room.'
        : 'Tune the local rules, terrain pool, and scoring, then create the skirmish lobby.';
    btnBattleSetupConfirm.textContent = mode === 'online-host' ? 'Create Room' : 'Create Local Lobby';
    btnHost.classList.toggle('active', mode === 'online-host');
    btnLocal.classList.toggle('active', mode === 'local');
    battleSetupPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function closeBattleSetup() {
    pendingSetupMode = null;
    battleSetupPanel.classList.add('hidden');
    btnHost.classList.remove('active');
    btnLocal.classList.remove('active');
}

async function confirmBattleSetup() {
    if (pendingSetupMode === 'online-host') {
        await createHostedLobby();
        return;
    }
    if (pendingSetupMode === 'local') {
        await createLocalLobby();
    }
}

async function createHostedLobby() {
    btnHost.disabled = true;
    btnJoin.disabled = true;
    btnBattleSetupConfirm.disabled = true;
    try {
        network?.destroy();
        network = new Network();
        bindNetwork(network);
        const roomCode = await network.hostGame(readProfileForm());
        lobbyMode = 'online-host';
        currentSettings = cloneMatchSettings(readMatchSettingsForm());
        syncMatchSettingsAvailability();
        lobbyStatus.textContent = `Room ${roomCode} is live. Share the code and wait for everyone to ready up.`;
        lobbyPanel.classList.remove('hidden');
        renderLobby();
        updateReadyButton();
        closeBattleSetup();
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to create the room.';
        window.alert('Unable to create the room. ' + message);
    } finally {
        btnHost.disabled = false;
        btnJoin.disabled = false;
        btnBattleSetupConfirm.disabled = false;
    }
}

async function createLocalLobby() {
    network?.destroy();
    network = null;
    lobbyMode = 'local';
    currentSettings = cloneMatchSettings(readMatchSettingsForm());
    syncMatchSettingsAvailability();
    localLobbyPlayers = createLocalLobbyPlayers(Number(localPlayerCount.value));
    lobbyPanel.classList.remove('hidden');
    lobbyStatus.textContent = 'Edit each local pilot, lock them in, and the match will start automatically.';
    updateReadyButton();
    renderLobby();
    closeBattleSetup();
}

function updateAudioControls() {
    const audioLabel = audio.muted ? 'Audio Off' : 'Audio On';
    const musicLabel = audio.musicOnlyMuted ? 'Music Off' : 'Music On';
    btnMuteMenu.textContent = audioLabel;
    btnMuteGame.textContent = audioLabel;
    btnMusicMenu.textContent = musicLabel;
    btnMusicGame.textContent = musicLabel;
}

function renderColorPicker() {
    playerColorPicker.innerHTML = COLOR_OPTIONS.map((color) => `
        <button type="button" class="color-swatch ${selectedColor === color ? 'active' : ''}" data-color="${color}" style="--swatch:${color}" aria-label="Select ${color}"></button>
    `).join('');
}

function renderLoadoutDescription() {
    loadoutDescription.textContent = LOADOUTS[playerLoadoutSelect.value as LoadoutId].description;
}

function handleProfileChanged() {
    if (lobbyMode === 'online-host' || lobbyMode === 'online-client') {
        const profile = readProfileForm();
        network?.updateLocalPlayer(profile);
        const localPlayer = lobbyPlayers.find((player) => player.id === network?.myId);
        if (localPlayer?.ready) network?.setReady(false);
    }
}

function bindNetwork(activeNetwork: Network) {
    activeNetwork.onLobbyState = (players, roomCode) => {
        lobbyPlayers = players;
        lobbyPanel.classList.remove('hidden');
        lobbyStatus.textContent = `Room ${roomCode} has ${players.length} pilot${players.length === 1 ? '' : 's'}.`;
        renderLobby();
        updateReadyButton();
        scheduleAutoStartIfReady();
    };

    activeNetwork.onGameStart = (payload) => {
        currentSettings = { ...payload.settings, terrainThemes: [...payload.settings.terrainThemes], scoring: { ...payload.settings.scoring } };
        currentRound = payload.roundNumber;
        campaignPlayers = payload.players.map((player) => ({
            id: player.id,
            name: player.name,
            color: player.color,
            loadout: player.loadout,
            isHost: player.id === 'host',
            weapons: (player.weapons ?? createWeaponsForLoadout(player.loadout)).map((weapon) => ({ ...weapon })),
            shield: player.shield ?? campaignPlayers.find((entry) => entry.id === player.id)?.shield ?? 0,
            credits: campaignPlayers.find((entry) => entry.id === player.id)?.credits ?? 0,
            shopReady: false,
            stats: payload.campaignStats.find((entry) => entry.id === player.id) ?? createEmptyStats(player.id)
        }));
        launchMatch(payload, activeNetwork);
    };

    activeNetwork.onStatus = (message) => {
        lobbyStatus.textContent = message;
    };
}
function renderLobby() {
    cancelScheduledStart();
    if (lobbyMode === 'idle') {
        lobbyPanel.classList.add('hidden');
        return;
    }
    lobbyPanel.classList.remove('hidden');
    if (lobbyMode === 'local') {
        renderLocalLobby();
        scheduleAutoStartIfReady();
        return;
    }

    lobbyEyebrow.textContent = lobbyMode === 'online-host' ? 'ONLINE HOST LOBBY' : 'ONLINE CLIENT LOBBY';
    lobbyTitle.textContent = network ? `Room ${network.roomCode}` : 'Online Lobby';
    lobbyRoster.innerHTML = lobbyPlayers.map((player) => `
        <article class="pilot-card ${player.ready ? 'ready' : ''}">
            <div class="pilot-row">
                <span class="pilot-chip" style="--chip:${player.color}"></span>
                <div>
                    <h3>${escapeHtml(player.name)}</h3>
                    <p>${LOADOUTS[player.loadout].name} ${player.isHost ? '// HOST' : ''}</p>
                </div>
            </div>
            <div class="status-tag ${player.ready ? 'ready' : ''}">${player.ready ? 'READY' : 'TUNING'}</div>
        </article>
    `).join('');
}

function renderLocalLobby() {
    lobbyEyebrow.textContent = 'LOCAL SKIRMISH';
    lobbyTitle.textContent = `Local Lobby (${localLobbyPlayers.length} pilots)`;
    lobbyRoster.innerHTML = localLobbyPlayers.map((player) => `
        <article class="pilot-card editable ${player.ready ? 'ready' : ''}" data-player-id="${player.id}">
            <div class="pilot-row">
                <span class="pilot-chip" style="--chip:${player.color}"></span>
                <div>
                    <h3>Local Pilot</h3>
                    <p>${LOADOUTS[player.loadout].name}</p>
                </div>
            </div>
            <label class="field-label compact" for="name-${player.id}">Name</label>
            <input id="name-${player.id}" class="pixel-input compact" data-role="name" value="${escapeAttribute(player.name)}" maxlength="16" />
            <label class="field-label compact">Color</label>
            <div class="color-grid compact">
                ${COLOR_OPTIONS.map((color) => `<button type="button" class="color-swatch ${player.color === color ? 'active' : ''}" data-role="color" data-color="${color}" style="--swatch:${color}"></button>`).join('')}
            </div>
            <label class="field-label compact" for="loadout-${player.id}">Loadout</label>
            <select id="loadout-${player.id}" class="pixel-select compact" data-role="loadout">
                ${Object.entries(LOADOUTS).map(([value, loadout]) => `<option value="${value}" ${player.loadout === value ? 'selected' : ''}>${loadout.name}</option>`).join('')}
            </select>
            <button class="pixel-button ${player.ready ? 'secondary' : 'primary'}" data-role="toggle-ready">${player.ready ? 'Ready' : 'Lock In'}</button>
        </article>
    `).join('');

    lobbyRoster.querySelectorAll<HTMLElement>('[data-player-id]').forEach((card) => {
        const playerId = card.dataset.playerId;
        if (!playerId) return;
        const player = localLobbyPlayers.find((entry) => entry.id === playerId);
        if (!player) return;

        const nameInput = card.querySelector<HTMLInputElement>('[data-role="name"]');
        nameInput?.addEventListener('input', () => {
            player.name = nameInput.value.trim() || 'Pilot';
            player.ready = false;
            renderLocalLobby();
        });

        const loadoutSelect = card.querySelector<HTMLSelectElement>('[data-role="loadout"]');
        loadoutSelect?.addEventListener('change', () => {
            player.loadout = loadoutSelect.value as LoadoutId;
            player.ready = false;
            renderLocalLobby();
        });

        card.querySelectorAll<HTMLButtonElement>('[data-role="color"]').forEach((button) => {
            button.addEventListener('click', () => {
                player.color = button.dataset.color ?? player.color;
                player.ready = false;
                renderLocalLobby();
            });
        });

        const readyButton = card.querySelector<HTMLButtonElement>('[data-role="toggle-ready"]');
        readyButton?.addEventListener('click', () => {
            player.ready = !player.ready;
            audio.playReady();
            renderLocalLobby();
        });
    });

    scheduleAutoStartIfReady();
}

function createLocalLobbyPlayers(count: number): LobbyPlayer[] {
    const profile = readProfileForm();
    return Array.from({ length: count }, (_, index) => ({
        id: `local-${index + 1}`,
        name: index === 0 ? profile.name : `Pilot ${index + 1}`,
        color: index === 0 ? profile.color : COLOR_OPTIONS[index % COLOR_OPTIONS.length],
        loadout: index === 0 ? profile.loadout : 'balanced',
        ready: false,
        isHost: index === 0
    }));
}

function scheduleAutoStartIfReady() {
    cancelScheduledStart();
    if (lobbyMode === 'online-host' && network && lobbyPlayers.length >= 2 && lobbyPlayers.every((player) => player.ready)) {
        lobbyStatus.textContent = 'All online pilots are ready. Launching match...';
        const activeNetwork = network;
        startTimer = window.setTimeout(() => startCampaign(lobbyPlayers.map(toCampaignPlayer), activeNetwork), 900);
    }
    if (lobbyMode === 'local' && localLobbyPlayers.length >= 2 && localLobbyPlayers.every((player) => player.ready)) {
        lobbyStatus.textContent = 'All local pilots are locked in. Launching match...';
        startTimer = window.setTimeout(() => startCampaign(localLobbyPlayers.map(toCampaignPlayer), null), 700);
    }
}

function cancelScheduledStart() {
    if (startTimer !== null) {
        window.clearTimeout(startTimer);
        startTimer = null;
    }
    if (shopStartTimer !== null) {
        window.clearTimeout(shopStartTimer);
        shopStartTimer = null;
    }
}

function startCampaign(players: CampaignPlayer[], activeNetwork: Network | null) {
    campaignPlayers = players.map((player) => ({ ...player, weapons: player.weapons.map((weapon) => ({ ...weapon })), shopReady: false, credits: 0 }));
    currentSettings = cloneMatchSettings(readMatchSettingsForm());
    currentRound = 1;
    campaignComplete = false;
    latestRoundSummary = null;
    localShopCursor = 0;
    shopSelection = null;
    intermissionStage = 'hidden';
    renderIntermission();
    const payload = buildMatchPayload(campaignPlayers, currentRound, currentSettings);
    if (activeNetwork?.role === 'host') {
        activeNetwork.broadcastStart(payload);
    }
    launchMatch(payload, activeNetwork);
}

function buildMatchPayload(players: CampaignPlayer[], roundNumber: number, settings: MatchSettings): MatchStartPayload {
    const seed = Math.floor(Math.random() * 0x7fffffff);
    const orderedPlayers = orderPlayersForRound(players, settings, roundNumber, seed);
    return {
        seed,
        players: orderedPlayers.map(toPlayerSetup),
        currentPlayerIndex: 0,
        wind: buildInitialWind(seed, settings),
        turnNumber: 1,
        roundNumber,
        settings,
        campaignStats: orderedPlayers.map((player) => ({ ...player.stats }))
    };
}
function buildInitialWind(seed: number, settings: MatchSettings) {
    if (settings.windMode === 'disabled') return 0;
    return ((((seed % 1000) / 1000) - 0.5) * 2) * settings.maxWind;
}

function orderPlayersForRound(players: CampaignPlayer[], settings: MatchSettings, roundNumber: number, seed: number) {
    const ordered = players.map((player) => ({ ...player, weapons: player.weapons.map((weapon) => ({ ...weapon })) }));
    switch (settings.roundOrder) {
        case 'random':
            return ordered.sort((left, right) => seededOrderValue(left.id, roundNumber, seed) - seededOrderValue(right.id, roundNumber, seed));
        case 'winning_order':
            return ordered.sort((left, right) => right.stats.score - left.stats.score || right.stats.roundWins - left.stats.roundWins || right.stats.totalDamage - left.stats.totalDamage);
        case 'reverse_winning_order':
            return ordered.sort((left, right) => left.stats.score - right.stats.score || left.stats.roundWins - right.stats.roundWins || left.stats.totalDamage - right.stats.totalDamage);
        default:
            return ordered;
    }
}

function seededOrderValue(playerId: string, roundNumber: number, seed: number) {
    return playerId.split('').reduce((sum, char) => ((sum * 33) ^ char.charCodeAt(0)) >>> 0, (seed ^ roundNumber) >>> 0);
}

function launchMatch(payload: MatchStartPayload, activeNetwork: Network | null) {
    cancelScheduledStart();
    menuScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
    intermissionStage = 'hidden';
    renderIntermission();
    resetHud();
    updateAudioControls();
    game?.stop();
    game = new Game(canvas, {
        ...payload,
        localPlayerId: activeNetwork?.myId ?? payload.players[0].id,
        network: activeNetwork,
        audio,
        onHudUpdate: updateGameHud,
        onRoundEnd: handleRoundEnd
    });
    game.start();
}
function handleRoundEnd(summary: RoundSummary) {
    game?.stop();
    game = null;
    latestRoundSummary = summary;
    currentRound = summary.roundNumber;
    campaignComplete = currentRound >= currentSettings.rounds;
    localShopCursor = 0;
    shopSelection = null;

    campaignPlayers = campaignPlayers.map((player) => {
        const roundPlayer = summary.players.find((entry) => entry.id === player.id);
        if (!roundPlayer) return player;
        const gainedCredits = !network || network.role === 'host'
            ? player.credits + ROUND_SHOP_BASE_CREDITS + calculateRoundCreditGain(summary, player.id, currentSettings)
            : player.credits;
        return {
            ...player,
            weapons: roundPlayer.weapons.map((weapon) => ({ ...weapon })),
            shield: roundPlayer.shield,
            stats: { ...roundPlayer.stats },
            credits: gainedCredits,
            shopReady: false
        };
    });

    if (!network || network.role === 'host') {
        broadcastShopSync();
    }

    bindIntermissionMessages();
    intermissionStage = 'victory';
    renderIntermission();
}
function bindIntermissionMessages() {
    if (!network) return;
    network.onGameMessage = (message) => {
        handleIntermissionMessage(message);
    };
}

function handleIntermissionMessage(message: GameMessage) {
    switch (message.kind) {
        case 'SHOP_SYNC':
            campaignPlayers = message.players.map((player) => {
                const existing = campaignPlayers.find((entry) => entry.id === player.id);
                return {
                    id: player.id,
                    name: existing?.name ?? player.id,
                    color: existing?.color ?? '#fff4d7',
                    loadout: existing?.loadout ?? 'balanced',
                    isHost: existing?.isHost ?? false,
                    weapons: player.weapons.map((weapon) => ({ ...weapon })),
                    shield: player.shield,
                    credits: player.credits,
                    shopReady: player.shopReady,
                    stats: { ...player.stats }
                };
            });
            campaignComplete = message.campaignComplete;
            renderIntermission();
            break;
        case 'SHOP_UPDATE':
            if (!network || network.role !== 'host') return;
            campaignPlayers = campaignPlayers.map((player) => player.id === message.playerId ? {
                ...player,
                credits: message.credits,
                shopReady: message.shopReady,
                shield: message.shield,
                weapons: message.weapons.map((weapon) => ({ ...weapon }))
            } : player);
            broadcastShopSync();
            maybeLaunchNextRound();
            break;
        default:
            break;
    }
}

function broadcastShopSync() {
    if (network?.role === 'host') {
        network.sendGameMessage({
            kind: 'SHOP_SYNC',
            roundNumber: currentRound,
            campaignComplete,
            players: campaignPlayers.map((player) => ({
                id: player.id,
                credits: player.credits,
                shopReady: player.shopReady,
                weapons: player.weapons.map((weapon) => ({ ...weapon })),
                shield: player.shield,
                stats: { ...player.stats }
            }))
        });
    }
}

function handleIntermissionClick(event: MouseEvent) {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'victory-next') {
        intermissionStage = 'stats';
        renderIntermission();
        return;
    }
    if (action === 'stats-next') {
        intermissionStage = 'campaign';
        renderIntermission();
        return;
    }
    if (action === 'campaign-next') {
        if (campaignComplete) {
            leaveMatch();
            return;
        }
        intermissionStage = 'shop';
        renderIntermission();
        return;
    }
    if (action === 'select-weapon') {
        const playerId = button.dataset.playerId;
        const weaponType = button.dataset.weapon as WeaponType | undefined;
        const source = button.dataset.source as ShopSelection['source'] | undefined;
        if (!playerId || !weaponType || !source) return;
        if (!getInteractivePlayerIds().has(playerId)) return;
        shopSelection = { playerId, weaponType, source };
        renderIntermission();
        return;
    }
    if (action === 'buy-selected') {
        if (!shopSelection) return;
        purchaseWeapon(shopSelection.playerId, shopSelection.weaponType);
        return;
    }
    if (action === 'sell-selected') {
        if (!shopSelection) return;
        sellWeapon(shopSelection.playerId, shopSelection.weaponType);
        return;
    }
    if (action === 'toggle-shop-ready') {
        const playerId = button.dataset.playerId;
        if (!playerId) return;
        toggleShopReady(playerId);
    }
}

function purchaseWeapon(playerId: string, weaponType: WeaponType) {
    const price = getWeaponShopPrice(weaponType, currentSettings.weaponCostMultiplier);
    if (price === null) return;
    const localIds = getInteractivePlayerIds();
    if (!localIds.has(playerId)) return;

    campaignPlayers = campaignPlayers.map((player) => {
        if (player.id !== playerId || player.credits < price || player.shopReady) return player;
        return {
            ...player,
            credits: player.credits - price,
            weapons: addWeaponAmmo(player.weapons, weaponType, 1)
        };
    });
    renderIntermission();
    syncShopState(playerId);
}

function sellWeapon(playerId: string, weaponType: WeaponType) {
    const price = getWeaponSellPrice(weaponType, currentSettings.weaponCostMultiplier);
    if (price === null) return;
    const localIds = getInteractivePlayerIds();
    if (!localIds.has(playerId)) return;

    campaignPlayers = campaignPlayers.map((player) => {
        if (player.id !== playerId || player.shopReady) return player;
        const owned = player.weapons.find((weapon) => weapon.type === weaponType);
        if (!owned || owned.ammo <= 0) return player;
        return {
            ...player,
            credits: player.credits + price,
            weapons: removeWeaponAmmo(player.weapons, weaponType, 1)
        };
    });
    renderIntermission();
    syncShopState(playerId);
}

function toggleShopReady(playerId: string) {
    const localIds = getInteractivePlayerIds();
    if (!localIds.has(playerId)) return;
    campaignPlayers = campaignPlayers.map((player) => player.id === playerId ? { ...player, shopReady: !player.shopReady } : player);
    const currentIndex = campaignPlayers.findIndex((player) => player.id === playerId);
    const currentPlayer = campaignPlayers[currentIndex];
    if (!network) {
        if (currentPlayer?.shopReady) {
            const nextIndex = campaignPlayers.findIndex((player, index) => index > currentIndex && !player.shopReady);
            const fallbackIndex = campaignPlayers.findIndex((player) => !player.shopReady);
            localShopCursor = nextIndex >= 0 ? nextIndex : Math.max(0, fallbackIndex);
        } else if (currentIndex >= 0) {
            localShopCursor = currentIndex;
        }
    }
    shopSelection = null;
    renderIntermission();
    syncShopState(playerId);
    maybeLaunchNextRound();
}
function syncShopState(playerId: string) {
    if (!network) return;
    const player = campaignPlayers.find((entry) => entry.id === playerId);
    if (!player) return;
    if (network.role === 'host') {
        broadcastShopSync();
        return;
    }
    network.sendGameMessage({
        kind: 'SHOP_UPDATE',
        playerId,
        credits: player.credits,
        shopReady: player.shopReady,
        weapons: player.weapons.map((weapon) => ({ ...weapon })),
        shield: player.shield
    });
}
function maybeLaunchNextRound() {
    if (campaignComplete) return;
    if (!campaignPlayers.length || !campaignPlayers.every((player) => player.shopReady)) return;
    if (network && network.role === 'client') return;
    shopStartTimer = window.setTimeout(() => {
        currentRound += 1;
        localShopCursor = 0;
        shopSelection = null;
        const payload = buildMatchPayload(campaignPlayers.map((player) => ({ ...player, shopReady: false })), currentRound, currentSettings);
        campaignPlayers = campaignPlayers.map((player) => ({ ...player, shopReady: false }));
        if (network?.role === 'host') network.broadcastStart(payload);
        launchMatch(payload, network);
    }, 700);
}

function getInteractivePlayerIds() {
    if (!network) {
        if (intermissionStage === 'shop') {
            const localPlayer = getLocalShopPlayer();
            return new Set(localPlayer ? [localPlayer.id] : []);
        }
        return new Set(campaignPlayers.map((player) => player.id));
    }
    return new Set(network.myId ? [network.myId] : []);
}

function getLocalShopPlayer() {
    if (!campaignPlayers.length) return null;
    const forwardIndex = campaignPlayers.findIndex((player, index) => index >= localShopCursor && !player.shopReady);
    if (forwardIndex >= 0) {
        localShopCursor = forwardIndex;
        return campaignPlayers[forwardIndex] ?? null;
    }
    const firstPending = campaignPlayers.findIndex((player) => !player.shopReady);
    if (firstPending >= 0) {
        localShopCursor = firstPending;
        return campaignPlayers[firstPending] ?? null;
    }
    localShopCursor = Math.max(0, Math.min(localShopCursor, campaignPlayers.length - 1));
    return campaignPlayers[localShopCursor] ?? null;
}

function getShopFocusPlayer() {
    if (!campaignPlayers.length) return null;
    if (!network) return getLocalShopPlayer();
    const localId = network.myId;
    return campaignPlayers.find((player) => player.id === localId) ?? null;
}

function ensureShopSelection(player: CampaignPlayer | null) {
    if (!player) {
        shopSelection = null;
        return null;
    }

    const marketTypes = SHOP_WEAPON_ORDER.filter((type) => getWeaponShopPrice(type, currentSettings.weaponCostMultiplier) !== null);
    const stockTypes = player.weapons.filter((weapon) => weapon.type !== 'cannon' && weapon.ammo > 0).map((weapon) => weapon.type);
    const selectionIsValid = shopSelection?.playerId === player.id && (
        (shopSelection.source === 'market' && marketTypes.includes(shopSelection.weaponType))
        || (shopSelection.source === 'stock' && stockTypes.includes(shopSelection.weaponType))
    );

    if (selectionIsValid) return shopSelection;
    if (marketTypes.length > 0) {
        shopSelection = { playerId: player.id, weaponType: marketTypes[0], source: 'market' };
        return shopSelection;
    }
    if (stockTypes.length > 0) {
        shopSelection = { playerId: player.id, weaponType: stockTypes[0], source: 'stock' };
        return shopSelection;
    }

    shopSelection = null;
    return null;
}

function getShopSelectionPool(player: CampaignPlayer, source: ShopSelection['source']) {
    if (source === 'stock') {
        return player.weapons.filter((weapon) => weapon.type !== 'cannon' && weapon.ammo > 0).map((weapon) => weapon.type);
    }
    return SHOP_WEAPON_ORDER.filter((type) => getWeaponShopPrice(type, currentSettings.weaponCostMultiplier) !== null);
}

function cycleShopSelection(direction: 1 | -1) {
    const player = getShopFocusPlayer();
    const selection = ensureShopSelection(player);
    if (!player || !selection || player.shopReady) return;
    const pool = getShopSelectionPool(player, selection.source);
    if (!pool.length) return;
    const currentIndex = Math.max(0, pool.indexOf(selection.weaponType));
    const nextIndex = (currentIndex + direction + pool.length) % pool.length;
    shopSelection = { ...selection, weaponType: pool[nextIndex] };
    renderIntermission();
}

function handleShopKeydown(event: KeyboardEvent) {
    if (intermissionStage !== 'shop') return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;

    const focusPlayer = getShopFocusPlayer();
    const selection = ensureShopSelection(focusPlayer);
    if (!focusPlayer || !selection || focusPlayer.shopReady) return;

    if (event.key === 'ArrowUp') {
        event.preventDefault();
        cycleShopSelection(-1);
        return;
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        cycleShopSelection(1);
        return;
    }
    if (event.key === ' ' || event.key === 'Enter') {
        event.preventDefault();
        if (selection.source === 'market') {
            purchaseWeapon(selection.playerId, selection.weaponType);
        } else {
            sellWeapon(selection.playerId, selection.weaponType);
        }
    }
}

function renderIntermission() {
    if (intermissionStage === 'hidden' || !latestRoundSummary) {
        intermissionScreen.classList.add('hidden');
        intermissionScreen.innerHTML = '';
        return;
    }
    intermissionScreen.classList.remove('hidden');
    if (intermissionStage === 'victory') {
        renderVictoryScreen();
        return;
    }
    if (intermissionStage === 'stats') {
        renderStatsScreen();
        return;
    }
    if (intermissionStage === 'campaign') {
        renderCampaignScreen();
        return;
    }
    renderShopScreen();
}

function renderVictoryScreen() {
    if (!latestRoundSummary) return;
    const winner = latestRoundSummary.players.find((player) => player.id === latestRoundSummary?.winnerId) ?? null;
    intermissionScreen.innerHTML = `
        <div class="intermission-card victory-card">
            <p class="eyebrow">ROUND COMPLETE</p>
            <h2 style="color:${winner?.color ?? '#fff4d7'}">${escapeHtml(winner?.name ?? 'No one')} Wins</h2>
            <p class="hero-copy">The battlefield settles. Review the round, inspect the campaign race, then rearm for the next drop.</p>
            <div class="victory-strip">${latestRoundSummary.players.map((player) => `<span style="background:${player.color}">${escapeHtml(player.name)}</span>`).join('')}</div>
            <button class="pixel-button primary" data-action="victory-next">Open Round Report</button>
        </div>
    `;
}

function renderStatsScreen() {
    if (!latestRoundSummary) return;
    const rankedPlayers = getRoundRankings(latestRoundSummary.players, latestRoundSummary.winnerId);
    const damageChart = buildConicChart(rankedPlayers.map((player) => ({ color: player.color, value: player.stats.damage })));
    const maxRoundDamage = Math.max(1, ...rankedPlayers.map((player) => player.stats.damage));
    const maxDamageTaken = Math.max(1, ...rankedPlayers.map((player) => player.stats.damageTaken));
    const maxHits = Math.max(1, ...rankedPlayers.map((player) => player.stats.hits));
    const accolades = buildRoundAccolades(rankedPlayers, latestRoundSummary.winnerId);

    intermissionScreen.innerHTML = `
        <div class="intermission-card stats-card deluxe-stats-card">
            <div class="stats-hero-grid round-report-grid">
                <section class="stats-hero-panel round-overview-panel">
                    <p class="eyebrow">DEBRIEF</p>
                    <h2>Round ${currentRound} Report</h2>
                    <div class="round-chart-stack">
                        <div>
                            <p class="eyebrow chart-title">Round Damage</p>
                            <div class="big-chart" style="background:${damageChart}"></div>
                        </div>
                        <div class="chart-legend-list">
                            ${rankedPlayers.map((player) => `
                                <div class="legend-row">
                                    <span class="legend-swatch" style="--swatch:${player.color}"></span>
                                    <span>${escapeHtml(player.name)}</span>
                                    <strong>${player.stats.damage}</strong>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </section>
                <section class="stats-hero-panel round-ranking-panel">
                    <p class="eyebrow">Round Ranking</p>
                    <table class="report-table">
                        <thead>
                            <tr><th>#</th><th>Pilot</th><th>DMG</th><th>KO</th><th>Hits</th><th>Taken</th></tr>
                        </thead>
                        <tbody>
                            ${rankedPlayers.map((player, index) => `
                                <tr>
                                    <td>${index + 1}</td>
                                    <td><span class="table-player" style="--accent:${player.color}">${escapeHtml(player.name)}${player.id === latestRoundSummary?.winnerId ? ' <em>WIN</em>' : ''}</span></td>
                                    <td>${player.stats.damage}</td>
                                    <td>${player.stats.kills}</td>
                                    <td>${player.stats.hits}</td>
                                    <td>${player.stats.damageTaken}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </section>
            </div>
            <section class="accolade-grid">
                ${accolades.map((accolade) => `
                    <article class="accolade-card" style="--accent:${accolade.color}">
                        <p class="eyebrow">${accolade.title}</p>
                        <strong>${escapeHtml(accolade.name)}</strong>
                        <span>${accolade.value}</span>
                    </article>
                `).join('')}
            </section>
            <div class="stats-grid deluxe-stats-grid round-pilot-grid">
                ${rankedPlayers.map((player) => `
                    <article class="stats-pilot deluxe-stats-pilot" style="--accent:${player.color}">
                        <div class="stats-pilot-head">
                            <div>
                                <p class="eyebrow">Pilot Debrief</p>
                                <h3>${escapeHtml(player.name)}</h3>
                            </div>
                            <div class="stats-score-pill">${player.id === latestRoundSummary?.winnerId ? 'Winner' : 'Round'}</div>
                        </div>
                        ${buildStatMeter('Round damage', player.stats.damage, maxRoundDamage, player.color, `${player.stats.damage}`)}
                        ${buildStatMeter('Damage taken', player.stats.damageTaken, maxDamageTaken, player.color, `${player.stats.damageTaken}`)}
                        ${buildStatMeter('Hits landed', player.stats.hits, maxHits, player.color, `${player.stats.hits}`)}
                        <div class="stats-badge-row">
                            <span class="stats-chip hits">${player.stats.hits} hits</span>
                            <span class="stats-chip kills">${player.stats.kills} kills</span>
                            <span class="stats-chip wins">${player.stats.shots} shots</span>
                        </div>
                        <div class="stats-mini-grid">
                            <div><span>Round taken</span><strong>${player.stats.damageTaken}</strong></div>
                            <div><span>Round damage</span><strong>${player.stats.damage}</strong></div>
                            <div><span>Total shots</span><strong>${player.stats.shots}</strong></div>
                            <div><span>Pressure</span><strong>${player.stats.hits + player.stats.kills}</strong></div>
                        </div>
                    </article>
                `).join('')}
            </div>
            <button class="pixel-button primary" data-action="stats-next">Open Campaign Report</button>
        </div>
    `;
}

function renderCampaignScreen() {
    const leaders = [...campaignPlayers].sort((left, right) => right.stats.score - left.stats.score || right.stats.roundWins - left.stats.roundWins || right.stats.totalDamage - left.stats.totalDamage);
    const maxScore = Math.max(1, ...leaders.map((player) => player.stats.score));
    const maxWins = Math.max(1, ...leaders.map((player) => player.stats.roundWins));
    const maxDamage = Math.max(1, ...leaders.map((player) => player.stats.totalDamage));
    const maxTaken = Math.max(1, ...leaders.map((player) => player.stats.totalDamageTaken));
    const scoreShare = buildConicChart(leaders.map((player) => ({ color: player.color, value: player.stats.score })));
    const winShare = buildConicChart(leaders.map((player) => ({ color: player.color, value: player.stats.roundWins })));
    const accolades = buildCampaignAccolades(leaders);

    intermissionScreen.innerHTML = `
        <div class="intermission-card stats-card deluxe-stats-card campaign-report-card">
            <div class="stats-hero-grid campaign-report-grid">
                <section class="stats-hero-panel campaign-ladder-panel">
                    <p class="eyebrow">CAMPAIGN LADDER</p>
                    <h2>Campaign Report</h2>
                    <div class="ladder-list">
                        ${leaders.map((player, index) => `
                            <article class="ladder-row" style="--accent:${player.color}">
                                <div class="ladder-head">
                                    <span class="score-rank">${index + 1}</span>
                                    <strong>${escapeHtml(player.name)}</strong>
                                    <span>${player.stats.score} pts</span>
                                </div>
                                <div class="ladder-track"><span style="width:${Math.max(8, Math.round((player.stats.score / maxScore) * 100))}%"></span></div>
                            </article>
                        `).join('')}
                    </div>
                </section>
                <section class="stats-hero-panel campaign-chart-panel">
                    <p class="eyebrow">Campaign Shape</p>
                    <div class="stats-dual-charts campaign-dual-charts">
                        <div class="chart-cluster compact-chart-cluster vertical-chart-cluster">
                            <p class="eyebrow chart-title">Score Share</p>
                            <div class="big-chart" style="background:${scoreShare}"></div>
                        </div>
                        <div class="chart-cluster compact-chart-cluster vertical-chart-cluster">
                            <p class="eyebrow chart-title">Round Wins</p>
                            <div class="big-chart" style="background:${winShare}"></div>
                        </div>
                    </div>
                </section>
            </div>
            <section class="accolade-grid">
                ${accolades.map((accolade) => `
                    <article class="accolade-card" style="--accent:${accolade.color}">
                        <p class="eyebrow">${accolade.title}</p>
                        <strong>${escapeHtml(accolade.name)}</strong>
                        <span>${accolade.value}</span>
                    </article>
                `).join('')}
            </section>
            <section class="campaign-table-panel pixel-panel-lite">
                <p class="eyebrow">Campaign Standings</p>
                <table class="report-table campaign-table">
                    <thead>
                        <tr><th>#</th><th>Pilot</th><th>Score</th><th>Wins</th><th>Damage</th><th>Kills</th><th>Taken</th></tr>
                    </thead>
                    <tbody>
                        ${leaders.map((player, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td><span class="table-player" style="--accent:${player.color}">${escapeHtml(player.name)}</span></td>
                                <td>${player.stats.score}</td>
                                <td>${player.stats.roundWins}</td>
                                <td>${player.stats.totalDamage}</td>
                                <td>${player.stats.totalKills}</td>
                                <td>${player.stats.totalDamageTaken}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </section>
            <div class="stats-grid deluxe-stats-grid campaign-player-grid">
                ${leaders.map((player) => `
                    <article class="stats-pilot deluxe-stats-pilot" style="--accent:${player.color}">
                        <div class="stats-pilot-head">
                            <div>
                                <p class="eyebrow">Campaign Pilot</p>
                                <h3>${escapeHtml(player.name)}</h3>
                            </div>
                            <div class="stats-score-pill">${player.stats.score} pts</div>
                        </div>
                        ${buildStatMeter('Campaign score', player.stats.score, maxScore, player.color, `${player.stats.score}`)}
                        ${buildStatMeter('Round wins', player.stats.roundWins, maxWins, player.color, `${player.stats.roundWins}`)}
                        ${buildStatMeter('Total damage', player.stats.totalDamage, maxDamage, player.color, `${player.stats.totalDamage}`)}
                        ${buildStatMeter('Damage absorbed', player.stats.totalDamageTaken, maxTaken, player.color, `${player.stats.totalDamageTaken}`)}
                    </article>
                `).join('')}
            </div>
            <button class="pixel-button primary" data-action="campaign-next">${campaignComplete ? 'Finish Campaign' : 'Open Shop'}</button>
        </div>
    `;
}

function captureShopScrollState() {
    const stockList = intermissionScreen.querySelector<HTMLElement>('.tidy-weapon-list');
    const marketList = intermissionScreen.querySelector<HTMLElement>('.tidy-store-list');
    if (stockList) shopScrollTop.stock = stockList.scrollTop;
    if (marketList) shopScrollTop.market = marketList.scrollTop;
}

function restoreShopScrollState() {
    const stockList = intermissionScreen.querySelector<HTMLElement>('.tidy-weapon-list');
    const marketList = intermissionScreen.querySelector<HTMLElement>('.tidy-store-list');
    if (stockList) stockList.scrollTop = shopScrollTop.stock;
    if (marketList) marketList.scrollTop = shopScrollTop.market;

    const selected = intermissionScreen.querySelector<HTMLElement>('.tidy-weapon-chip.selected, .tidy-store-item.selected');
    selected?.scrollIntoView({ block: 'nearest' });
}

function renderShopScreen() {
    captureShopScrollState();
    const focusPlayer = getShopFocusPlayer();
    const selection = ensureShopSelection(focusPlayer);
    const selectedWeapon = selection ? WEAPON_DEFINITIONS[selection.weaponType] : null;
    const ownedAmmo = selection && focusPlayer ? focusPlayer.weapons.find((weapon) => weapon.type === selection.weaponType)?.ammo ?? 0 : 0;
    const buyPrice = selection ? getWeaponShopPrice(selection.weaponType, currentSettings.weaponCostMultiplier) : null;
    const sellPrice = selection ? getWeaponSellPrice(selection.weaponType, currentSettings.weaponCostMultiplier) : null;
    const canBuy = Boolean(focusPlayer && selection?.source === 'market' && !focusPlayer.shopReady && buyPrice !== null && focusPlayer.credits >= buyPrice);
    const canSell = Boolean(focusPlayer && selection?.source === 'stock' && !focusPlayer.shopReady && sellPrice !== null && ownedAmmo > 0);

    intermissionScreen.innerHTML = `
        <div class="intermission-card shop-card deluxe-shop-card tidy-shop-card">
            <div class="shop-shell ${network ? 'online-shop-shell' : 'local-shop-shell'}">
                <section class="shop-main-panel">
                    <div class="shop-header-clean">
                        <div>
                            <p class="eyebrow">SHOP</p>
                            <h2>Carry-Over Arsenal</h2>
                        </div>
                        ${focusPlayer ? `<div class="shop-head-meta" style="--accent:${focusPlayer.color}"><span class="shop-focus-name">${escapeHtml(focusPlayer.name)}</span><span class="shop-credit-stack"><small>Credits</small><span class="shop-credits">${focusPlayer.credits} cr</span></span></div>` : ''}
                    </div>
                    ${focusPlayer ? `
                        <div class="shop-columns tidy-shop-columns">
                            <section class="shop-column inventory-column tidy-inventory-column">
                                <div class="column-head compact-column-head">
                                    <p class="eyebrow">Stock</p>
                                    <span>${focusPlayer.shopReady ? 'Locked' : 'Select to inspect'}</span>
                                </div>
                                <div class="weapon-list tidy-weapon-list">
                                    ${focusPlayer.weapons.filter((weapon) => weapon.ammo !== 0 || weapon.type === 'cannon').map((weapon) => `
                                        <button class="weapon-chip tidy-weapon-chip ${selection?.source === 'stock' && selection.weaponType === weapon.type ? 'selected' : ''}" data-action="select-weapon" data-player-id="${focusPlayer.id}" data-source="stock" data-weapon="${weapon.type}" ${focusPlayer.shopReady ? 'disabled' : ''}>
                                            <span class="shop-row-main"><span class="weapon-name">${WEAPON_DEFINITIONS[weapon.type].name}</span></span>
                                            <strong class="shop-row-value">${weapon.ammo < 0 ? 'INF' : weapon.ammo}</strong>
                                        </button>
                                    `).join('')}
                                </div>
                            </section>
                            <section class="shop-column market-column tidy-market-column">
                                <div class="column-head compact-column-head">
                                    <p class="eyebrow">Market</p>
                                    <span>${focusPlayer.shopReady ? 'Locked' : 'Select to inspect'}</span>
                                </div>
                                <div class="store-list tidy-store-list">
                                    ${SHOP_WEAPON_ORDER.map((type) => {
                                        const price = getWeaponShopPrice(type, currentSettings.weaponCostMultiplier);
                                        const locked = price === null;
                                        const unaffordable = !locked && focusPlayer.credits < price;
                                        return `
                                            <button class="store-item tidy-store-item ${selection?.source === 'market' && selection.weaponType === type ? 'selected' : ''} ${locked ? 'disabled' : ''} ${unaffordable ? 'unaffordable' : ''}" data-action="select-weapon" data-player-id="${focusPlayer.id}" data-source="market" data-weapon="${type}" ${focusPlayer.shopReady || locked ? 'disabled' : ''}>
                                                <span class="shop-row-main"><span class="weapon-name">${WEAPON_DEFINITIONS[type].name}</span></span>
                                                <strong class="shop-row-value">${price === null ? 'LOCK' : `${price} cr`}</strong>
                                            </button>
                                        `;
                                    }).join('')}
                                </div>
                            </section>
                            <aside class="shop-detail-panel">
                                ${selectedWeapon ? `
                                    <div class="weapon-preview-art" data-weapon-type="${selectedWeapon.type}" style="--accent:${selectedWeapon.projectileColor}">
                                        <div class="weapon-preview-core"></div>
                                        <span>${selectedWeapon.name}</span>
                                    </div>
                                    <div class="shop-detail-copy">
                                        <p class="eyebrow">Weapon Detail</p>
                                        <h3>${selectedWeapon.name}</h3>
                                        <p class="weapon-detail-flavor">${selectedWeapon.flavor}</p>
                                    </div>
                                    <div class="weapon-detail-stats">
                                        <div><span>Blast</span><strong>${selectedWeapon.blastRadius}</strong></div>
                                        <div><span>Damage</span><strong>${selectedWeapon.damage}</strong></div>
                                        <div><span>Stock</span><strong>${selection?.source === 'stock' ? (ownedAmmo < 0 ? 'INF' : ownedAmmo) : (focusPlayer.weapons.find((weapon) => weapon.type === selectedWeapon.type)?.ammo ?? 0)}</strong></div>
                                        <div><span>Buy</span><strong>${buyPrice ?? 'N/A'}</strong></div>
                                        <div><span>Sell</span><strong>${sellPrice ?? 'N/A'}</strong></div>
                                        <div><span>Source</span><strong>${selection?.source === 'market' ? 'Market' : 'Stock'}</strong></div>
                                    </div>
                                    <div class="shop-detail-actions">
                                        <button class="pixel-button secondary" data-action="buy-selected" ${canBuy ? '' : 'disabled'}>Buy</button>
                                        <button class="pixel-button ghost" data-action="sell-selected" ${canSell ? '' : 'disabled'}>Sell</button>
                                    </div>
                                ` : `
                                    <div class="empty-shop-detail">
                                        <p class="eyebrow">Weapon Detail</p>
                                        <h3>No weapon selected</h3>
                                    </div>
                                `}
                            </aside>
                        </div>
                        <div class="shop-footer-actions">
                            <button class="pixel-button ${focusPlayer.shopReady ? 'secondary' : 'primary'}" data-action="toggle-shop-ready" data-player-id="${focusPlayer.id}">${focusPlayer.shopReady ? 'Unlock Loadout' : 'Lock Loadout'}</button>
                        </div>
                    ` : '<p class="hero-copy">No active pilot available for shopping.</p>'}
                </section>
                <aside class="shop-side-column tidy-shop-sidebar">
                    <section class="shop-roster-panel">
                        <p class="eyebrow">${network ? 'Lobby Status' : 'Shopping Order'}</p>
                        <div class="shop-roster-list">
                            ${campaignPlayers.map((player, index) => `
                                <article class="shop-roster-card ${player.shopReady ? 'ready' : ''} ${!network && focusPlayer?.id === player.id ? 'active' : ''}" style="--accent:${player.color}">
                                    <div>
                                        <strong>${escapeHtml(player.name)}</strong>
                                        <span>${!network ? `Seat ${index + 1}` : (player.shopReady ? 'Ready' : 'Shopping')}</span>
                                    </div>
                                    <span>${player.shopReady ? 'READY' : (!network && focusPlayer?.id === player.id ? 'UP NOW' : 'WAIT')}</span>
                                </article>
                            `).join('')}
                        </div>
                    </section>
                </aside>
            </div>
        </div>
    `;
    restoreShopScrollState();
}

function getRoundRankings(players: RoundSummary['players'], winnerId: string | null) {
    return [...players].sort((left, right) => {
        if (winnerId && left.id === winnerId) return -1;
        if (winnerId && right.id === winnerId) return 1;
        return right.stats.damage - left.stats.damage
            || right.stats.kills - left.stats.kills
            || right.stats.hits - left.stats.hits
            || left.stats.damageTaken - right.stats.damageTaken;
    });
}

function calculateRoundCreditGain(summary: RoundSummary, playerId: string, settings: MatchSettings) {
    const player = summary.players.find((entry) => entry.id === playerId);
    if (!player) return 0;

    let gained = 0;
    if (settings.scoring.awardDamage) {
        gained += player.stats.damage * settings.scoring.damagePointValue;
    }
    if (settings.scoring.awardKills) {
        gained += player.stats.kills * settings.scoring.killPointValue;
    }
    if (settings.scoring.awardPlacement) {
        const rankings = getRoundRankings(summary.players, summary.winnerId);
        const placement = rankings.findIndex((entry) => entry.id === playerId);
        if (placement === 0) gained += settings.scoring.firstPlacePoints;
        if (placement === 1) gained += settings.scoring.secondPlacePoints;
        if (placement === 2) gained += settings.scoring.thirdPlacePoints;
    }

    return gained;
}

function buildRoundAccolades(players: RoundSummary['players'], winnerId: string | null) {
    const winner = players.find((player) => player.id === winnerId) ?? players[0];
    const topDamage = [...players].sort((left, right) => right.stats.damage - left.stats.damage)[0];
    const topKills = [...players].sort((left, right) => right.stats.kills - left.stats.kills)[0];
    const topTaken = [...players].sort((left, right) => right.stats.damageTaken - left.stats.damageTaken)[0];
    const topShots = [...players].sort((left, right) => right.stats.shots - left.stats.shots)[0];
    return [
        { title: 'Winner', name: winner?.name ?? 'No one', value: winner ? 'Closed the round' : 'No winner', color: winner?.color ?? '#fff4d7' },
        { title: 'Most Damage', name: topDamage?.name ?? 'No one', value: `${topDamage?.stats.damage ?? 0} damage`, color: topDamage?.color ?? '#fff4d7' },
        { title: 'Most Kills', name: topKills?.name ?? 'No one', value: `${topKills?.stats.kills ?? 0} kills`, color: topKills?.color ?? '#fff4d7' },
        { title: 'Most Damage Taken', name: topTaken?.name ?? 'No one', value: `${topTaken?.stats.damageTaken ?? 0} taken`, color: topTaken?.color ?? '#fff4d7' },
        { title: 'Longest Barrage', name: topShots?.name ?? 'No one', value: `${topShots?.stats.shots ?? 0} shots`, color: topShots?.color ?? '#fff4d7' }
    ];
}

function buildCampaignAccolades(players: CampaignPlayer[]) {
    const leader = players[0];
    const mostWins = [...players].sort((left, right) => right.stats.roundWins - left.stats.roundWins)[0];
    const mostDamage = [...players].sort((left, right) => right.stats.totalDamage - left.stats.totalDamage)[0];
    const mostKills = [...players].sort((left, right) => right.stats.totalKills - left.stats.totalKills)[0];
    const mostTaken = [...players].sort((left, right) => right.stats.totalDamageTaken - left.stats.totalDamageTaken)[0];
    return [
        { title: 'Campaign Leader', name: leader?.name ?? 'No one', value: `${leader?.stats.score ?? 0} pts`, color: leader?.color ?? '#fff4d7' },
        { title: 'Most Wins', name: mostWins?.name ?? 'No one', value: `${mostWins?.stats.roundWins ?? 0} wins`, color: mostWins?.color ?? '#fff4d7' },
        { title: 'Most Damage', name: mostDamage?.name ?? 'No one', value: `${mostDamage?.stats.totalDamage ?? 0} damage`, color: mostDamage?.color ?? '#fff4d7' },
        { title: 'Most Kills', name: mostKills?.name ?? 'No one', value: `${mostKills?.stats.totalKills ?? 0} kills`, color: mostKills?.color ?? '#fff4d7' },
        { title: 'Most Punished', name: mostTaken?.name ?? 'No one', value: `${mostTaken?.stats.totalDamageTaken ?? 0} taken`, color: mostTaken?.color ?? '#fff4d7' }
    ];
}

function buildConicChart(entries: Array<{ color: string; value: number }>) {
    const total = Math.max(1, entries.reduce((sum, entry) => sum + entry.value, 0));
    let start = 0;
    const segments = entries.map((entry) => {
        const angle = (entry.value / total) * 360;
        const segment = `${entry.color} ${start}deg ${start + angle}deg`;
        start += angle;
        return segment;
    });
    if (!segments.length) {
        return 'conic-gradient(#3a2a46 0deg 360deg)';
    }
    return `conic-gradient(${segments.join(', ')})`;
}

function buildStatMeter(label: string, value: number, maxValue: number, color: string, valueLabel: string) {
    const percent = Math.max(8, Math.round((value / Math.max(1, maxValue)) * 100));
    return `
        <div class="stat-meter">
            <div class="stat-meter-head">
                <span>${label}</span>
                <strong style="color:${color}">${valueLabel}</strong>
            </div>
            <div class="stat-meter-track"><span style="width:${percent}%; background:${color}"></span></div>
        </div>
    `;
}

function leaveLobby() {
    cancelScheduledStart();
    network?.destroy();
    network = null;
    lobbyPlayers = [];
    localLobbyPlayers = [];
    lobbyMode = 'idle';
    closeBattleSetup();
    syncMatchSettingsAvailability();
    lobbyStatus.textContent = 'Host, join, or create a local lobby to begin.';
    renderLobby();
    updateReadyButton();
}

function leaveMatch() {
    cancelScheduledStart();
    game?.stop();
    game = null;
    network?.destroy();
    network = null;
    lobbyPlayers = [];
    localLobbyPlayers = [];
    lobbyMode = 'idle';
    campaignPlayers = [];
    latestRoundSummary = null;
    localShopCursor = 0;
    shopSelection = null;
    intermissionStage = 'hidden';
    renderIntermission();
    closeBattleSetup();
    syncMatchSettingsAvailability();
    renderLobby();
    updateReadyButton();
    gameScreen.classList.add('hidden');
    menuScreen.classList.remove('hidden');
    resetHud();
}

function updateReadyButton() {
    if (lobbyMode === 'online-host' || lobbyMode === 'online-client') {
        btnReady.disabled = false;
        const localPlayer = lobbyPlayers.find((player) => player.id === network?.myId);
        btnReady.textContent = localPlayer?.ready ? 'Ready Locked' : 'Lock Ready';
        return;
    }
    btnReady.disabled = true;
    btnReady.textContent = lobbyMode === 'local' ? 'Use the local pilot cards below' : 'Join a lobby first';
}

function syncMatchSettingsAvailability() {
    const disableSettings = lobbyMode === 'online-client';
    powerRuleSelect.disabled = disableSettings;
    windModeSelect.disabled = disableSettings;
    windMaxSelect.disabled = disableSettings;
    terrainThemeInputs.forEach((input) => { input.disabled = disableSettings; });
    roundCountInput.disabled = disableSettings;
    weaponCostMultiplierInput.disabled = disableSettings;
    scoringDamageToggle.disabled = disableSettings;
    scoringDamageValue.disabled = disableSettings || !scoringDamageToggle.checked;
    scoringKillsToggle.disabled = disableSettings;
    scoringKillValue.disabled = disableSettings || !scoringKillsToggle.checked;
    scoringPlacementToggle.disabled = disableSettings;
    scoringFirstValue.disabled = disableSettings || !scoringPlacementToggle.checked;
    scoringSecondValue.disabled = disableSettings || !scoringPlacementToggle.checked;
    scoringThirdValue.disabled = disableSettings || !scoringPlacementToggle.checked;
    roundOrderSelect.disabled = disableSettings;
    terrainCollapseInput.disabled = disableSettings;
}

function updateGameHud(snapshot: HudSnapshot) {
    latestHudSnapshot = snapshot;
    hudPilot.textContent = snapshot.pilotLabel;
    hudPilot.style.color = snapshot.turnColor;
    hudShieldFill.style.width = `${Math.max(0, Math.min(100, snapshot.shieldPercent * 100))}%`;
    hudShieldFill.style.background = '#62e7ff';
    hudHealthFill.style.width = `${Math.max(0, Math.min(100, snapshot.healthPercent * 100))}%`;
    hudHealthFill.style.background = snapshot.turnColor;
    const ammoDetail = snapshot.weaponLabel.includes('|') ? snapshot.weaponLabel.split('|').slice(1).join('|').trim() : snapshot.weaponLabel;
    const weaponStats = snapshot.weaponDetail.includes('|') ? snapshot.weaponDetail.split('|').slice(1).join('|').trim() : snapshot.weaponDetail;
    hudWeapon.textContent = ammoDetail && weaponStats ? ammoDetail + ' | ' + weaponStats : snapshot.weaponDetail;
    hudPowerLabel.textContent = snapshot.powerLabel;
    hudPowerFill.style.width = `${Math.max(0, Math.min(100, snapshot.powerPercent * 100))}%`;
    hudPowerFill.style.background = snapshot.turnColor;
    hudAngle.textContent = snapshot.angleLabel;
    hudWind.textContent = snapshot.windLabel;
    hudCampaign.textContent = snapshot.roundLabel;
    currentHintLabel = snapshot.hintLabel;

    const weaponOptionsMarkup = snapshot.weaponOptions.map((option) => `<option value="${option.index}" ${option.disabled ? 'disabled' : ''}>${option.label}</option>`).join('');
    if (weaponSelect.innerHTML !== weaponOptionsMarkup) {
        weaponSelect.innerHTML = weaponOptionsMarkup;
    }
    weaponSelect.value = `${snapshot.selectedWeaponIndex}`;
    weaponSelect.disabled = !snapshot.canSelectWeapon;

    syncBoardTabs();
    renderBoard(snapshot);
}
function renderBoard(snapshot: HudSnapshot) {
    const entries = [...snapshot.scoreboard].sort((left, right) => activeBoardTab === 'battle'
        ? right.damage - left.damage || right.kills - left.kills || right.score - left.score
        : right.score - left.score || right.roundWins - left.roundWins || right.totalDamage - left.totalDamage);

    const maxCampaignScore = Math.max(1, ...entries.map((entry) => entry.score));
    scoreboard.innerHTML = entries.map((entry, index) => `
        <article class="score-card compact-score-card" style="--accent:${entry.color}">
            <div class="score-topline">
                <span class="score-rank">${index + 1}</span>
                <span class="score-name">${escapeHtml(entry.name)}</span>
                <span class="score-pill">${activeBoardTab === 'battle' ? `PTS ${entry.score}` : `CP ${entry.score}`}</span>
            </div>
            <div class="score-glow"><span style="width:${Math.max(6, (activeBoardTab === 'battle' ? entry.damageRatio : entry.score / maxCampaignScore) * 100)}%"></span></div>
            <div class="score-badges">
                <span class="score-badge dmg">${entry.damage}</span>
                <span class="score-badge ko">${entry.kills}</span>
            </div>
        </article>
    `).join('');
}

function syncBoardTabs() {
    boardTabBattle.classList.toggle('active', activeBoardTab === 'battle');
    boardTabCampaign.classList.toggle('active', activeBoardTab === 'campaign');
}

function resetHud() {
    latestHudSnapshot = null;
    hudPilot.textContent = 'No active pilot';
    hudPilot.style.color = '#fff4d7';
    hudShieldFill.style.width = '0%';
    hudShieldFill.style.background = '#62e7ff';
    hudHealthFill.style.width = '100%';
    hudHealthFill.style.background = '#9de64e';
    hudWeapon.textContent = 'Ammo | Blast | Damage';
    hudPowerLabel.textContent = 'Charge';
    hudPowerFill.style.width = '0%';
    hudPowerFill.style.background = '#ff7a59';
    hudAngle.textContent = 'Angle';
    hudWind.textContent = 'Wind';
    hudCampaign.textContent = 'Round status';
    currentHintLabel = 'Arrow left and right aim, arrow up and down change power, hold Ctrl for fine adjustment, and space fires.';
    weaponSelect.innerHTML = '<option>Weapon</option>';
    weaponSelect.disabled = true;
    activeBoardTab = 'battle';
    syncBoardTabs();
    scoreboard.innerHTML = '<p class="hud-subline">Battle and campaign standings will update here once the battle starts.</p>';
}
function toCampaignPlayer(player: LobbyPlayer): CampaignPlayer {
    return {
        id: player.id,
        name: player.name,
        color: player.color,
        loadout: player.loadout,
        isHost: player.isHost,
        weapons: createWeaponsForLoadout(player.loadout),
        shield: 0,
        credits: 0,
        shopReady: false,
        stats: createEmptyStats(player.id)
    };
}
function toPlayerSetup(player: CampaignPlayer): PlayerSetup {
    return {
        id: player.id,
        name: player.name,
        color: player.color,
        loadout: player.loadout,
        weapons: player.weapons.map((weapon) => ({ ...weapon })),
        shield: player.shield
    };
}
function createEmptyStats(id: string): PlayerStatsSnapshot {
    return {
        id,
        damage: 0,
        hits: 0,
        kills: 0,
        shots: 0,
        damageTaken: 0,
        score: 0,
        roundWins: 0,
        totalDamage: 0,
        totalHits: 0,
        totalKills: 0,
        totalShots: 0,
        totalDamageTaken: 0
    };
}

function clampSetting(value: number, min: number, max: number, fallback: number) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, value));
}

function escapeHtml(value: string) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeAttribute(value: string) {
    return escapeHtml(value);
}



































































