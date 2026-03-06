import './style.css';
import { AudioManager } from './AudioManager';
import {
    addWeaponAmmo,
    COLOR_OPTIONS,
    createWeaponsForLoadout,
    LOADOUTS,
    LOGICAL_HEIGHT,
    LOGICAL_WIDTH,
    MAX_PLAYERS,
    ROUND_SHOP_BASE_CREDITS,
    WEAPON_DEFINITIONS,
    WEAPON_SHOP_PRICES
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
    ScoringMode,
    WeaponState,
    WeaponType,
    WindMode
} from './types';

type LobbyMode = 'idle' | 'online-host' | 'online-client' | 'local';
type IntermissionStage = 'hidden' | 'victory' | 'stats' | 'shop';
type LocalProfile = { name: string; color: string; loadout: LoadoutId };

const SHOP_WEAPON_ORDER: WeaponType[] = ['mortar', 'needle', 'nova', 'merv', 'chaos'];

type CampaignPlayer = {
    id: string;
    name: string;
    color: string;
    loadout: LoadoutId;
    isHost: boolean;
    weapons: WeaponState[];
    credits: number;
    shopReady: boolean;
    stats: PlayerStatsSnapshot;
};

const DEFAULT_SETTINGS: MatchSettings = {
    windMode: 'variable',
    maxWind: 0.45,
    terrainCollapse: true,
    powerRule: 'health_linked',
    rounds: 1,
    scoringMode: 'damage_and_kills'
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
                    <p class="hero-copy">Destructible terrain, local or PeerJS multiplayer, campaign rounds, carry-over arsenals, and chunky placeholder synth audio.</p>
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

            <div class="menu-grid">
                <section class="pixel-panel rules-panel">
                    <p class="eyebrow">MATCH RULES</p>
                    <h2>Battle Setup</h2>
                    <p class="field-help settings-help">These settings apply to local matches and to online rooms you host. Joiners can inspect them, but only the host controls them.</p>
                    <label class="field-label" for="powerRule">Power Cap</label>
                    <select id="powerRule" class="pixel-select">
                        <option value="health_linked">HP Linked (200 max, -2 per HP lost)</option>
                        <option value="static">Static</option>
                    </select>
                    <label class="field-label" for="windMode">Wind Mode</label>
                    <select id="windMode" class="pixel-select">
                        <option value="variable">Variable</option>
                        <option value="constant">Constant</option>
                        <option value="disabled">Disabled</option>
                    </select>
                    <label class="field-label" for="windMax">Wind Strength</label>
                    <select id="windMax" class="pixel-select">
                        <option value="0.25">Low</option>
                        <option value="0.45" selected>Medium</option>
                        <option value="0.7">High</option>
                    </select>
                    <label class="field-label" for="roundCount">Rounds</label>
                    <select id="roundCount" class="pixel-select">
                        <option value="1">Single Battle</option>
                        <option value="3">3-Round Campaign</option>
                        <option value="5">5-Round Campaign</option>
                    </select>
                    <label class="field-label" for="scoringMode">Scoring</label>
                    <select id="scoringMode" class="pixel-select">
                        <option value="damage_and_kills">Damage + 50 per Kill</option>
                        <option value="damage_only">Damage Only</option>
                        <option value="kills_only">Kills Only</option>
                    </select>
                    <label class="toggle-row" for="terrainCollapse">
                        <input id="terrainCollapse" type="checkbox" checked />
                        <span>Terrain Collapse</span>
                    </label>
                </section>

                <section class="pixel-panel session-panel">
                    <div class="mode-card">
                        <div>
                            <p class="eyebrow">ONLINE</p>
                            <h3>Host Match</h3>
                            <p>Create a room, share the code, and launch automatically when every pilot is ready.</p>
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
                            <p>Create 2 to 4 local pilots, tune each one, ready them up, then pass the keyboard.</p>
                        </div>
                        <div class="inline-controls">
                            <label class="field-label compact" for="localPlayerCount">Pilots</label>
                            <select id="localPlayerCount" class="pixel-select compact"></select>
                        </div>
                        <button id="btnLocal" class="pixel-button accent">Create Local Lobby</button>
                    </div>
                </section>
            </div>

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
            <div class="game-topbar pixel-panel">
                <div>
                    <p class="eyebrow">MATCH LIVE</p>
                    <h2>FreeMortar Arena</h2>
                </div>
                <div class="audio-controls compact-audio">
                    <button id="btnMuteGame" class="pixel-button ghost">Audio On</button>
                    <button id="btnMusicGame" class="pixel-button ghost">Music On</button>
                    <label class="volume-stack compact" for="volumeRangeGame">
                        <span class="field-label compact">Volume</span>
                        <input id="volumeRangeGame" class="volume-range" type="range" min="0" max="100" value="72" />
                    </label>
                    <button id="btnLeaveMatch" class="pixel-button ghost">Leave Match</button>
                </div>
            </div>

            <div class="game-status-row">
                <section class="pixel-panel hud-card turn-card">
                    <p class="eyebrow">Turn</p>
                    <h3 id="hudTurn">Stand by</h3>
                    <p id="hudPilot" class="hud-subline">No active pilot</p>
                    <div class="health-meter"><div class="health-bar"><span id="hudHealthFill"></span></div></div>
                    <p id="hudRound" class="hud-subline">Round status</p>
                </section>
                <section class="pixel-panel hud-card arsenal-card">
                    <p class="eyebrow">Arsenal</p>
                    <select id="weaponSelect" class="pixel-select compact"></select>
                    <h3 id="hudWeaponTitle">Weapon Ready</h3>
                    <p id="hudWeapon" class="hud-subline">Weapon info</p>
                    <div class="power-meter">
                        <div class="power-bar"><span id="hudPowerFill"></span></div>
                        <p id="hudPowerLabel" class="hud-subline">Charge</p>
                        <p id="hudAngle" class="hud-subline">Angle</p>
                    </div>
                </section>
                <section class="pixel-panel hud-card conditions-card">
                    <p class="eyebrow">Conditions</p>
                    <h3 id="hudWind">Wind</h3>
                    <p id="hudWinner" class="hud-subline">No winner yet</p>
                    <p id="hudCampaign" class="hud-subline">Campaign status</p>
                </section>
            </div>

            <div class="arena-layout">
                <div class="arena-main">
                    <div class="canvas-frame pixel-panel">
                        <canvas id="gameCanvas" width="${LOGICAL_WIDTH}" height="${LOGICAL_HEIGHT}"></canvas>
                    </div>

                    <div class="pixel-panel footer-panel">
                        <p id="hudHint">Arrow left and right aim, arrow up and down change power, and space fires.</p>
                    </div>
                </div>

                <section class="pixel-panel hud-card scoreboard-card">
                    <div class="board-header">
                        <p class="eyebrow">Battle Board</p>
                        <div class="board-tabs">
                            <button id="boardTabBattle" class="board-tab active" type="button">Battle</button>
                            <button id="boardTabCampaign" class="board-tab" type="button">Campaign</button>
                        </div>
                    </div>
                    <div class="board-layout">
                        <div id="scoreChart" class="score-chart"></div>
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
const powerRuleSelect = mustElement<HTMLSelectElement>('powerRule');
const windModeSelect = mustElement<HTMLSelectElement>('windMode');
const windMaxSelect = mustElement<HTMLSelectElement>('windMax');
const roundCountSelect = mustElement<HTMLSelectElement>('roundCount');
const scoringModeSelect = mustElement<HTMLSelectElement>('scoringMode');
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
const hudTurn = mustElement<HTMLElement>('hudTurn');
const hudPilot = mustElement<HTMLElement>('hudPilot');
const hudHealthFill = mustElement<HTMLElement>('hudHealthFill');
const hudRound = mustElement<HTMLElement>('hudRound');
const hudWeaponTitle = mustElement<HTMLElement>('hudWeaponTitle');
const hudWeapon = mustElement<HTMLElement>('hudWeapon');
const hudPowerFill = mustElement<HTMLElement>('hudPowerFill');
const hudAngle = mustElement<HTMLElement>('hudAngle');
const hudPowerLabel = mustElement<HTMLElement>('hudPowerLabel');
const hudWind = mustElement<HTMLElement>('hudWind');
const hudWinner = mustElement<HTMLElement>('hudWinner');
const hudCampaign = mustElement<HTMLElement>('hudCampaign');
const hudHint = mustElement<HTMLElement>('hudHint');
const weaponSelect = mustElement<HTMLSelectElement>('weaponSelect');
const scoreChart = mustElement<HTMLElement>('scoreChart');
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
let currentSettings: MatchSettings = { ...DEFAULT_SETTINGS };
let currentRound = 1;
let intermissionStage: IntermissionStage = 'hidden';
let latestRoundSummary: RoundSummary | null = null;
let campaignComplete = false;
let startTimer: number | null = null;
let shopStartTimer: number | null = null;
let activeBoardTab: 'battle' | 'campaign' = 'battle';
let latestHudSnapshot: HudSnapshot | null = null;
playerNameInput.value = 'Pilot One';
roomCodeInput.value = '';
powerRuleSelect.value = DEFAULT_SETTINGS.powerRule;
windModeSelect.value = DEFAULT_SETTINGS.windMode;
windMaxSelect.value = `${DEFAULT_SETTINGS.maxWind}`;
roundCountSelect.value = `${DEFAULT_SETTINGS.rounds}`;
scoringModeSelect.value = DEFAULT_SETTINGS.scoringMode;
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

btnHost.addEventListener('click', async () => {
    await audio.unlock();
    btnHost.disabled = true;
    btnJoin.disabled = true;
    try {
        network?.destroy();
        network = new Network();
        bindNetwork(network);
        const roomCode = await network.hostGame(readProfileForm());
        lobbyMode = 'online-host';
        syncMatchSettingsAvailability();
        lobbyStatus.textContent = `Room ${roomCode} is live. Share the code and wait for everyone to ready up.`;
        lobbyPanel.classList.remove('hidden');
        renderLobby();
        updateReadyButton();
    } catch {
        window.alert('Unable to create the room. Check PeerJS connectivity and try again.');
    } finally {
        btnHost.disabled = false;
        btnJoin.disabled = false;
    }
});

btnJoin.addEventListener('click', async () => {
    await audio.unlock();
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
    } catch {
        window.alert('Unable to join the room. Confirm the code and that the host is online.');
    } finally {
        btnHost.disabled = false;
        btnJoin.disabled = false;
    }
});

