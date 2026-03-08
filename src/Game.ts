import { AudioManager } from './AudioManager';
import {
    clamp,
    cloneWeapons,
    getMaxPowerForHealth,
    getWeaponShopPrice,
    isCombatWeapon,
    lerp,
    normalizeAngle,
    LOGICAL_HEIGHT,
    LOGICAL_WIDTH,
    WEAPON_DEFINITIONS
} from './config';
import { Network } from './Network';
import { Particle } from './Particle';
import { Projectile } from './Projectile';
import { MatchState } from './State';
import { Tank } from './Tank';
import { Terrain } from './Terrain';
import type {
    DamageEvent,
    GameMessage,
    MatchSettings,
    MatchStartPayload,
    PlayerSnapshot,
    PlayerStatsSnapshot,
    TerrainTheme,
    WeaponState,
    WeaponType
} from './types';

function pickTerrainTheme(themes: TerrainTheme[], seed: number): TerrainTheme {
    const pool: TerrainTheme[] = themes.length ? themes : ['rolling'];
    const index = Math.abs(seed) % pool.length;
    return pool[index];
}
interface HudWeaponOption {
    index: number;
    label: string;
    detail: string;
    disabled: boolean;
}

interface HudScoreEntry {
    id: string;
    name: string;
    color: string;
    health: number;
    healthRatio: number;
    damage: number;
    totalDamage: number;
    hits: number;
    kills: number;
    score: number;
    roundWins: number;
    damageRatio: number;
    damageShare: number;
}

export interface HudSnapshot {
    turnLabel: string;
    pilotLabel: string;
    turnColor: string;
    roundLabel: string;
    campaignLabel: string;
    shieldPercent: number;
    healthPercent: number;
    weaponLabel: string;
    weaponDetail: string;
    powerLabel: string;
    powerPercent: number;
    angleLabel: string;
    selectedWeaponIndex: number;
    canSelectWeapon: boolean;
    weaponOptions: HudWeaponOption[];
    windLabel: string;
    hintLabel: string;
    winnerLabel: string;
    scoreboard: HudScoreEntry[];
}

interface RoundStats {
    damage: number;
    hits: number;
    kills: number;
    shots: number;
    spent: number;
    damageTaken: number;
}

interface CampaignStats {
    score: number;
    roundWins: number;
    totalDamage: number;
    totalHits: number;
    totalKills: number;
    totalShots: number;
    totalSpent: number;
    totalDamageTaken: number;
}
interface DamagePopup {
    x: number;
    y: number;
    text: string;
    color: string;
    life: number;
}

interface ShotTrace {
    color: string;
    points: Array<{ x: number; y: number }>;
}

interface TerrainDebris {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    life: number;
}

export interface RoundSummaryPlayer {
    id: string;
    name: string;
    color: string;
    weapons: WeaponState[];
    shield: number;
    stats: PlayerStatsSnapshot;
}

export interface RoundSummary {
    roundNumber: number;
    winnerId: string | null;
    players: RoundSummaryPlayer[];
}

interface GameOptions extends MatchStartPayload {
    localPlayerId: string;
    network: Network | null;
    audio: AudioManager;
    onHudUpdate?: (snapshot: HudSnapshot) => void;
    onRoundEnd?: (summary: RoundSummary) => void;
}

const FIXED_STEP_MS = 1000 / 60;

export class Game {
    private readonly ctx: CanvasRenderingContext2D;
    private readonly terrain: Terrain;
    private readonly players: Tank[];
    private readonly state = new MatchState();
    private readonly localPlayerId: string;
    private readonly network: Network | null;
    private readonly audio: AudioManager;
    private readonly isAuthoritative: boolean;
    private readonly onHudUpdate?: (snapshot: HudSnapshot) => void;
    private readonly onRoundEnd?: (summary: RoundSummary) => void;
    private readonly settings: MatchSettings;
    private readonly constantWindValue: number;
    private readonly roundNumber: number;
    private readonly stars: Array<{ x: number; y: number; size: number; alpha: number }> = [];
    private readonly roundStatsById = new Map<string, RoundStats>();
    private readonly campaignById = new Map<string, CampaignStats>();

    private particles: Particle[] = [];
    private projectiles: Projectile[] = [];
    private pendingProjectiles: Array<{ delayMs: number; projectile: Projectile }> = [];
    private shotTraces: ShotTrace[] = [];
    private damagePopups: DamagePopup[] = [];
    private debris: TerrainDebris[] = [];
    private running = false;
    private lastFrame = 0;
    private accumulator = 0;
    private randomState = 0;
    private resolveTimer = 0;
    private aimBroadcastAt = 0;
    private awaitingShotResult = false;
    private screenShake = 0;
    private roundEndEmitted = false;
    private turnInteractionStarted = false;
    private botAimTimer: number | null = null;
    private botFireTimer: number | null = null;

    private readonly handleKeyDown = (event: KeyboardEvent) => {
        if (!this.canLocalControlCurrentTank()) return;
        const tank = this.currentPlayer;
        if (!tank) return;
        this.turnInteractionStarted = true;

        let changedAim = false;
        const angleStep = event.ctrlKey ? Math.PI / 180 : 0.045;
        const powerStep = event.ctrlKey ? 1 : 4;
        switch (event.key) {
            case 'ArrowLeft':
                tank.setAim(tank.angle - angleStep, tank.power, this.settings.powerRule);
                changedAim = true;
                break;
            case 'ArrowRight':
                tank.setAim(tank.angle + angleStep, tank.power, this.settings.powerRule);
                changedAim = true;
                break;
            case 'ArrowUp':
                tank.setAim(tank.angle, tank.power + powerStep, this.settings.powerRule);
                changedAim = true;
                break;
            case 'ArrowDown':
                tank.setAim(tank.angle, tank.power - powerStep, this.settings.powerRule);
                changedAim = true;
                break;
            case 'q':
            case 'Q':
                tank.cycleWeapon(-1);
                changedAim = true;
                break;
            case 'e':
            case 'E':
                tank.cycleWeapon(1);
                changedAim = true;
                break;
            case ' ':
            case 'Enter':
                event.preventDefault();
                void this.audio.unlock();
                this.requestFire();
                return;
            default:
                return;
        }

        event.preventDefault();
        if (changedAim) {
            this.turnInteractionStarted = true;
            void this.audio.unlock();
            this.audio.playAimTick();
            this.broadcastAimState();
        }
    };

    constructor(canvas: HTMLCanvasElement, options: GameOptions) {
        const context = canvas.getContext('2d');
        if (!context) {
            throw new Error('Unable to create drawing context');
        }

        this.ctx = context;
        this.ctx.imageSmoothingEnabled = false;
        this.terrain = new Terrain(LOGICAL_WIDTH, LOGICAL_HEIGHT, options.seed, pickTerrainTheme(options.settings.terrainThemes, options.seed));
        this.players = options.players.map((player) => new Tank(player));
        this.localPlayerId = options.localPlayerId;
        this.network = options.network;
        this.audio = options.audio;
        this.onHudUpdate = options.onHudUpdate;
        this.onRoundEnd = options.onRoundEnd;
        this.settings = options.settings;
        this.roundNumber = options.roundNumber;
        this.constantWindValue = options.settings.windMode === 'constant' ? options.wind : 0;
        this.isAuthoritative = !options.network || options.network.role === 'host';
        this.randomState = (options.seed ^ 0x9e3779b9) >>> 0;

        this.state.currentPlayerIndex = options.currentPlayerIndex;
        this.state.wind = options.wind;
        this.state.turnNumber = options.turnNumber;
        this.turnInteractionStarted = false;

        this.players.forEach((player) => {
            this.roundStatsById.set(player.id, this.createRoundStats());
            const existing = options.campaignStats.find((entry) => entry.id === player.id);
            this.campaignById.set(player.id, existing ? this.toCampaignStats(existing) : this.createCampaignStats());
            player.prepareForBattle(this.settings.powerRule);
        });

        this.placePlayers();
        this.generateBackdrop();
    }

    public start() {
        if (this.running) return;
        this.running = true;
        this.lastFrame = performance.now();
        this.audio.startMusic();
        window.addEventListener('keydown', this.handleKeyDown);

        if (this.network) {
            this.network.onGameMessage = (message, senderId) => {
                this.handleNetworkMessage(message, senderId);
            };
        }

        this.emitHud();
        this.queueBotTurnIfNeeded();
        requestAnimationFrame((timestamp) => this.frame(timestamp));
    }

    public stop() {
        this.running = false;
        this.clearBotTimers();
        window.removeEventListener('keydown', this.handleKeyDown);
    }

    public selectWeapon(index: number) {
        if (!this.canLocalControlCurrentTank()) return;
        const tank = this.currentPlayer;
        if (!tank) return;
        if (!tank.weapons[index] || tank.weapons[index].ammo === 0 || !isCombatWeapon(tank.weapons[index].type)) return;
        tank.selectedWeaponIndex = index;
        this.turnInteractionStarted = true;
        this.broadcastAimState();
        this.emitHud();
    }

    private get currentPlayer() {
        return this.players[this.state.currentPlayerIndex] ?? null;
    }

    private frame(timestamp: number) {
        if (!this.running) return;
        const delta = Math.min(50, timestamp - this.lastFrame);
        this.lastFrame = timestamp;
        this.accumulator += delta;

        while (this.accumulator >= FIXED_STEP_MS) {
            this.step();
            this.accumulator -= FIXED_STEP_MS;
        }

        this.draw();
        requestAnimationFrame((nextTimestamp) => this.frame(nextTimestamp));
    }

    private step() {
        for (let index = this.pendingProjectiles.length - 1; index >= 0; index -= 1) {
            const pending = this.pendingProjectiles[index];
            pending.delayMs -= FIXED_STEP_MS;
            if (pending.delayMs <= 0) {
                this.projectiles.push(pending.projectile);
                this.pendingProjectiles.splice(index, 1);
            }
        }

        for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
            const projectile = this.projectiles[index];
            const impact = projectile.step(this.terrain, this.players, this.state.gravity, this.state.wind);
            if (!impact && projectile.shouldSplit(this.terrain)) {
                this.persistShotTrace(projectile.ownerId, projectile.history);
                this.projectiles.splice(index, 1, ...projectile.split());
                continue;
            }
            if (!impact) continue;

            this.projectiles.splice(index, 1);
            if (this.isAuthoritative) {
                this.persistShotTrace(projectile.ownerId, projectile.history);
                const chaosLimit = this.getChaosFollowupLimit(projectile.weaponType);
                if (chaosLimit >= 0 && projectile.chaosDepth < chaosLimit) {
                    const followX = clamp(impact.x, 2, LOGICAL_WIDTH - 3);
                    const followY = clamp(impact.y - 2, 2, LOGICAL_HEIGHT - 3);
                    const followAngle = this.nextChaosAngle(impact.x, impact.y, projectile.ownerId, projectile.chaosDepth);
                    const followup = projectile.createChaosFollowup(followX, followY, followAngle);
                    this.projectiles.push(followup);
                    this.audio.playFire(projectile.weaponType === 'large_chaos' || projectile.weaponType === 'large_chaos_mirv' ? 'large_chaos' : 'chaos');
                    if (this.network?.role === 'host') {
                        this.network.sendGameMessage({
                            kind: 'SHOT_FIRED',
                            playerId: projectile.ownerId,
                            angle: followAngle,
                            power: projectile.launchPower,
                            weaponIndex: -1,
                            weaponType: followup.weaponType,
                            startX: followX,
                            startY: followY,
                            turnNumber: this.state.turnNumber,
                            consumeAmmo: false,
                            chaosDepth: followup.chaosDepth
                        });
                    }
                }
                this.resolveShot(projectile.ownerId, projectile.weaponType, impact.x, impact.y, projectile.vx, projectile.vy);
            } else {
                this.awaitingShotResult = this.projectiles.length > 0 || this.pendingProjectiles.length > 0;
            }
        }

        const terrainMoved = this.settings.terrainCollapse ? this.terrain.stepCollapse() : false;
        const debrisMoved = this.updateDebris();
        const tankMoved = this.settlePlayers();

        for (let index = this.particles.length - 1; index >= 0; index -= 1) {
            const particle = this.particles[index];
            particle.step(this.state.wind);
            if (particle.life <= 0) this.particles.splice(index, 1);
        }

        for (let index = this.damagePopups.length - 1; index >= 0; index -= 1) {
            const popup = this.damagePopups[index];
            popup.life -= 1;
            popup.y -= 0.22;
            if (popup.life <= 0) this.damagePopups.splice(index, 1);
        }

        this.screenShake = Math.max(0, this.screenShake - 0.18);