btnLocal.addEventListener('click', async () => {
    await audio.unlock();
    network?.destroy();
    network = null;
    lobbyMode = 'local';
    syncMatchSettingsAvailability();
    localLobbyPlayers = createLocalLobbyPlayers(Number(localPlayerCount.value));
    lobbyPanel.classList.remove('hidden');
    lobbyStatus.textContent = 'Edit each local pilot, lock them in, and the match will start automatically.';
    updateReadyButton();
    renderLobby();
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
        terrainCollapse: terrainCollapseInput.checked,
        powerRule: powerRuleSelect.value as PowerRule,
        rounds: Number(roundCountSelect.value),
        scoringMode: scoringModeSelect.value as ScoringMode
    };
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
        currentSettings = payload.settings;
        currentRound = payload.roundNumber;
        campaignPlayers = payload.players.map((player) => ({
            id: player.id,
            name: player.name,
            color: player.color,
            loadout: player.loadout,
            isHost: player.id === 'host',
            weapons: (player.weapons ?? createWeaponsForLoadout(player.loadout)).map((weapon) => ({ ...weapon })),
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
    currentSettings = readMatchSettingsForm();
    currentRound = 1;
    campaignComplete = false;
    latestRoundSummary = null;
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
    return {
        seed,
        players: players.map(toPlayerSetup),
        currentPlayerIndex: 0,
        wind: buildInitialWind(seed, settings),
        turnNumber: 1,
        roundNumber,
        settings,
        campaignStats: players.map((player) => ({ ...player.stats }))
    };
}

function buildInitialWind(seed: number, settings: MatchSettings) {
    if (settings.windMode === 'disabled') return 0;
    return ((((seed % 1000) / 1000) - 0.5) * 2) * settings.maxWind;
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

    campaignPlayers = campaignPlayers.map((player) => {
        const roundPlayer = summary.players.find((entry) => entry.id === player.id);
        if (!roundPlayer) return player;
        const gainedCredits = !network || network.role === 'host'
            ? player.credits + roundPlayer.stats.score + ROUND_SHOP_BASE_CREDITS
            : player.credits;
        return {
            ...player,
            weapons: roundPlayer.weapons.map((weapon) => ({ ...weapon })),
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
        if (campaignComplete) {
            leaveMatch();
            return;
        }
        intermissionStage = 'shop';
        renderIntermission();
        return;
    }
    if (action === 'buy') {
        const playerId = button.dataset.playerId;
        const weaponType = button.dataset.weapon as WeaponType | undefined;
        if (!playerId || !weaponType) return;
        purchaseWeapon(playerId, weaponType);
        return;
    }
    if (action === 'toggle-shop-ready') {
        const playerId = button.dataset.playerId;
        if (!playerId) return;
        toggleShopReady(playerId);
    }
}

function purchaseWeapon(playerId: string, weaponType: WeaponType) {
    const price = WEAPON_SHOP_PRICES[weaponType];
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

function toggleShopReady(playerId: string) {
    const localIds = getInteractivePlayerIds();
    if (!localIds.has(playerId)) return;
    campaignPlayers = campaignPlayers.map((player) => player.id === playerId ? { ...player, shopReady: !player.shopReady } : player);
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
        weapons: player.weapons.map((weapon) => ({ ...weapon }))
    });
}

function maybeLaunchNextRound() {
    if (campaignComplete) return;
    if (!campaignPlayers.length || !campaignPlayers.every((player) => player.shopReady)) return;
    if (network && network.role === 'client') return;
    shopStartTimer = window.setTimeout(() => {
        currentRound += 1;
        const payload = buildMatchPayload(campaignPlayers.map((player) => ({ ...player, shopReady: false })), currentRound, currentSettings);
        campaignPlayers = campaignPlayers.map((player) => ({ ...player, shopReady: false }));
        if (network?.role === 'host') network.broadcastStart(payload);
        launchMatch(payload, network);
    }, 700);
}

function getInteractivePlayerIds() {
    if (!network) {
        return new Set(campaignPlayers.map((player) => player.id));
    }
    return new Set([network.myId]);
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
    renderShopScreen();
}
function renderVictoryScreen() {
    if (!latestRoundSummary) return;
    const summary = latestRoundSummary;
    const winner = summary.players.find((player) => player.id === summary.winnerId) ?? null;
    intermissionScreen.innerHTML = `
        <div class="intermission-card victory-card">
            <p class="eyebrow">ROUND COMPLETE</p>
            <h2 style="color:${winner?.color ?? '#fff4d7'}">${escapeHtml(winner?.name ?? 'No one')} Wins</h2>
            <p class="hero-copy">The battlefield settles. Review the debrief, inspect the campaign charts, then prepare the next loadout.</p>
            <div class="victory-strip">${latestRoundSummary?.players.map((player) => `<span style="background:${player.color}">${escapeHtml(player.name)}</span>`).join('')}</div>
            <button class="pixel-button primary" data-action="victory-next">Open Debrief</button>
        </div>
    `;
}

function renderStatsScreen() {
    const damageChart = buildConicChart(campaignPlayers.map((player) => ({ color: player.color, value: player.stats.damage })));
    const scoreChartValue = buildConicChart(campaignPlayers.map((player) => ({ color: player.color, value: player.stats.score })));
    const maxRoundDamage = Math.max(1, ...campaignPlayers.map((player) => player.stats.damage));
    const maxCampaignScore = Math.max(1, ...campaignPlayers.map((player) => player.stats.score));
    const maxDamageTaken = Math.max(1, ...campaignPlayers.map((player) => player.stats.totalDamageTaken));
    const leaders = [...campaignPlayers].sort((left, right) => right.stats.score - left.stats.score || right.stats.totalDamage - left.stats.totalDamage);

    intermissionScreen.innerHTML = `
        <div class="intermission-card stats-card deluxe-stats-card">
            <div class="stats-hero-grid">
                <section class="stats-hero-panel">
                    <p class="eyebrow">DEBRIEF</p>
                    <h2>Round ${currentRound} Report</h2>
                    <p class="hero-copy">Round damage, campaign momentum, and pilot pressure traces color-coded across the whole field.</p>
                    <div class="stats-dual-charts">
                        <div class="chart-cluster compact-chart-cluster">
                            <p class="eyebrow">Round Damage</p>
                            <div class="big-chart" style="background:${damageChart}"></div>
                        </div>
                        <div class="chart-cluster compact-chart-cluster">
                            <p class="eyebrow">Campaign Share</p>
                            <div class="big-chart" style="background:${scoreChartValue}"></div>
                        </div>
                    </div>
                </section>
                <section class="stats-hero-panel skyline-panel">
                    <p class="eyebrow">Campaign Ladder</p>
                    <div class="skyline-chart">
                        ${leaders.map((player) => {
                            const height = Math.max(18, Math.round((player.stats.score / maxCampaignScore) * 100));
                            return `
                                <div class="skyline-bar" style="--accent:${player.color}; --height:${height}%">
                                    <span class="skyline-column"></span>
                                    <strong>${player.stats.score}</strong>
                                    <span>${escapeHtml(player.name)}</span>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </section>
            </div>
            <div class="stats-grid deluxe-stats-grid">
                ${campaignPlayers.map((player) => `
                    <article class="stats-pilot deluxe-stats-pilot" style="--accent:${player.color}">
                        <div class="stats-pilot-head">
                            <div>
                                <p class="eyebrow">Pilot Debrief</p>
                                <h3>${escapeHtml(player.name)}</h3>
                            </div>
                            <div class="stats-score-pill">${player.stats.score} pts</div>
                        </div>
                        ${buildStatMeter('Round damage', player.stats.damage, maxRoundDamage, player.color, `${player.stats.damage}`)}
                        ${buildStatMeter('Campaign score', player.stats.score, maxCampaignScore, player.color, `${player.stats.score}`)}
                        ${buildStatMeter('Damage absorbed', player.stats.totalDamageTaken, maxDamageTaken, player.color, `${player.stats.totalDamageTaken}`)}
                        <div class="stats-badge-row">
                            <span class="stats-chip hits">${player.stats.hits} hits</span>
                            <span class="stats-chip kills">${player.stats.totalKills} kills</span>
                            <span class="stats-chip wins">${player.stats.roundWins} wins</span>
                        </div>
                        <div class="stats-mini-grid">
                            <div><span>Round taken</span><strong>${player.stats.damageTaken}</strong></div>
                            <div><span>Total damage</span><strong>${player.stats.totalDamage}</strong></div>
                            <div><span>Total shots</span><strong>${player.stats.totalShots}</strong></div>
                            <div><span>MVP pressure</span><strong>${player.stats.totalHits}</strong></div>
                        </div>
                    </article>
                `).join('')}
            </div>
            <button class="pixel-button primary" data-action="stats-next">${campaignComplete ? 'Finish Campaign' : 'Open Shop'}</button>
        </div>
    `;
}

function renderShopScreen() {
    const localIds = getInteractivePlayerIds();
    intermissionScreen.innerHTML = `
        <div class="intermission-card shop-card deluxe-shop-card">
            <div>
                <p class="eyebrow">SHOP + REARM</p>
                <h2>Carry-Over Arsenal</h2>
                <p class="hero-copy">Weapons carry over. Each pilot receives current points plus ${ROUND_SHOP_BASE_CREDITS} credits after the round. Buy carefully, then mark ready.</p>
            </div>
            <div class="shop-grid deluxe-shop-grid">
                ${campaignPlayers.map((player) => {
                    const interactive = localIds.has(player.id);
                    return `
                        <article class="shop-pilot deluxe-shop-pilot" style="--accent:${player.color}">
                            <div class="shop-head">
                                <div>
                                    <p class="eyebrow">Pilot Market</p>
                                    <h3>${escapeHtml(player.name)}</h3>
                                </div>
                                <span class="shop-credits">${player.credits} cr</span>
                            </div>
                            <div class="weapon-list weapon-stock-list">
                                ${player.weapons.map((weapon) => buildWeaponInventoryRow(weapon.type, weapon.ammo)).join('')}
                            </div>
                            <div class="store-list deluxe-store-list">
                                ${SHOP_WEAPON_ORDER.map((type) => `
                                    <button class="store-item ${interactive ? '' : 'disabled'}" data-action="buy" data-player-id="${player.id}" data-weapon="${type}" ${!interactive || player.shopReady || player.credits < (WEAPON_SHOP_PRICES[type] ?? 9999) ? 'disabled' : ''}>
                                        <span class="store-copy">
                                            <strong>${WEAPON_DEFINITIONS[type].glyph} ${WEAPON_DEFINITIONS[type].name}</strong>
                                            <small>${WEAPON_DEFINITIONS[type].flavor}</small>
                                        </span>
                                        <strong>${WEAPON_SHOP_PRICES[type]} cr</strong>
                                    </button>
                                `).join('')}
                            </div>
                            <button class="pixel-button ${player.shopReady ? 'secondary' : 'primary'}" data-action="toggle-shop-ready" data-player-id="${player.id}" ${!interactive ? 'disabled' : ''}>${player.shopReady ? 'Ready' : 'Ready Up'}</button>
                        </article>
                    `;
                }).join('')}
            </div>
        </div>
    `;
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

function buildWeaponInventoryRow(type: WeaponType, ammo: number) {
    const definition = WEAPON_DEFINITIONS[type];
    return `
        <div class="weapon-chip fancy-weapon-chip">
            <span class="weapon-copy">
                <strong>${definition.glyph} ${definition.name}</strong>
                <small>${definition.flavor}</small>
            </span>
            <strong>${ammo < 0 ? 'INF' : ammo}</strong>
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
    intermissionStage = 'hidden';
    renderIntermission();
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
    roundCountSelect.disabled = disableSettings;
    scoringModeSelect.disabled = disableSettings;
    terrainCollapseInput.disabled = disableSettings;
}

function updateGameHud(snapshot: HudSnapshot) {
    latestHudSnapshot = snapshot;
    hudTurn.textContent = snapshot.turnLabel;
    hudPilot.textContent = snapshot.pilotLabel;
    hudPilot.style.color = snapshot.turnColor;
    hudHealthFill.style.width = `${Math.max(0, Math.min(100, snapshot.healthPercent * 100))}%`;
    hudHealthFill.style.background = snapshot.turnColor;
    hudRound.textContent = snapshot.roundLabel;
    hudWeaponTitle.textContent = snapshot.weaponLabel;
    hudWeapon.textContent = snapshot.weaponDetail;
    hudPowerLabel.textContent = snapshot.powerLabel;
    hudPowerFill.style.width = `${Math.max(0, Math.min(100, snapshot.powerPercent * 100))}%`;
    hudPowerFill.style.background = snapshot.turnColor;
    hudAngle.textContent = snapshot.angleLabel;
    hudWind.textContent = snapshot.windLabel;
    hudWinner.textContent = snapshot.winnerLabel || 'No winner yet';
    hudCampaign.textContent = snapshot.campaignLabel;
    hudHint.textContent = snapshot.hintLabel;

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

    scoreChart.style.background = buildConicChart(entries.map((entry) => ({
        color: entry.color,
        value: activeBoardTab === 'battle' ? entry.damage : entry.score
    })));

    const maxCampaignScore = Math.max(1, ...entries.map((entry) => entry.score));
    scoreboard.innerHTML = entries.map((entry, index) => `
        <article class="score-card" style="--accent:${entry.color}">
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
    hudTurn.textContent = 'Stand by';
    hudPilot.textContent = 'No active pilot';
    hudPilot.style.color = '#fff4d7';
    hudHealthFill.style.width = '100%';
    hudHealthFill.style.background = '#9de64e';
    hudRound.textContent = 'Round status';
    hudWeaponTitle.textContent = 'Weapon Ready';
    hudWeapon.textContent = 'Blast | Damage';
    hudPowerLabel.textContent = 'Charge';
    hudPowerFill.style.width = '0%';
    hudPowerFill.style.background = '#ff7a59';
    hudAngle.textContent = 'Angle';
    hudWind.textContent = 'Wind';
    hudWinner.textContent = 'No winner yet';
    hudCampaign.textContent = 'Campaign status';
    hudHint.textContent = 'Arrow left and right aim, arrow up and down change power, and space fires.';
    weaponSelect.innerHTML = '<option>Weapon</option>';
    weaponSelect.disabled = true;
    activeBoardTab = 'battle';
    syncBoardTabs();
    scoreChart.style.background = 'conic-gradient(#3a2a46 0deg 360deg)';
    scoreboard.innerHTML = '<p class="hud-subline">Damage and campaign tabs will update here once the battle starts.</p>';
}

function toCampaignPlayer(player: LobbyPlayer): CampaignPlayer {
    return {
        id: player.id,
        name: player.name,
        color: player.color,
        loadout: player.loadout,
        isHost: player.isHost,
        weapons: createWeaponsForLoadout(player.loadout),
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
        weapons: player.weapons.map((weapon) => ({ ...weapon }))
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

function escapeHtml(value: string) {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function escapeAttribute(value: string) {
    return escapeHtml(value);
}