        if (this.state.phase === 'settling') {
            this.resolveTimer = Math.max(0, this.resolveTimer - FIXED_STEP_MS / 1000);
            if (this.isAuthoritative && this.resolveTimer <= 0 && !tankMoved && !terrainMoved && !debrisMoved && this.projectiles.length === 0 && this.pendingProjectiles.length === 0) {
                this.advanceTurn();
            }
        }
    }
    private handleNetworkMessage(message: GameMessage, senderId: string) {
        switch (message.kind) {
            case 'AIM_STATE':
                this.handleAimMessage(message, senderId);
                break;
            case 'FIRE_REQUEST':
                if (this.isAuthoritative) this.handleFireRequest(message, senderId);
                break;
            case 'SHOT_FIRED':
                if (!this.isAuthoritative) this.spawnNetworkProjectile(message);
                break;
            case 'SHOT_RESULT':
                if (!this.isAuthoritative) {
                    this.applyRemoteShotResult(message.weaponType, message.impactX, message.impactY, message.impactDirX, message.impactDirY, message.damageEvents, message.playerStates, message.stats, message.turnNumber);
                }
                break;
            case 'TURN_STATE':
                if (!this.isAuthoritative) {
                    this.applyTurnState(message.currentPlayerIndex, message.wind, message.turnNumber, message.winnerId, message.playerStates, message.stats, message.roundNumber);
                }
                break;
            default:
                break;
        }
    }

    private handleAimMessage(message: Extract<GameMessage, { kind: 'AIM_STATE' }>, senderId: string) {
        if (message.turnNumber !== this.state.turnNumber) return;
        const player = this.players.find((entry) => entry.id === message.playerId);
        if (!player) return;

        if (this.isAuthoritative) {
            if (senderId !== player.id) return;
            if (this.currentPlayer?.id !== player.id || this.state.phase !== 'aiming') return;
            player.selectedWeaponIndex = clamp(message.weaponIndex, 0, player.weapons.length - 1);
            player.setAim(message.angle, message.power, this.settings.powerRule);
            player.ensureWeaponAvailable();
            this.turnInteractionStarted = true;
            this.network?.sendGameMessage(message);
            return;
        }

        player.selectedWeaponIndex = clamp(message.weaponIndex, 0, player.weapons.length - 1);
        player.setAim(message.angle, message.power, this.settings.powerRule);
        player.ensureWeaponAvailable();
    }

    private handleFireRequest(message: Extract<GameMessage, { kind: 'FIRE_REQUEST' }>, senderId: string) {
        if (message.turnNumber !== this.state.turnNumber) return;
        if (senderId !== message.playerId) return;
        const player = this.players.find((entry) => entry.id === message.playerId);
        if (!player || this.currentPlayer?.id !== player.id || this.state.phase !== 'aiming') return;
        player.selectedWeaponIndex = clamp(message.weaponIndex, 0, player.weapons.length - 1);
        player.setAim(message.angle, message.power, this.settings.powerRule);
        this.launchProjectile(player);
    }

    private requestFire() {
        if (!this.canLocalControlCurrentTank()) return;
        const tank = this.currentPlayer;
        if (!tank) return;

        if (!this.network || this.network.role === 'host') {
            this.launchProjectile(tank);
            return;
        }

        this.state.phase = 'projectile';
        this.awaitingShotResult = true;
        this.network.sendGameMessage({
            kind: 'FIRE_REQUEST',
            playerId: tank.id,
            angle: tank.angle,
            power: tank.power,
            weaponIndex: tank.selectedWeaponIndex,
            turnNumber: this.state.turnNumber
        });
    }

    private launchProjectile(tank: Tank) {
        if (this.state.phase !== 'aiming') return;
        this.turnInteractionStarted = true;
        const firedWeaponIndex = tank.selectedWeaponIndex;
        const firedWeapon = tank.consumeSelectedWeapon();
        if (!firedWeapon) return;

        const barrelTip = tank.barrelTip;
        this.recordShot(tank.id, this.getWeaponShotCount(firedWeapon.type));
        this.recordOrdnanceSpend(tank.id, firedWeapon.type);
        const burst = this.createProjectileBurst(barrelTip.x, barrelTip.y, tank.angle, tank.power, tank.id, firedWeapon.type);
        this.setActiveProjectilesFromBurst(burst, firedWeapon.type);
        this.state.phase = 'projectile';
        this.awaitingShotResult = !this.isAuthoritative;
        this.audio.playFire(firedWeapon.type);

        if (this.network?.role === 'host') {
            this.network.sendGameMessage({
                kind: 'SHOT_FIRED',
                playerId: tank.id,
                angle: tank.angle,
                power: tank.power,
                weaponIndex: firedWeaponIndex,
                weaponType: firedWeapon.type,
                startX: barrelTip.x,
                startY: barrelTip.y,
                turnNumber: this.state.turnNumber
            });
        }
    }
    private spawnNetworkProjectile(message: Extract<GameMessage, { kind: 'SHOT_FIRED' }>) {
        if (message.turnNumber !== this.state.turnNumber) return;
        const player = this.players.find((entry) => entry.id === message.playerId);
        if (!player) return;
        player.setAim(message.angle, message.power, this.settings.powerRule);
        let burst: Projectile[];
        if (message.consumeAmmo === false) {
            burst = [
                new Projectile(
                    message.startX,
                    message.startY,
                    message.angle,
                    message.power,
                    message.playerId,
                    message.weaponType,
                    undefined,
                    false,
                    message.power,
                    message.chaosDepth ?? 0
                )
            ];
        } else {
            player.selectedWeaponIndex = clamp(message.weaponIndex, 0, player.weapons.length - 1);
            player.consumeSelectedWeapon();
            burst = this.createProjectileBurst(message.startX, message.startY, message.angle, message.power, message.playerId, message.weaponType);
        }
        this.setActiveProjectilesFromBurst(burst, message.weaponType);
        this.state.phase = 'projectile';
        this.awaitingShotResult = true;
        this.audio.playFire(message.weaponType);
    }
    private resolveShot(ownerId: string, weaponType: WeaponType, impactX: number, impactY: number, impactDirX: number, impactDirY: number) {
        const bursts = this.buildImpactBursts(weaponType, impactX, impactY, impactDirX, impactDirY);
        const damageEvents = this.applyWeaponImpact(ownerId, weaponType, bursts);
        const maxBlastRadius = Math.max(1, ...bursts.map((burst) => Math.max(1, burst.radius)));
        this.spawnDamagePopups(damageEvents);
        const hasMoreProjectiles = this.projectiles.length > 0 || this.pendingProjectiles.length > 0;
        this.resolveTimer = hasMoreProjectiles ? 0 : 0.85;
        this.state.phase = hasMoreProjectiles ? 'projectile' : 'settling';
        this.awaitingShotResult = false;
        if (!this.isSilentImpactWeapon(weaponType)) {
            this.audio.playExplosion(maxBlastRadius);
            this.screenShake = Math.max(this.screenShake, maxBlastRadius / 5);
        }

        if (this.network?.role === 'host') {
            this.network.sendGameMessage({
                kind: 'SHOT_RESULT',
                impactX,
                impactY,
                impactDirX,
                impactDirY,
                weaponType,
                damageEvents,
                playerStates: this.snapshotPlayers(),
                stats: this.snapshotStats(),
                turnNumber: this.state.turnNumber
            });
        }
    }
    private applyRemoteShotResult(
        weaponType: WeaponType,
        impactX: number,
        impactY: number,
        impactDirX: number,
        impactDirY: number,
        damageEvents: DamageEvent[],
        playerStates: PlayerSnapshot[],
        stats: PlayerStatsSnapshot[],
        turnNumber: number
    ) {
        if (turnNumber !== this.state.turnNumber) return;
        this.reconcileRemoteProjectile(weaponType, impactX, impactY, damageEvents[0]?.attackerId);
        const bursts = this.buildImpactBursts(weaponType, impactX, impactY, impactDirX, impactDirY);
        const maxBlastRadius = Math.max(1, ...bursts.map((burst) => Math.max(1, burst.radius)));
        this.awaitingShotResult = this.projectiles.length > 0 || this.pendingProjectiles.length > 0;
        if (this.isUtilityImpactWeapon(weaponType)) {
            this.applyUtilityImpact(damageEvents[0]?.attackerId ?? this.currentPlayer?.id ?? '', weaponType, bursts);
        } else {
            bursts.forEach((burst) => {
                this.terrain.carveCircle(burst.x, burst.y, burst.radius);
                this.spawnExplosion(burst.x, burst.y, weaponType);
            });
        }
        this.applySnapshots(playerStates);
        this.applyStats(stats);
        this.spawnKillDebrisFromEvents(damageEvents);
        this.spawnDamagePopups(damageEvents);
        const hasMoreProjectiles = this.projectiles.length > 0 || this.pendingProjectiles.length > 0;
        this.resolveTimer = hasMoreProjectiles ? 0 : 0.85;
        this.state.phase = hasMoreProjectiles ? 'projectile' : 'settling';
        if (!this.isSilentImpactWeapon(weaponType)) {
            this.audio.playExplosion(maxBlastRadius);
            this.screenShake = Math.max(this.screenShake, maxBlastRadius / 5);
        }
    }
    private applyTurnState(
        currentPlayerIndex: number,
        wind: number,
        turnNumber: number,
        winnerId: string | null,
        playerStates: PlayerSnapshot[],
        stats: PlayerStatsSnapshot[],
        roundNumber: number
    ) {
        if (roundNumber !== this.roundNumber) return;
        this.projectiles = [];
        this.pendingProjectiles = [];
        this.awaitingShotResult = false;
        this.applySnapshots(playerStates);
        this.applyStats(stats);
        this.state.currentPlayerIndex = currentPlayerIndex;
        this.state.wind = wind;
        this.state.turnNumber = turnNumber;
        this.state.winnerId = winnerId;
        this.state.phase = winnerId ? 'game_over' : 'aiming';
        this.turnInteractionStarted = false;
        if (winnerId) {
            this.clearBotTimers();
            this.emitRoundEndOnce();
        } else {
            this.queueBotTurnIfNeeded();
        }
    }
    private advanceTurn() {
        const livingPlayers = this.players.filter((player) => player.alive);
        if (livingPlayers.length <= 1) {
            this.finishRound(livingPlayers[0]?.id ?? null);
            return;
        }

        let nextIndex = this.state.currentPlayerIndex;
        do {
            nextIndex = (nextIndex + 1) % this.players.length;
        } while (!this.players[nextIndex].alive);

        this.state.currentPlayerIndex = nextIndex;
        this.state.turnNumber += 1;
        this.state.wind = this.nextWind();
        this.state.phase = 'aiming';
        this.turnInteractionStarted = false;
        this.emitTurnState();
        this.queueBotTurnIfNeeded();
    }

    private finishRound(winnerId: string | null) {
        this.state.winnerId = winnerId;
        this.state.phase = 'game_over';

        const placements = this.buildPlacementOrder(winnerId);
        placements.forEach((playerId, index) => {
            const campaign = this.campaignById.get(playerId);
            if (!campaign) return;
            if (index === 0 && winnerId) {
                campaign.roundWins += 1;
            }
            campaign.score += this.calculatePlacementScore(index);
        });

        this.emitTurnState();
        this.emitRoundEndOnce();
    }

    private emitTurnState() {
        if (this.network?.role !== 'host') return;
        this.network.sendGameMessage({
            kind: 'TURN_STATE',
            currentPlayerIndex: this.state.currentPlayerIndex,
            wind: this.state.wind,
            turnNumber: this.state.turnNumber,
            winnerId: this.state.winnerId,
            playerStates: this.snapshotPlayers(),
            stats: this.snapshotStats(),
            roundNumber: this.roundNumber,
            seed: 0,
            campaignComplete: this.roundNumber >= this.settings.rounds
        });
    }

    private emitRoundEndOnce() {
        if (this.roundEndEmitted) return;
        this.roundEndEmitted = true;
        this.onRoundEnd?.({
            roundNumber: this.roundNumber,
            winnerId: this.state.winnerId,
            players: this.players.map((player) => ({
                id: player.id,
                name: player.name,
                color: player.color,
                health: player.health,
                healthRatio: player.health / 100,
                shield: player.shield,
                weapons: cloneWeapons(player.weapons),
                stats: this.snapshotStats().find((entry) => entry.id === player.id) ?? this.createStatsSnapshot(player.id)
            }))
        });
    }
    private settlePlayers() {
        let moved = false;
        for (const tank of this.players) {
            if (!tank.alive) continue;
            let pushedUp = 0;
            while (this.tankIntersectsTerrain(tank) && pushedUp < 14) {
                tank.y -= 1;
                pushedUp += 1;
                moved = true;
            }

            if (tank.y >= LOGICAL_HEIGHT - 1) {
                tank.y = LOGICAL_HEIGHT - 1;
                tank.verticalVelocity = 0;
            } else if (this.isTankSupported(tank)) {
                tank.verticalVelocity = 0;
            } else {
                tank.verticalVelocity = Math.min(tank.verticalVelocity + 0.16, 3.6);
                const fallDistance = Math.max(1, Math.round(tank.verticalVelocity));
                for (let stepIndex = 0; stepIndex < fallDistance; stepIndex += 1) {
                    tank.y += 1;
                    moved = true;
                    if (this.tankIntersectsTerrain(tank)) {
                        tank.y -= 1;
                        tank.verticalVelocity = 0;
                        break;
                    }
                    if (tank.y > LOGICAL_HEIGHT + 14) {
                        tank.health = 0;
                        break;
                    }
                }
            }
        }
        return moved;
    }

    private tankIntersectsTerrain(tank: Tank) {
        for (let y = Math.round(tank.y - tank.bodyHeight); y <= Math.round(tank.y - 1); y += 1) {
            for (let x = Math.round(tank.x - tank.bodyWidth / 2 + 1); x <= Math.round(tank.x + tank.bodyWidth / 2 - 1); x += 1) {
                if (this.terrain.isSolid(x, y)) return true;
            }
        }
        return false;
    }

    private isTankSupported(tank: Tank) {
        const supportY = Math.round(tank.y + 1);
        if (supportY >= LOGICAL_HEIGHT - 1) return true;
        for (let x = Math.round(tank.x - tank.bodyWidth / 2 + 1); x <= Math.round(tank.x + tank.bodyWidth / 2 - 1); x += 1) {
            if (this.terrain.isSolid(x, supportY)) return true;
        }
        return false;
    }

    private damagePlayers(ownerId: string, centerX: number, centerY: number, radius: number, damage: number) {
        const damageEvents: DamageEvent[] = [];
        for (const tank of this.players) {
            if (!tank.alive) continue;
            const targetY = tank.y - tank.bodyHeight / 2;
            const distance = Math.hypot(tank.x - centerX, targetY - centerY);
            if (distance > radius + 10) continue;

            const actualDamage = Math.max(0, Math.round(damage * (1 - distance / (radius + 10))));
            if (actualDamage <= 0) continue;

            const previousHealth = tank.health;
            const absorbedByShield = tank.applyShieldDamage(actualDamage);
            const remainingDamage = Math.max(0, actualDamage - absorbedByShield);
            if (remainingDamage > 0) {
                tank.health = Math.max(0, tank.health - remainingDamage);
                tank.syncPowerCap(this.settings.powerRule);
            }

            const totalDamageTaken = absorbedByShield + remainingDamage;
            const killed = previousHealth > 0 && tank.health === 0;
            const targetRoundStats = this.roundStatsById.get(tank.id);
            if (targetRoundStats) targetRoundStats.damageTaken += totalDamageTaken;
            const targetCampaign = this.campaignById.get(tank.id);
            if (targetCampaign) targetCampaign.totalDamageTaken += totalDamageTaken;

            const isSelfHit = tank.id === ownerId;
            if (!isSelfHit) {
                const shooterRoundStats = this.roundStatsById.get(ownerId);
                if (shooterRoundStats) {
                    shooterRoundStats.damage += totalDamageTaken;
                    shooterRoundStats.hits += 1;
                    if (killed) shooterRoundStats.kills += 1;
                }

                const shooterCampaign = this.campaignById.get(ownerId);
                if (shooterCampaign) {
                    shooterCampaign.totalDamage += totalDamageTaken;
                    shooterCampaign.totalHits += 1;
                    shooterCampaign.score += this.calculateScoreDelta(totalDamageTaken, false);
                    if (killed) {
                        shooterCampaign.totalKills += 1;
                        shooterCampaign.score += this.calculateScoreDelta(0, true);
                    }
                }
            }

            if (killed) {
                this.spawnKillDebris(tank);
            }

            damageEvents.push({
                attackerId: ownerId,
                targetId: tank.id,
                amount: totalDamageTaken,
                x: tank.x,
                y: tank.y - tank.bodyHeight - 3,
                killed
            });
        }
        return damageEvents;
    }

    private calculateScoreDelta(damage: number, killed: boolean) {
        let delta = 0;
        if (this.settings.scoring.awardDamage) {
            delta += damage * this.settings.scoring.damagePointValue;
        }
        if (killed && this.settings.scoring.awardKills) {
            delta += this.settings.scoring.killPointValue;
        }
        return delta;
    }

    private calculatePlacementScore(placementIndex: number) {
        if (!this.settings.scoring.awardPlacement) return 0;
        if (placementIndex === 0) return this.settings.scoring.firstPlacePoints;
        if (placementIndex === 1) return this.settings.scoring.secondPlacePoints;
        if (placementIndex === 2) return this.settings.scoring.thirdPlacePoints;
        return 0;
    }

    private buildPlacementOrder(winnerId: string | null) {
        const ranked = this.players.slice().sort((left, right) => {
            if (winnerId && left.id === winnerId) return -1;
            if (winnerId && right.id === winnerId) return 1;
            const leftRound = this.roundStatsById.get(left.id) ?? this.createRoundStats();
            const rightRound = this.roundStatsById.get(right.id) ?? this.createRoundStats();
            return rightRound.damage - leftRound.damage
                || rightRound.kills - leftRound.kills
                || right.health - left.health
                || rightRound.hits - leftRound.hits;
        });
        return ranked.map((player) => player.id);
    }

    private spawnDamagePopups(damageEvents: DamageEvent[]) {
        damageEvents.forEach((event) => {
            const attacker = this.players.find((player) => player.id === event.attackerId);
            this.damagePopups.push({
                x: event.x,
                y: event.y,
                text: `${event.amount}`,
                color: attacker?.color ?? '#fff5d6',
                life: 48
            });
        });
    }

    private spawnKillDebrisFromEvents(damageEvents: DamageEvent[]) {
        damageEvents.forEach((event) => {
            if (!event.killed) return;
            const target = this.players.find((player) => player.id === event.targetId);
            if (target) this.spawnKillDebris(target);
        });
    }

    private spawnKillDebris(tank: Tank) {
        for (let y = 0; y < tank.bodyHeight + 2; y += 1) {
            for (let x = 0; x < tank.bodyWidth; x += 1) {
                const localX = x - tank.bodyWidth / 2 + 0.5;
                const localY = y - tank.bodyHeight + 0.5;
                const hash = ((x + 3) * 17 + (y + 5) * 11) % 7;
                this.debris.push({
                    x: tank.x + localX,
                    y: tank.y + localY,
                    vx: localX * 0.08 + (hash - 3) * 0.03,
                    vy: -0.85 - Math.abs(localY) * 0.05 - hash * 0.02,
                    color: tank.color,
                    life: 120
                });
            }
        }
    }

    private updateDebris() {
        let moved = false;
        for (let index = this.debris.length - 1; index >= 0; index -= 1) {
            const chunk = this.debris[index];
            chunk.life -= 1;
            chunk.vx += this.state.wind * 0.002;
            chunk.vy = Math.min(chunk.vy + 0.05, 2.8);
            chunk.x += chunk.vx;
            chunk.y += chunk.vy;

            if (chunk.life <= 0 || chunk.x < 0 || chunk.x >= LOGICAL_WIDTH) {
                this.debris.splice(index, 1);
                continue;
            }

            const pixelX = Math.round(chunk.x);
            const pixelY = Math.round(chunk.y);
            if (pixelY >= LOGICAL_HEIGHT - 1) {
                this.terrain.depositPixel(pixelX, LOGICAL_HEIGHT - 1, chunk.color);
                this.debris.splice(index, 1);
                moved = true;
                continue;
            }

            if (pixelY >= 0 && this.terrain.isSolid(pixelX, pixelY + 1)) {
                this.terrain.depositPixel(pixelX, pixelY, chunk.color);
                this.debris.splice(index, 1);
                moved = true;
            }
        }
        return moved;
    }

    private spawnExplosion(centerX: number, centerY: number, weaponType: WeaponType) {
        const definition = WEAPON_DEFINITIONS[weaponType];
        const sparks = 12 + Math.round(definition.blastRadius * 1.6);
        const smoke = 5 + Math.round(definition.blastRadius * 0.45);
        for (let index = 0; index < sparks; index += 1) {
            const angle = this.nextRandom() * Math.PI * 2;
            const speed = 0.4 + this.nextRandom() * (definition.blastRadius / 8);
            this.particles.push(new Particle(centerX, centerY, Math.cos(angle) * speed, Math.sin(angle) * speed, 1, definition.projectileColor, 'spark', 18));
        }
        for (let index = 0; index < sparks; index += 1) {
            const angle = this.nextRandom() * Math.PI * 2;
            const speed = 0.2 + this.nextRandom() * (definition.blastRadius / 10);
            this.particles.push(new Particle(centerX, centerY, Math.cos(angle) * speed, Math.sin(angle) * speed, 1, '#8d5a3a', 'dust', 24));
        }
        for (let index = 0; index < smoke; index += 1) {
            this.particles.push(new Particle(centerX + this.nextRandom() * 4 - 2, centerY + this.nextRandom() * 2 - 1, this.nextRandom() * 0.4 - 0.2, -0.25 - this.nextRandom() * 0.3, 2, '#5d5366', 'smoke', 34));
        }
    }
    private persistShotTrace(ownerId: string, history: Array<{ x: number; y: number }>) {
        const owner = this.players.find((player) => player.id === ownerId);
        if (!owner || history.length < 2) return;
        this.shotTraces.push({ color: owner.color, points: history.map((point) => ({ x: point.x, y: point.y })) });
        if (this.shotTraces.length > 90) this.shotTraces.shift();
    }


    private reconcileRemoteProjectile(weaponType: WeaponType, impactX: number, impactY: number, ownerId?: string) {
        const candidates = this.projectiles
            .map((projectile, index) => ({ projectile, index }))
            .filter(({ projectile }) => projectile.weaponType === weaponType && (!ownerId || projectile.ownerId === ownerId));
        if (!candidates.length) return;

        const best = candidates
            .map(({ projectile, index }) => {
                let bestDistance = Number.POSITIVE_INFINITY;
                let bestHistoryIndex = projectile.history.length - 1;
                projectile.history.forEach((point, historyIndex) => {
                    const distance = Math.hypot(point.x - impactX, point.y - impactY);
                    if (distance < bestDistance) {
                        bestDistance = distance;
                        bestHistoryIndex = historyIndex;
                    }
                });
                return { projectile, index, bestDistance, bestHistoryIndex };
            })
            .sort((left, right) => left.bestDistance - right.bestDistance)[0];

        this.projectiles.splice(best.index, 1);
        const traceHistory = best.projectile.history
            .slice(0, Math.max(1, best.bestHistoryIndex + 1))
            .map((point) => ({ x: point.x, y: point.y }));
        const lastPoint = traceHistory[traceHistory.length - 1];
        if (!lastPoint || Math.round(lastPoint.x) !== impactX || Math.round(lastPoint.y) !== impactY) {
            traceHistory.push({ x: impactX, y: impactY });
        }
        this.persistShotTrace(best.projectile.ownerId, traceHistory);
    }
    private draw() {
        const shakeX = this.screenShake > 0 ? Math.round((this.nextRandom() - 0.5) * this.screenShake) : 0;
        const shakeY = this.screenShake > 0 ? Math.round((this.nextRandom() - 0.5) * this.screenShake) : 0;

        this.ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        this.ctx.save();
        this.ctx.translate(shakeX, shakeY);
        this.drawSky();
        this.drawMountains();
        this.terrain.draw(this.ctx);
        this.drawShotTraces();
        this.drawDebris();
        this.particles.forEach((particle) => particle.draw(this.ctx));
        const currentPlayerId = this.currentPlayer?.id ?? null;
        const showTurnPrompt = this.state.phase === 'aiming' && !this.turnInteractionStarted;
        const promptPulse = (Math.sin(performance.now() * 0.012) + 1) * 0.5;
        this.players.forEach((tank) => {
            if (tank.alive) {
                tank.draw(this.ctx, {
                    showTurnPrompt: showTurnPrompt && tank.id === currentPlayerId,
                    promptPulse,
                    showShield: this.settings.shieldVisibility
                });
            }
        });
        this.projectiles.forEach((projectile) => projectile.draw(this.ctx));
        this.drawDamagePopups();
        this.ctx.restore();
        this.emitHud();
    }

    private drawSky() {
        this.ctx.fillStyle = '#1a1030';
        this.ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
        this.ctx.fillStyle = '#24143c';
        this.ctx.fillRect(0, Math.round(LOGICAL_HEIGHT * 0.15), LOGICAL_WIDTH, Math.round(LOGICAL_HEIGHT * 0.24));
        this.ctx.fillStyle = '#341b4c';
        this.ctx.fillRect(0, Math.round(LOGICAL_HEIGHT * 0.39), LOGICAL_WIDTH, Math.round(LOGICAL_HEIGHT * 0.21));
        this.ctx.fillStyle = '#6d3550';
        this.ctx.fillRect(0, Math.round(LOGICAL_HEIGHT * 0.60), LOGICAL_WIDTH, Math.round(LOGICAL_HEIGHT * 0.12));
        this.stars.forEach((star) => {
            this.ctx.save();
            this.ctx.globalAlpha = star.alpha;
            this.ctx.fillStyle = '#fff1d0';
            this.ctx.fillRect(star.x, star.y, star.size, star.size);
            this.ctx.restore();
        });
        const moonX = Math.round(LOGICAL_WIDTH * 0.08);
        const moonY = Math.round(LOGICAL_HEIGHT * 0.12);
        this.ctx.fillStyle = '#f3b47a';
        this.ctx.fillRect(moonX, moonY, 12, 12);
        this.ctx.fillStyle = '#ffd9a0';
        this.ctx.fillRect(moonX + 3, moonY + 3, 5, 5);
    }

    private drawMountains() {
        this.drawMountainRange([[0, 0.7], [0.12, 0.48], [0.28, 0.7], [0.42, 0.44], [0.58, 0.72], [0.72, 0.5], [0.88, 0.74], [1, 0.52]], '#2f2340');
        this.drawMountainRange([[0, 0.8], [0.1, 0.6], [0.24, 0.78], [0.4, 0.56], [0.55, 0.82], [0.7, 0.62], [0.88, 0.84], [1, 0.68]], '#46335d');
    }

    private drawMountainRange(points: number[][], color: string) {
        this.ctx.fillStyle = color;
        this.ctx.beginPath();
        this.ctx.moveTo(0, LOGICAL_HEIGHT);
        points.forEach(([xRatio, yRatio]) => {
            this.ctx.lineTo(Math.round(xRatio * LOGICAL_WIDTH), Math.round(yRatio * LOGICAL_HEIGHT));
        });
        this.ctx.lineTo(LOGICAL_WIDTH, LOGICAL_HEIGHT);
        this.ctx.closePath();
        this.ctx.fill();
    }

    private drawShotTraces() {
        this.shotTraces.forEach((trace) => {
            if (trace.points.length < 2) return;
            this.ctx.save();
            this.ctx.strokeStyle = this.colorWithAlpha(trace.color, 0.42);
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.moveTo(trace.points[0].x, trace.points[0].y);
            for (let index = 1; index < trace.points.length; index += 1) {
                this.ctx.lineTo(trace.points[index].x, trace.points[index].y);
            }
            this.ctx.stroke();
            this.ctx.restore();
        });
    }

    private drawDebris() {
        this.debris.forEach((chunk) => {
            this.ctx.fillStyle = chunk.color;
            this.ctx.fillRect(Math.round(chunk.x), Math.round(chunk.y), 1, 1);
        });
    }

    private drawDamagePopups() {
        this.damagePopups.forEach((popup) => {
            this.ctx.save();
            this.ctx.globalAlpha = popup.life / 48;
            this.ctx.fillStyle = popup.color;
            this.ctx.font = '8px monospace';
            this.ctx.textAlign = 'center';
            this.ctx.fillText(popup.text, popup.x, popup.y);
            this.ctx.restore();
        });
    }

    private emitHud() {
        if (!this.onHudUpdate) return;
        const currentPlayer = this.currentPlayer;
        const winner = this.players.find((player) => player.id === this.state.winnerId);

        if (!currentPlayer) {
            this.onHudUpdate({
                turnLabel: 'No active turn',
                pilotLabel: 'Waiting for players',
                turnColor: '#fff4d7',
                roundLabel: 'Round -',
                campaignLabel: 'Campaign idle',
                shieldPercent: 0,
                healthPercent: 0,
                weaponLabel: '-',
                weaponDetail: '-',
                powerLabel: '-',
                powerPercent: 0,
                angleLabel: '-',
                selectedWeaponIndex: 0,
                canSelectWeapon: false,
                weaponOptions: [],
                windLabel: 'Wind 0',
                hintLabel: 'No active match state.',
                winnerLabel: '',
                scoreboard: []
            });
            return;
        }

        const weapon = currentPlayer.currentWeapon;
        const weaponDefinition = WEAPON_DEFINITIONS[weapon.type];
        const ammoLabel = weapon.ammo < 0 ? 'INF' : `${weapon.ammo}`;
        const angleDegrees = Math.round(currentPlayer.angle * 180 / Math.PI);
        const currentMaxPower = getMaxPowerForHealth(currentPlayer.health, this.settings.powerRule);
        const windLevel = this.settings.windMode === 'disabled' || this.settings.maxWind <= 0
            ? 0
            : Math.max(0, Math.min(10, Math.round((Math.abs(this.state.wind) / this.settings.maxWind) * 10)));
        const windDirection = this.settings.windMode === 'disabled' || Math.abs(this.state.wind) < 0.001
            ? '0'
            : this.state.wind > 0
                ? '>'
                : '<';
        const windText = `Wind ${windLevel}/10 ${windDirection}`;
        const hintLabel = this.state.phase === 'game_over'
            ? `${winner?.name ?? 'No one'} won the round. Open the debrief and shop to continue.`
            : currentPlayer.isBot && this.isAuthoritative
                ? `${currentPlayer.name} is calculating a firing solution.`
                : this.canLocalControlCurrentTank()
                    ? 'Arrow left/right aims, arrow up/down charges power, hold Ctrl for fine adjustment, Q/E swaps weapons, space fires.'
                    : this.awaitingShotResult || this.projectiles.length > 0
                        ? 'Shot is resolving. Waiting for impact, debris, and terrain collapse.'
                        : `Waiting for ${currentPlayer.name} to act.`;

        this.onHudUpdate({
            turnLabel: `Turn ${this.state.turnNumber}`,
            pilotLabel: `${currentPlayer.name} | HP ${currentPlayer.health}${currentPlayer.maxShield > 0 ? ` | SH ${currentPlayer.shield}` : ''}`,
            turnColor: currentPlayer.color,
            roundLabel: `Round ${this.roundNumber}/${this.settings.rounds}`,
            campaignLabel: `Round ${this.roundNumber}/${this.settings.rounds} | ${this.settings.terrainCollapse ? 'Collapse on' : 'Collapse off'}`,
            shieldPercent: currentPlayer.maxShield > 0 ? currentPlayer.shield / currentPlayer.maxShield : 0,
            weaponLabel: `${weaponDefinition.name} | Ammo ${ammoLabel}`,
            healthPercent: currentPlayer.health / 100,
            weaponDetail: `${weaponDefinition.flavor} | Blast ${weaponDefinition.blastRadius} | Damage ${weaponDefinition.damage}`,
            powerLabel: `Charge ${Math.round(currentPlayer.power)} / ${currentMaxPower}`,
            powerPercent: currentPlayer.power / Math.max(1, currentMaxPower),
            angleLabel: `Angle ${angleDegrees} deg`,
            selectedWeaponIndex: currentPlayer.selectedWeaponIndex,
            canSelectWeapon: this.canLocalControlCurrentTank(),
            weaponOptions: currentPlayer.weapons.flatMap((entry, index) => isCombatWeapon(entry.type) ? [{
                index,
                label: `${WEAPON_DEFINITIONS[entry.type].name} ${entry.ammo < 0 ? 'INF' : entry.ammo}`,
                detail: `${WEAPON_DEFINITIONS[entry.type].flavor} | Blast ${WEAPON_DEFINITIONS[entry.type].blastRadius} | Damage ${WEAPON_DEFINITIONS[entry.type].damage}`,
                disabled: entry.ammo === 0
            }] : []),
            windLabel: windText,
            hintLabel,
            winnerLabel: this.state.phase === 'game_over' ? `${winner?.name ?? 'No one'} wins round ${this.roundNumber}` : '',
            scoreboard: this.snapshotScoreboard()
        });
    }

    private canLocalControlCurrentTank() {
        if (this.state.phase !== 'aiming') return false;
        const currentPlayer = this.currentPlayer;
        if (!currentPlayer || !currentPlayer.alive || currentPlayer.isBot) return false;
        if (!this.network) return true;
        return currentPlayer.id === this.localPlayerId;
    }

    private clearBotTimers() {
        if (this.botAimTimer !== null) {
            window.clearTimeout(this.botAimTimer);
            this.botAimTimer = null;
        }
        if (this.botFireTimer !== null) {
            window.clearTimeout(this.botFireTimer);
            this.botFireTimer = null;
        }
    }

    private queueBotTurnIfNeeded() {
        this.clearBotTimers();
        if (!this.isAuthoritative || this.state.phase !== 'aiming') return;
        const tank = this.currentPlayer;
        if (!tank || !tank.alive || !tank.isBot) return;

        const turnNumber = this.state.turnNumber;
        const playerId = tank.id;
        const thinkMs = Math.round(this.scaleBotValue(tank.botDifficulty, 1050, 180));
        this.botAimTimer = window.setTimeout(() => {
            this.botAimTimer = null;
            this.executeBotAim(playerId, turnNumber);
        }, thinkMs);
    }

    private executeBotAim(playerId: string, turnNumber: number) {
        if (!this.isAuthoritative || this.state.phase !== 'aiming' || turnNumber !== this.state.turnNumber) return;
        const tank = this.currentPlayer;
        if (!tank || tank.id !== playerId || !tank.isBot || !tank.alive) return;

        const plan = this.planBotShot(tank);
        tank.selectedWeaponIndex = plan.weaponIndex;
        tank.setAim(plan.angle, plan.power, this.settings.powerRule);
        tank.ensureWeaponAvailable();
        this.turnInteractionStarted = true;
        this.emitHud();
        this.broadcastBotAimState(tank);

        const fireDelay = Math.round(this.scaleBotValue(tank.botDifficulty, 620, 180));
        this.botFireTimer = window.setTimeout(() => {
            this.botFireTimer = null;
            if (this.state.phase !== 'aiming' || this.state.turnNumber !== turnNumber) return;
            const active = this.currentPlayer;
            if (!active || active.id !== playerId || !active.isBot || !active.alive) return;
            this.launchProjectile(active);
        }, fireDelay);
    }

    private broadcastBotAimState(tank: Tank) {
        if (this.network?.role !== 'host') return;
        this.network.sendGameMessage({
            kind: 'AIM_STATE',
            playerId: tank.id,
            angle: tank.angle,
            power: tank.power,
            weaponIndex: tank.selectedWeaponIndex,
            turnNumber: this.state.turnNumber
        });
    }

    private planBotShot(tank: Tank) {
        const availableWeapons = tank.weapons
            .map((weapon, index) => ({ weapon, index }))
            .filter(({ weapon }) => weapon.ammo !== 0 && isCombatWeapon(weapon.type) && (WEAPON_DEFINITIONS[weapon.type].damage > 0 || WEAPON_DEFINITIONS[weapon.type].blastRadius > 0));
        const weaponPool = availableWeapons.length ? availableWeapons : [{ weapon: tank.currentWeapon, index: tank.selectedWeaponIndex }];
        const rankedTargets = this.players
            .filter((player) => player.alive && player.id !== tank.id)
            .sort((left, right) => (left.health + left.shield) - (right.health + right.shield) || Math.abs(left.x - tank.x) - Math.abs(right.x - tank.x));
        const maxTargets = Math.max(1, Math.min(rankedTargets.length, Math.floor(tank.botDifficulty / 3) + 1));
        const targets = rankedTargets.slice(0, maxTargets);
        const weaponLimit = Math.max(1, Math.min(weaponPool.length, Math.floor(tank.botDifficulty / 2) + 2));
        const candidateWeapons = [...weaponPool].sort((left, right) => {
            const a = WEAPON_DEFINITIONS[left.weapon.type];
            const b = WEAPON_DEFINITIONS[right.weapon.type];
            return (b.damage + b.blastRadius * 1.35) - (a.damage + a.blastRadius * 1.35);
        }).slice(0, weaponLimit);

        let best = {
            weaponIndex: candidateWeapons[0]?.index ?? tank.selectedWeaponIndex,
            angle: tank.angle,
            power: tank.power,
            score: Number.NEGATIVE_INFINITY
        };
        let safest = {
            weaponIndex: candidateWeapons[0]?.index ?? tank.selectedWeaponIndex,
            angle: tank.angle,
            power: tank.power,
            score: Number.NEGATIVE_INFINITY
        };

        const angleSamples = Math.max(6, 5 + tank.botDifficulty);
        const powerSamples = Math.max(5, 4 + tank.botDifficulty);
        const angleRange = this.scaleBotValue(tank.botDifficulty, 1.28, 0.42);
        const start = tank.barrelTip;
        const maxPower = tank.getMaxPower(this.settings.powerRule);

        candidateWeapons.forEach(({ weapon, index }) => {
            targets.forEach((target) => {
                const targetY = target.y - target.bodyHeight / 2;
                const directAngle = Math.atan2(targetY - start.y, target.x - start.x);
                for (let angleIndex = 0; angleIndex < angleSamples; angleIndex += 1) {
                    const angleOffset = angleSamples === 1 ? 0 : lerp(-angleRange, angleRange, angleIndex / Math.max(1, angleSamples - 1));
                    const candidateAngle = normalizeAngle(directAngle + angleOffset);
                    for (let powerIndex = 0; powerIndex < powerSamples; powerIndex += 1) {
                        const candidatePower = lerp(18, maxPower, powerSamples === 1 ? 1 : powerIndex / Math.max(1, powerSamples - 1));
                        const impact = this.simulateBotImpact(tank, weapon.type, candidateAngle, candidatePower);
                        if (!impact) continue;
                        if (!this.isBotImpactSafe(tank, weapon.type, impact.x, impact.y)) continue;
                        const score = this.scoreBotImpact(tank, weapon.type, impact.x, impact.y, target.id);
                        const safety = this.scoreBotSafety(tank, impact.x, impact.y);
                        if (score > best.score) {
                            best = { weaponIndex: index, angle: candidateAngle, power: candidatePower, score };
                        }
                        if (safety > safest.score) {
                            safest = { weaponIndex: index, angle: candidateAngle, power: candidatePower, score: safety };
                        }
                    }
                }
            });
        });

        const baseChoice = best.score > 6 ? best : safest.score > Number.NEGATIVE_INFINITY ? safest : {
            weaponIndex: tank.selectedWeaponIndex,
            angle: tank.angle,
            power: Math.min(maxPower, Math.max(36, tank.power)),
            score: 0
        };
        const chosen = { ...baseChoice };
        const angleError = this.scaleBotValue(tank.botDifficulty, 0.42, 0.025);
        const powerError = this.scaleBotValue(tank.botDifficulty, 30, 2);
        const attemptedAngle = normalizeAngle(chosen.angle + (this.nextRandom() * 2 - 1) * angleError);
        const attemptedPower = clamp(chosen.power + (this.nextRandom() * 2 - 1) * powerError, 6, maxPower);
        const attemptedImpact = this.simulateBotImpact(tank, tank.weapons[chosen.weaponIndex]?.type ?? tank.currentWeapon.type, attemptedAngle, attemptedPower);
        if (attemptedImpact && this.isBotImpactSafe(tank, tank.weapons[chosen.weaponIndex]?.type ?? tank.currentWeapon.type, attemptedImpact.x, attemptedImpact.y)) {
            chosen.angle = attemptedAngle;
            chosen.power = attemptedPower;
        }
        return chosen;
    }

    private simulateBotImpact(owner: Tank, weaponType: WeaponType, angle: number, power: number) {
        const start = owner.barrelTip;
        const projectile = new Projectile(start.x, start.y, angle, power, owner.id, weaponType);
        const activePlayers = this.players.filter((player) => player.alive);
        for (let tick = 0; tick < 480; tick += 1) {
            const impact = projectile.step(this.terrain, activePlayers, this.state.gravity, this.state.wind);
            if (impact) return impact;
            if ((weaponType === 'merv' || weaponType === 'chaos_mirv' || weaponType === 'large_merv' || weaponType === 'large_chaos_mirv') && projectile.shouldSplit(this.terrain)) {
                return { x: Math.round(projectile.x), y: Math.round(projectile.y + 10) };
            }
        }
        return null;
    }

    private scoreBotImpact(owner: Tank, weaponType: WeaponType, impactX: number, impactY: number, focusTargetId: string) {
        const definition = WEAPON_DEFINITIONS[weaponType];
        const effectiveRadius = definition.blastRadius
            + (weaponType === 'merv' || weaponType === 'chaos_mirv' || weaponType === 'large_merv' || weaponType === 'large_chaos_mirv' ? 8 : 0)
            + (weaponType === 'chaos' || weaponType === 'large_chaos' ? 6 : 0)
            + (weaponType === 'driller' || weaponType === 'large_driller' ? 10 : 0)
            + (weaponType === 'autocannon' || weaponType === 'large_autocannon' ? 4 : 0);
        const selfDistance = Math.hypot(owner.x - impactX, (owner.y - owner.bodyHeight / 2) - impactY);
        let total = selfDistance < effectiveRadius + 18 ? -220 : 0;
        for (const tank of this.players) {
            if (!tank.alive) continue;
            const targetY = tank.y - tank.bodyHeight / 2;
            const distance = Math.hypot(tank.x - impactX, targetY - impactY);
            const estimatedDamage = Math.max(0, definition.damage * (1 - distance / Math.max(1, effectiveRadius + 14)));
            if (tank.id === owner.id) {
                total -= estimatedDamage * 7.5;
                if (distance < effectiveRadius + 10) total -= 140;
                continue;
            }
            if (estimatedDamage <= 0) continue;
            const focusBonus = tank.id === focusTargetId ? 1.7 : 1.1;
            total += estimatedDamage * focusBonus;
            if (tank.health + tank.shield <= estimatedDamage) total += 42;
            if (tank.shield > 0) total += 4;
        }
        return total + effectiveRadius * 0.15;
    }

    private isBotImpactSafe(owner: Tank, weaponType: WeaponType, impactX: number, impactY: number) {
        const definition = WEAPON_DEFINITIONS[weaponType];
        const effectiveRadius = definition.blastRadius
            + (weaponType === 'merv' || weaponType === 'chaos_mirv' || weaponType === 'large_merv' || weaponType === 'large_chaos_mirv' ? 8 : 0)
            + (weaponType === 'chaos' || weaponType === 'large_chaos' ? 6 : 0)
            + (weaponType === 'driller' || weaponType === 'large_driller' ? 10 : 0)
            + (weaponType === 'autocannon' || weaponType === 'large_autocannon' ? 4 : 0);
        const selfDistance = Math.hypot(owner.x - impactX, (owner.y - owner.bodyHeight / 2) - impactY);
        return selfDistance > effectiveRadius + 18;
    }

    private scoreBotSafety(owner: Tank, impactX: number, impactY: number) {
        const selfDistance = Math.hypot(owner.x - impactX, (owner.y - owner.bodyHeight / 2) - impactY);
        const nearestEnemyDistance = this.players
            .filter((tank) => tank.alive && tank.id !== owner.id)
            .reduce((best, tank) => Math.min(best, Math.hypot(tank.x - impactX, (tank.y - tank.bodyHeight / 2) - impactY)), Number.POSITIVE_INFINITY);
        return selfDistance * 2.1 - nearestEnemyDistance * 0.65;
    }

    private scaleBotValue(difficulty: number, low: number, high: number) {
        const t = clamp((difficulty - 1) / 9, 0, 1);
        return lerp(low, high, t);
    }
    private broadcastAimState() {
        if (!this.network) return;
        const currentPlayer = this.currentPlayer;
        if (!currentPlayer) return;
        const now = performance.now();
        if (now - this.aimBroadcastAt < 45) return;
        this.aimBroadcastAt = now;
        this.network.sendGameMessage({
            kind: 'AIM_STATE',
            playerId: currentPlayer.id,
            angle: currentPlayer.angle,
            power: currentPlayer.power,
            weaponIndex: currentPlayer.selectedWeaponIndex,
            turnNumber: this.state.turnNumber
        });
    }

    private snapshotPlayers() {
        return this.players.map((player) => player.snapshot());
    }

    private createStatsSnapshot(playerId: string): PlayerStatsSnapshot {
        const round = this.roundStatsById.get(playerId) ?? this.createRoundStats();
        const campaign = this.campaignById.get(playerId) ?? this.createCampaignStats();
        return {
            id: playerId,
            damage: round.damage,
            hits: round.hits,
            kills: round.kills,
            shots: round.shots,
            spent: round.spent,
            damageTaken: round.damageTaken,
            score: campaign.score,
            roundWins: campaign.roundWins,
            totalDamage: campaign.totalDamage,
            totalHits: campaign.totalHits,
            totalKills: campaign.totalKills,
            totalShots: campaign.totalShots,
            totalSpent: campaign.totalSpent,
            totalDamageTaken: campaign.totalDamageTaken
        };
    }

    private snapshotStats(): PlayerStatsSnapshot[] {
        return this.players.map((player) => this.createStatsSnapshot(player.id));
    }

    private snapshotScoreboard(): HudScoreEntry[] {
        const maxDamage = Math.max(1, ...this.players.map((player) => this.roundStatsById.get(player.id)?.damage ?? 0));
        const totalRoundDamage = Math.max(1, this.players.reduce((sum, player) => sum + (this.roundStatsById.get(player.id)?.damage ?? 0), 0));
        return this.players.map((player) => {
            const round = this.roundStatsById.get(player.id) ?? this.createRoundStats();
            const campaign = this.campaignById.get(player.id) ?? this.createCampaignStats();
            return {
                id: player.id,
                name: player.name,
                color: player.color,
                health: player.health,
                healthRatio: player.health / 100,
                damage: round.damage,
                totalDamage: campaign.totalDamage,
                hits: round.hits,
                kills: round.kills,
                score: campaign.score,
                roundWins: campaign.roundWins,
                damageRatio: round.damage / maxDamage,
                damageShare: round.damage / totalRoundDamage
            };
        });
    }

    private applySnapshots(playerStates: PlayerSnapshot[]) {
        playerStates.forEach((snapshot) => {
            const tank = this.players.find((player) => player.id === snapshot.id);
            tank?.applySnapshot(snapshot);
            tank?.syncPowerCap(this.settings.powerRule);
        });
    }

    private applyStats(stats: PlayerStatsSnapshot[]) {
        stats.forEach((entry) => {
            this.roundStatsById.set(entry.id, {
                damage: entry.damage,
                hits: entry.hits,
                kills: entry.kills,
                shots: entry.shots,
                spent: entry.spent,
                damageTaken: entry.damageTaken
            });
            this.campaignById.set(entry.id, this.toCampaignStats(entry));
        });
    }

    private placePlayers() {
        const count = this.players.length;
        const spawnXs: number[] = [];
        const minSpacing = Math.max(28, Math.floor(LOGICAL_WIDTH / (count + 3.4)));
        const edgeMargin = 7;

        for (let attempts = 0; attempts < 240 && spawnXs.length < count; attempts += 1) {
            const candidate = Math.round(edgeMargin + this.nextRandom() * (LOGICAL_WIDTH - edgeMargin * 2));
            if (spawnXs.every((spawnX) => Math.abs(spawnX - candidate) >= minSpacing)) {
                spawnXs.push(candidate);
            }
        }

        while (spawnXs.length < count) {
            const fallback = Math.round(lerp(edgeMargin, LOGICAL_WIDTH - edgeMargin, (spawnXs.length + 1) / (count + 1)));
            spawnXs.push(fallback);
        }

        spawnXs.forEach((spawnX, index) => {
            this.terrain.flattenPlatform(spawnX, 8);
            const tank = this.players[index];
            tank.x = spawnX;
            tank.y = this.terrain.getSurfaceY(spawnX) - 1;
            tank.verticalVelocity = 0;
            tank.syncPowerCap(this.settings.powerRule);
        });
    }
    private generateBackdrop() {
        this.stars.length = 0;
        for (let index = 0; index < 60; index += 1) {
            this.stars.push({
                x: Math.floor(this.nextRandom() * LOGICAL_WIDTH),
                y: Math.floor(this.nextRandom() * (LOGICAL_HEIGHT * 0.42)),
                size: this.nextRandom() > 0.7 ? 2 : 1,
                alpha: 0.4 + this.nextRandom() * 0.5
            });
        }
    }

    private recordShot(playerId: string, amount = 1) {
        const round = this.roundStatsById.get(playerId);
        if (round) round.shots += amount;
        const campaign = this.campaignById.get(playerId);
        if (campaign) campaign.totalShots += amount;
    }

    private recordOrdnanceSpend(playerId: string, weaponType: WeaponType) {
        const spentValue = this.getWeaponSpendValue(weaponType);
        const round = this.roundStatsById.get(playerId);
        if (round) round.spent += spentValue;
        const campaign = this.campaignById.get(playerId);
        if (campaign) campaign.totalSpent += spentValue;
    }

    private createRoundStats(): RoundStats {
        return { damage: 0, hits: 0, kills: 0, shots: 0, spent: 0, damageTaken: 0 };
    }

    private createCampaignStats(): CampaignStats {
        return { score: 0, roundWins: 0, totalDamage: 0, totalHits: 0, totalKills: 0, totalShots: 0, totalSpent: 0, totalDamageTaken: 0 };
    }

    private toCampaignStats(entry: PlayerStatsSnapshot): CampaignStats {
        return {
            score: entry.score,
            roundWins: entry.roundWins,
            totalDamage: entry.totalDamage,
            totalHits: entry.totalHits,
            totalKills: entry.totalKills,
            totalShots: entry.totalShots,
            totalSpent: entry.totalSpent,
            totalDamageTaken: entry.totalDamageTaken
        };
    }
    private getWeaponShotCount(weaponType: WeaponType) {
        return weaponType === 'autocannon' || weaponType === 'large_autocannon' ? 5 : 1;
    }

    private getWeaponSpendValue(weaponType: WeaponType) {
        return getWeaponShopPrice(weaponType, 1) ?? 24;
    }
    private setActiveProjectilesFromBurst(burst: Projectile[], weaponType: WeaponType) {
        this.pendingProjectiles = [];
        if (weaponType !== 'autocannon' && weaponType !== 'large_autocannon') {
            this.projectiles = burst;
            return;
        }

        this.projectiles = burst.length ? [burst[0]] : [];
        this.pendingProjectiles = burst.slice(1).map((projectile, index) => ({
            delayMs: (index + 1) * 110,
            projectile
        }));
    }

    private getChaosFollowupLimit(weaponType: WeaponType) {
        if (weaponType === 'chaos' || weaponType === 'chaos_mirv') return 2;
        if (weaponType === 'large_chaos' || weaponType === 'large_chaos_mirv') return 4;
        return -1;
    }

    private createProjectileBurst(startX: number, startY: number, angle: number, power: number, ownerId: string, weaponType: WeaponType) {
        if (weaponType !== 'autocannon' && weaponType !== 'large_autocannon') {
            return [new Projectile(startX, startY, angle, power, ownerId, weaponType)];
        }

        return Array.from({ length: 5 }, (_, index) => {
            const spread = this.getAutocannonSpread(ownerId, index, weaponType === 'large_autocannon' ? 4 : 3);
            return new Projectile(
                startX,
                startY,
                angle + spread.angleOffset,
                Math.max(6, power + spread.powerOffset),
                ownerId,
                weaponType
            );
        });
    }

    private getAutocannonSpread(ownerId: string, shotIndex: number, maxOffset: number) {
        const ownerHash = ownerId.split('').reduce((sum, char) => ((sum * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
        const seedA = ownerHash + this.state.turnNumber * 97 + shotIndex * 53;
        const seedB = ownerHash + this.state.turnNumber * 131 + shotIndex * 71;
        const angleOffset = (this.noise(seedA) * 2 - 1) * (maxOffset * Math.PI / 180);
        const powerOffset = Math.round((this.noise(seedB) * 2 - 1) * maxOffset);
        return { angleOffset, powerOffset };
    }

    private isUtilityImpactWeapon(weaponType: WeaponType) {
        return weaponType === 'wall' || weaponType === 'large_wall' || weaponType === 'bridge' || weaponType === 'relocator';
    }

    private isSilentImpactWeapon(weaponType: WeaponType) {
        return this.isUtilityImpactWeapon(weaponType);
    }

    private applyUtilityImpact(ownerId: string, weaponType: WeaponType, bursts: Array<{ x: number; y: number; radius: number; damage: number }>) {
        const primary = bursts[0];
        if (!primary) return;

        if (weaponType === 'wall') {
            this.terrain.raiseWall(primary.x, primary.y, 5, 40, '#7b684d');
            return;
        }

        if (weaponType === 'large_wall') {
            this.terrain.raiseWall(primary.x, primary.y, 8, 54, '#8b7454');
            return;
        }

        if (weaponType === 'bridge') {
            this.terrain.raiseBridge(primary.x, primary.y + 2, 26, 6, '#8a7253');
            return;
        }

        if (weaponType === 'relocator') {
            this.relocateTank(ownerId, primary.x);
        }
    }

    private relocateTank(ownerId: string, targetX: number) {
        const tank = this.players.find((entry) => entry.id === ownerId);
        if (!tank || !tank.alive) return;
        const spawnX = Math.round(clamp(targetX, 8, LOGICAL_WIDTH - 9));
        this.terrain.flattenPlatform(spawnX, 8);
        tank.x = spawnX;
        tank.y = this.terrain.getSurfaceY(spawnX) - 1;
        tank.verticalVelocity = 0;
        tank.syncPowerCap(this.settings.powerRule);
    }

    private applyWeaponImpact(ownerId: string, weaponType: WeaponType, bursts: Array<{ x: number; y: number; radius: number; damage: number }>) {
        if (this.isUtilityImpactWeapon(weaponType)) {
            this.applyUtilityImpact(ownerId, weaponType, bursts);
            return [];
        }

        const damageEvents: DamageEvent[] = [];
        bursts.forEach((burst) => {
            this.terrain.carveCircle(burst.x, burst.y, burst.radius);
            damageEvents.push(...this.damagePlayers(ownerId, burst.x, burst.y, burst.radius, burst.damage));
            this.spawnExplosion(burst.x, burst.y, weaponType);
        });

        if (weaponType === 'leech') {
            const leeched = Math.max(0, Math.round(damageEvents.filter((event) => event.targetId !== ownerId).reduce((sum, event) => sum + event.amount, 0) * 0.35));
            if (leeched > 0) {
                const owner = this.players.find((entry) => entry.id === ownerId);
                const restored = owner?.restoreShield(leeched) ?? 0;
                if (restored > 0 && owner) {
                    this.damagePopups.push({
                        x: owner.x,
                        y: owner.y - owner.bodyHeight - 8,
                        text: `+${restored} SH`,
                        color: '#62e7ff',
                        life: 40
                    });
                }
            }
        }

        return damageEvents;
    }

    private buildImpactBursts(weaponType: WeaponType, impactX: number, impactY: number, impactDirX: number, impactDirY: number) {
        const definition = WEAPON_DEFINITIONS[weaponType];
        if (this.isUtilityImpactWeapon(weaponType)) {
            return [{ x: impactX, y: impactY, radius: 0, damage: 0 }];
        }

        if (weaponType === 'blossom') {
            return this.applyBurstPattern(impactX, impactY, [
                { x: 0, y: 0, radius: 8, damage: 18 },
                { x: 0, y: -14, radius: 7, damage: 16 },
                { x: 12, y: -8, radius: 7, damage: 16 },
                { x: 12, y: 8, radius: 7, damage: 16 },
                { x: 0, y: 14, radius: 7, damage: 16 },
                { x: -12, y: 8, radius: 7, damage: 16 },
                { x: -12, y: -8, radius: 7, damage: 16 }
            ]);
        }

        if (weaponType === 'sinker') {
            return Array.from({ length: 7 }, (_, index) => ({
                x: Math.round(clamp(impactX, 2, LOGICAL_WIDTH - 3)),
                y: Math.round(clamp(impactY + index * 8, 2, LOGICAL_HEIGHT - 3)),
                radius: Math.max(4, definition.blastRadius - Math.floor(index / 2)),
                damage: Math.max(7, definition.damage - index)
            }));
        }

        if (weaponType === 'crossfire') {
            return this.applyBurstPattern(impactX, impactY, [
                { x: 0, y: 0, radius: 8, damage: 18 },
                { x: 16, y: 0, radius: 7, damage: 15 },
                { x: -16, y: 0, radius: 7, damage: 15 },
                { x: 0, y: 16, radius: 7, damage: 15 },
                { x: 0, y: -16, radius: 7, damage: 15 },
                { x: 32, y: 0, radius: 6, damage: 12 },
                { x: -32, y: 0, radius: 6, damage: 12 },
                { x: 0, y: 32, radius: 6, damage: 12 },
                { x: 0, y: -32, radius: 6, damage: 12 }
            ]);
        }

        const isDriller = weaponType === 'driller' || weaponType === 'large_driller';
        if (isDriller) {
            const directionLength = Math.hypot(impactDirX, impactDirY) || 1;
            const dirX = impactDirX / directionLength;
            const dirY = impactDirY / directionLength;
            const count = weaponType === 'large_driller' ? 10 : 8;
            const spacing = weaponType === 'large_driller' ? 8 : 7;
            const bursts: Array<{ x: number; y: number; radius: number; damage: number }> = [];
            for (let index = 0; index < count; index += 1) {
                const distance = index * spacing;
                bursts.push({
                    x: Math.round(clamp(impactX + dirX * distance, 2, LOGICAL_WIDTH - 3)),
                    y: Math.round(clamp(impactY + dirY * distance, 2, LOGICAL_HEIGHT - 3)),
                    radius: Math.max(4, definition.blastRadius - Math.floor(index / 3)),
                    damage: Math.max(6, definition.damage - index)
                });
            }
            return bursts;
        }

        return [{ x: impactX, y: impactY, radius: definition.blastRadius, damage: definition.damage }];
    }

    private applyBurstPattern(impactX: number, impactY: number, pattern: Array<{ x: number; y: number; radius: number; damage: number }>) {
        return pattern.map((burst) => ({
            x: Math.round(clamp(impactX + burst.x, 2, LOGICAL_WIDTH - 3)),
            y: Math.round(clamp(impactY + burst.y, 2, LOGICAL_HEIGHT - 3)),
            radius: burst.radius,
            damage: burst.damage
        }));
    }

    private noise(seed: number) {
        const value = Math.sin(seed * 12.9898) * 43758.5453;
        return value - Math.floor(value);
    }

    private nextChaosAngle(impactX: number, impactY: number, ownerId: string, depth: number) {
        const ownerHash = ownerId.split('').reduce((sum, char) => ((sum * 33) ^ char.charCodeAt(0)) >>> 0, 5381);
        const seed = Math.sin((impactX + 17) * 12.9898 + (impactY + 41) * 78.233 + ownerHash * 0.013 + depth * 19.19);
        const normalized = seed - Math.floor(seed);
        return -Math.PI + 0.28 + normalized * (Math.PI - 0.56);
    }
    private nextWind() {
        if (this.settings.windMode === 'disabled') return 0;
        if (this.settings.windMode === 'constant') return this.constantWindValue;
        return clamp((this.nextRandom() - 0.5) * 2 * this.settings.maxWind, -this.settings.maxWind, this.settings.maxWind);
    }

    private nextRandom() {
        this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
        return this.randomState / 0xffffffff;
    }

    private colorWithAlpha(hex: string, alpha: number) {
        const normalized = hex.replace('#', '');
        const bigint = parseInt(normalized, 16);
        return `rgba(${(bigint >> 16) & 255}, ${(bigint >> 8) & 255}, ${bigint & 255}, ${alpha})`;
    }
}









































