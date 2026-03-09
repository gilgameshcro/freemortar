import { AudioManager } from './AudioManager';
import {
    clamp,
    cloneWeapons,
    getMaxPowerForHealth,
    getWeaponAmmoUnitPrice,
    getWeaponExplosionStyle,
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
    MirvSpreadMode,
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
    mirvSpread: MirvSpreadMode;
    canAdjustMirvSpread: boolean;
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

interface PendingRemoteShotResult {
    weaponType: WeaponType;
    impactX: number;
    impactY: number;
    impactDirX: number;
    impactDirY: number;
    damageEvents: DamageEvent[];
    playerStates: PlayerSnapshot[];
    stats: PlayerStatsSnapshot[];
    turnNumber: number;
}

interface PendingBurst {
    delayMs: number;
    ownerId: string;
    weaponType: WeaponType;
    x: number;
    y: number;
    radius: number;
    damage: number;
    mode: 'burst' | 'echo_implode' | 'echo_blast';
}

interface TerrainDebris {
    x: number;
    y: number;
    vx: number;
    vy: number;
    color: string;
    life: number;
}

interface ProgressiveBlastEffect {
    x: number;
    y: number;
    targetRadius: number;
    currentRadius: number;
    lastCarvedRadius: number;
    settleFrames: number;
    style: 'nuclear' | 'nova_blast' | 'solar' | 'void';
    coreColor: string;
    outerColor: string;
    glowColor: string;
    rimColor: string;
}

interface GravityPulseEffect {
    x: number;
    y: number;
    radius: number;
    maxRadius: number;
    life: number;
    maxLife: number;
    rotation: number;
    coreColor: string;
    glowColor: string;
    lineColor: string;
}

interface TechPulseEffect {
    x: number;
    y: number;
    size: number;
    maxSize: number;
    life: number;
    maxLife: number;
    rotation: number;
    primaryColor: string;
    secondaryColor: string;
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
    private progressiveBlasts: ProgressiveBlastEffect[] = [];
    private gravityPulses: GravityPulseEffect[] = [];
    private techPulses: TechPulseEffect[] = [];
    private projectiles: Projectile[] = [];
    private pendingProjectiles: Array<{ delayMs: number; projectile: Projectile; playFire?: boolean }> = [];
    private pendingBursts: PendingBurst[] = [];
    private pendingRemoteShotResults: PendingRemoteShotResult[] = [];
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
    private turnDamageDealt = false;
    private stalemateCounter = 0;
    private readonly stalemateLimit = 10;
    private roundEndReason: 'normal' | 'stalemate' = 'normal';
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
                if (pending.playFire) {
                    this.audio.playFire(pending.projectile.weaponType);
                }
                this.pendingProjectiles.splice(index, 1);
            }
        }

        for (let index = this.pendingBursts.length - 1; index >= 0; index -= 1) {
            const pending = this.pendingBursts[index];
            pending.delayMs -= FIXED_STEP_MS;
            if (pending.delayMs <= 0) {
                this.pendingBursts.splice(index, 1);
                this.resolveDelayedBurst(pending);
            }
        }

        for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
            const projectile = this.projectiles[index];
            const impact = projectile.step(this.terrain, this.players, this.state.gravity, this.state.wind);
            const seederDrops = projectile.consumeSeederDrops();
            if (seederDrops.length) {
                this.pendingProjectiles.push(...seederDrops.map((drop) => ({ delayMs: 0, projectile: drop, playFire: true })));
            }
            if (projectile.consumeRollingSound()) {
                this.audio.playRollerTick();
            }
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

        if (!this.isAuthoritative) {
            this.processPendingRemoteShotResults();
        }

        const progressiveBlastMoved = this.updateProgressiveBlasts();
        this.updateGravityPulses();
        this.updateTechPulses();
        const terrainMoved = (this.settings.terrainCollapse ? this.terrain.stepCollapse() : false) || progressiveBlastMoved;
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
            if (this.isAuthoritative && this.resolveTimer <= 0 && !tankMoved && !terrainMoved && !debrisMoved && this.projectiles.length === 0 && this.pendingProjectiles.length === 0 && this.pendingBursts.length === 0 && this.progressiveBlasts.length === 0) {
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
                    this.queueRemoteShotResult(message.weaponType, message.impactX, message.impactY, message.impactDirX, message.impactDirY, message.damageEvents, message.playerStates, message.stats, message.turnNumber);
                }
                break;
            case 'TURN_STATE':
                if (!this.isAuthoritative) {
                    this.applyTurnState(message.currentPlayerIndex, message.wind, message.turnNumber, message.winnerId, message.playerStates, message.stats, message.roundNumber, message.stalemateCounter, message.roundEndReason ?? 'normal');
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
        player.mirvSpread = message.mirvSpread;
        player.setAim(message.angle, message.power, this.settings.powerRule);
        player.ensureWeaponAvailable();
    }

    private handleFireRequest(message: Extract<GameMessage, { kind: 'FIRE_REQUEST' }>, senderId: string) {
        if (message.turnNumber !== this.state.turnNumber) return;
        if (senderId !== message.playerId) return;
        const player = this.players.find((entry) => entry.id === message.playerId);
        if (!player || this.currentPlayer?.id !== player.id || this.state.phase !== 'aiming') return;
        player.selectedWeaponIndex = clamp(message.weaponIndex, 0, player.weapons.length - 1);
        player.mirvSpread = message.mirvSpread;
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
            mirvSpread: tank.mirvSpread,
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
        const burst = this.createProjectileBurst(barrelTip.x, barrelTip.y, tank.angle, tank.power, tank.id, firedWeapon.type, tank.mirvSpread);
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
                mirvSpread: tank.mirvSpread,
                turnNumber: this.state.turnNumber
            });
        }
    }
    private spawnNetworkProjectile(message: Extract<GameMessage, { kind: 'SHOT_FIRED' }>) {
        if (message.turnNumber !== this.state.turnNumber) return;
        const player = this.players.find((entry) => entry.id === message.playerId);
        if (!player) return;
        player.mirvSpread = message.mirvSpread ?? player.mirvSpread;
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
                    message.chaosDepth ?? 0,
                    { mirvSpread: message.mirvSpread ?? player.mirvSpread, allowSeederDrops: false }
                )
            ];
        } else {
            player.selectedWeaponIndex = clamp(message.weaponIndex, 0, player.weapons.length - 1);
            player.consumeSelectedWeapon();
            burst = this.createProjectileBurst(message.startX, message.startY, message.angle, message.power, message.playerId, message.weaponType, message.mirvSpread ?? player.mirvSpread);
        }
        this.setActiveProjectilesFromBurst(burst, message.weaponType);
        this.state.phase = 'projectile';
        this.awaitingShotResult = true;
        this.audio.playFire(message.weaponType);
    }
    private resolveShot(ownerId: string, weaponType: WeaponType, impactX: number, impactY: number, impactDirX: number, impactDirY: number) {
        const bursts = this.buildImpactBursts(weaponType, impactX, impactY, impactDirX, impactDirY);
        const damageEvents = this.applyWeaponImpact(ownerId, weaponType, bursts);
        this.queueImpactFollowups(ownerId, weaponType, impactX, impactY, impactDirX, impactDirY);
        if (damageEvents.some((event) => event.amount > 0)) this.turnDamageDealt = true;
        const maxBlastRadius = Math.max(WEAPON_DEFINITIONS[weaponType].blastRadius, ...bursts.map((burst) => Math.max(1, burst.radius)));
        this.spawnDamagePopups(damageEvents);
        const hasMoreProjectiles = this.projectiles.length > 0 || this.pendingProjectiles.length > 0 || this.pendingBursts.length > 0;
        this.resolveTimer = hasMoreProjectiles ? 0 : 0.85;
        this.state.phase = hasMoreProjectiles ? 'projectile' : 'settling';
        this.awaitingShotResult = false;
        if (!this.isSilentImpactWeapon(weaponType)) {
            this.audio.playExplosion(maxBlastRadius, weaponType);
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
    private queueRemoteShotResult(
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
        this.pendingRemoteShotResults.push({ weaponType, impactX, impactY, impactDirX, impactDirY, damageEvents, playerStates, stats, turnNumber });
    }

    private processPendingRemoteShotResults() {
        for (let index = this.pendingRemoteShotResults.length - 1; index >= 0; index -= 1) {
            const pending = this.pendingRemoteShotResults[index];
            if (pending.turnNumber !== this.state.turnNumber) {
                this.pendingRemoteShotResults.splice(index, 1);
                continue;
            }
            if (!this.canApplyPendingRemoteShotResult(pending)) continue;
            this.pendingRemoteShotResults.splice(index, 1);
            this.applyRemoteShotResult(pending.weaponType, pending.impactX, pending.impactY, pending.impactDirX, pending.impactDirY, pending.damageEvents, pending.playerStates, pending.stats, pending.turnNumber);
        }
    }

    private canApplyPendingRemoteShotResult(pending: PendingRemoteShotResult) {
        const ownerId = pending.damageEvents[0]?.attackerId;
        const candidate = this.findRemoteProjectileCandidate(pending.weaponType, pending.impactX, pending.impactY, ownerId);
        if (!candidate) return true;
        return candidate.bestDistance <= Math.max(6, candidate.projectile.radius * 4);
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
        if (damageEvents.some((event) => event.amount > 0)) this.turnDamageDealt = true;
        const bursts = this.buildImpactBursts(weaponType, impactX, impactY, impactDirX, impactDirY);
        this.queueImpactFollowups(damageEvents[0]?.attackerId ?? this.currentPlayer?.id ?? '', weaponType, impactX, impactY, impactDirX, impactDirY);
        const maxBlastRadius = Math.max(WEAPON_DEFINITIONS[weaponType].blastRadius, ...bursts.map((burst) => Math.max(1, burst.radius)));
        this.awaitingShotResult = this.projectiles.length > 0 || this.pendingProjectiles.length > 0 || this.pendingBursts.length > 0;
        if (this.isUtilityImpactWeapon(weaponType)) {
            this.applyUtilityImpact(damageEvents[0]?.attackerId ?? this.currentPlayer?.id ?? '', weaponType, bursts);
        } else {
            bursts.forEach((burst) => {
                if (this.usesProgressiveBlastEffect(weaponType)) {
                    this.queueProgressiveBlast(burst.x, burst.y, burst.radius, weaponType);
                } else {
                    this.terrain.carveCircle(burst.x, burst.y, burst.radius);
                }
                this.spawnExplosion(burst.x, burst.y, weaponType);
            });
        }
        this.applySnapshots(playerStates);
        this.applyStats(stats);
        this.spawnKillDebrisFromEvents(damageEvents);
        this.spawnDamagePopups(damageEvents);
        const hasMoreProjectiles = this.projectiles.length > 0 || this.pendingProjectiles.length > 0 || this.pendingBursts.length > 0;
        this.resolveTimer = hasMoreProjectiles ? 0 : 0.85;
        this.state.phase = hasMoreProjectiles ? 'projectile' : 'settling';
        if (!this.isSilentImpactWeapon(weaponType)) {
            this.audio.playExplosion(maxBlastRadius, weaponType);
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
        roundNumber: number,
        stalemateCounter: number,
        roundEndReason: 'normal' | 'stalemate' = 'normal'
    ) {
        if (roundNumber !== this.roundNumber) return;
        this.projectiles = [];
        this.pendingProjectiles = [];
        this.pendingBursts = [];
        this.pendingRemoteShotResults = [];
        this.awaitingShotResult = false;
        this.applySnapshots(playerStates);
        this.applyStats(stats);
        this.state.currentPlayerIndex = currentPlayerIndex;
        this.state.wind = wind;
        this.state.turnNumber = turnNumber;
        this.state.winnerId = winnerId;
        this.stalemateCounter = stalemateCounter;
        this.roundEndReason = roundEndReason;
        this.turnDamageDealt = false;
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

        if (this.turnDamageDealt) {
            this.stalemateCounter = 0;
        } else {
            this.stalemateCounter += 1;
        }
        this.turnDamageDealt = false;
        if (this.stalemateCounter >= this.stalemateLimit) {
            this.finishRound(this.pickStalemateWinner(), 'stalemate');
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

    private finishRound(winnerId: string | null, reason: 'normal' | 'stalemate' = 'normal') {
        this.state.winnerId = winnerId;
        this.state.phase = 'game_over';
        this.roundEndReason = reason;

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
            stalemateCounter: this.stalemateCounter,
            roundEndReason: this.roundEndReason,
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
    private pickStalemateWinner() {
        const ranked = [...this.players]
            .filter((player) => player.alive)
            .sort((left, right) => (right.health + right.shield) - (left.health + left.shield)
                || (this.roundStatsById.get(right.id)?.damage ?? 0) - (this.roundStatsById.get(left.id)?.damage ?? 0)
                || (this.campaignById.get(right.id)?.score ?? 0) - (this.campaignById.get(left.id)?.score ?? 0));
        const first = ranked[0];
        const second = ranked[1];
        if (!first) return null;
        if (!second) return first.id;
        const firstDurability = first.health + first.shield;
        const secondDurability = second.health + second.shield;
        if (firstDurability !== secondDurability) return first.id;
        const firstDamage = this.roundStatsById.get(first.id)?.damage ?? 0;
        const secondDamage = this.roundStatsById.get(second.id)?.damage ?? 0;
        if (firstDamage !== secondDamage) return first.id;
        return null;
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

    private drainShieldBurst(ownerId: string, centerX: number, centerY: number, radius: number, amount: number) {
        if (amount <= 0) return [];
        const damageEvents: DamageEvent[] = [];
        for (const tank of this.players) {
            if (!tank.alive || tank.shield <= 0) continue;
            const targetY = tank.y - tank.bodyHeight / 2;
            const distance = Math.hypot(tank.x - centerX, targetY - centerY);
            if (distance > radius + 10) continue;
            const shieldDamage = Math.min(tank.shield, amount);
            if (shieldDamage <= 0) continue;
            tank.applyShieldDamage(shieldDamage);
            const targetRoundStats = this.roundStatsById.get(tank.id);
            if (targetRoundStats) targetRoundStats.damageTaken += shieldDamage;
            const targetCampaign = this.campaignById.get(tank.id);
            if (targetCampaign) targetCampaign.totalDamageTaken += shieldDamage;
            const isSelfHit = tank.id === ownerId;
            if (!isSelfHit) {
                const shooterRoundStats = this.roundStatsById.get(ownerId);
                if (shooterRoundStats) {
                    shooterRoundStats.damage += shieldDamage;
                    shooterRoundStats.hits += 1;
                }
                const shooterCampaign = this.campaignById.get(ownerId);
                if (shooterCampaign) {
                    shooterCampaign.totalDamage += shieldDamage;
                    shooterCampaign.totalHits += 1;
                    shooterCampaign.score += this.calculateScoreDelta(shieldDamage, false);
                }
            }
            damageEvents.push({
                attackerId: ownerId,
                targetId: tank.id,
                amount: shieldDamage,
                x: tank.x,
                y: tank.y - tank.bodyHeight - 3,
                killed: false
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
        const style = getWeaponExplosionStyle(weaponType);
        const spawnRing = (count: number, speedScale: number, color: string, kind: 'spark' | 'dust' | 'smoke' | 'ring', life: number) => {
            for (let index = 0; index < count; index += 1) {
                const angle = this.nextRandom() * Math.PI * 2;
                const speed = 0.18 + this.nextRandom() * speedScale;
                this.particles.push(new Particle(centerX, centerY, Math.cos(angle) * speed, Math.sin(angle) * speed, 1, color, kind, life));
            }
        };
        const spawnSmoke = (count: number, color: string, life = 34) => {
            for (let index = 0; index < count; index += 1) {
                this.particles.push(new Particle(
                    centerX + this.nextRandom() * 5 - 2.5,
                    centerY + this.nextRandom() * 3 - 1.5,
                    this.nextRandom() * 0.45 - 0.225,
                    -0.18 - this.nextRandom() * 0.34,
                    2,
                    color,
                    'smoke',
                    life
                ));
            }
        };

        const sparks = 10 + Math.round(definition.blastRadius * 1.25);
        const dust = 6 + Math.round(definition.blastRadius * 0.7);

        if (style === 'gravity' || style === 'void') {
            this.queueGravityPulse(centerX, centerY, definition.blastRadius, style === 'void' ? '#b77bff' : definition.projectileColor);
        }
        if (style === 'tech' || style === 'prism') {
            this.queueTechPulse(centerX, centerY, definition.blastRadius, style === 'prism' ? '#f4f9ff' : definition.projectileColor, style === 'prism' ? definition.projectileColor : definition.trailColor);
        }

        switch (style) {
            case 'precision':
                spawnRing(sparks, definition.blastRadius / 9, definition.projectileColor, 'spark', 16);
                spawnRing(Math.max(5, Math.round(sparks * 0.35)), definition.blastRadius / 11, '#f8f4de', 'spark', 12);
                spawnSmoke(4, '#4e535f', 24);
                break;
            case 'chaos':
                spawnRing(sparks + 8, definition.blastRadius / 7, definition.projectileColor, 'spark', 20);
                spawnRing(dust, definition.blastRadius / 9, '#ff8c42', 'dust', 22);
                spawnSmoke(8, '#6f4b66', 30);
                break;
            case 'drill':
                spawnRing(sparks, definition.blastRadius / 10, definition.projectileColor, 'dust', 22);
                spawnRing(Math.max(4, Math.round(sparks * 0.4)), definition.blastRadius / 8, '#d7c5ff', 'spark', 18);
                spawnSmoke(6, '#5f576d', 28);
                break;
            case 'terrain':
                spawnRing(dust + 12, definition.blastRadius / 8, '#8d5a3a', 'dust', 26);
                spawnRing(Math.max(5, Math.round(sparks * 0.3)), definition.blastRadius / 10, definition.projectileColor, 'spark', 16);
                spawnSmoke(5, '#655144', 26);
                break;
            case 'shield':
                spawnRing(Math.max(8, Math.round(sparks * 0.6)), definition.blastRadius / 10, '#8ff6ff', 'spark', 20);
                spawnSmoke(4, '#4f7b88', 24);
                break;
            case 'tech':
                spawnRing(Math.max(8, Math.round(sparks * 0.4)), definition.blastRadius / 13, definition.projectileColor, 'spark', 16);
                spawnRing(Math.max(4, Math.round(sparks * 0.25)), definition.blastRadius / 16, '#b8f8ff', 'spark', 12);
                spawnSmoke(3, '#48546b', 18);
                break;
            case 'gravity':
                spawnRing(Math.max(8, Math.round(sparks * 0.32)), definition.blastRadius / 15, definition.projectileColor, 'spark', 18);
                spawnRing(Math.max(5, Math.round(dust * 0.35)), definition.blastRadius / 17, '#19253a', 'dust', 20);
                spawnSmoke(4, '#39435f', 24);
                break;
            case 'void':
                spawnRing(Math.max(12, Math.round(sparks * 0.42)), definition.blastRadius / 14, '#f0e6ff', 'spark', 18);
                spawnRing(Math.max(10, Math.round(dust * 0.72)), definition.blastRadius / 18, '#9b5cff', 'dust', 28);
                spawnSmoke(10, '#261438', 34);
                break;
            case 'prism':
                spawnRing(Math.max(10, Math.round(sparks * 0.34)), definition.blastRadius / 13, definition.projectileColor, 'spark', 16);
                spawnRing(Math.max(6, Math.round(sparks * 0.18)), definition.blastRadius / 15, '#ffffff', 'spark', 12);
                spawnSmoke(4, '#435a72', 20);
                break;
            case 'shrapnel':
                spawnRing(sparks + 4, definition.blastRadius / 7.5, definition.projectileColor, 'spark', 15);
                spawnRing(Math.max(4, Math.round(sparks * 0.35)), definition.blastRadius / 9, '#fff3d1', 'spark', 12);
                spawnSmoke(3, '#5b5966', 20);
                break;
            case 'roller':
                spawnRing(dust + 8, definition.blastRadius / 9, '#8d5a3a', 'dust', 22);
                spawnRing(Math.max(4, Math.round(sparks * 0.3)), definition.blastRadius / 10, definition.projectileColor, 'spark', 16);
                spawnSmoke(4, '#5f5148', 24);
                break;
            case 'nuclear':
            case 'nova_blast':
            case 'solar':
                spawnRing(Math.max(20, Math.round(sparks * 0.7)), definition.blastRadius / 14, definition.projectileColor, 'spark', 24);
                spawnRing(Math.max(18, Math.round(dust * 1.15)), definition.blastRadius / 19, definition.trailColor, 'dust', 34);
                spawnSmoke(16, '#6f5148', 46);
                spawnSmoke(10, '#a86d53', 32);
                break;
            case 'heavy':
                spawnRing(sparks + 10, definition.blastRadius / 7, definition.projectileColor, 'spark', 22);
                spawnRing(dust + 6, definition.blastRadius / 8.5, '#8d5a3a', 'dust', 26);
                spawnSmoke(9, '#615563', 34);
                break;
            case 'ember':
                spawnRing(sparks, definition.blastRadius / 8.5, definition.projectileColor, 'spark', 18);
                spawnRing(Math.max(5, Math.round(dust * 0.7)), definition.blastRadius / 10, '#ffb0c1', 'spark', 16);
                spawnSmoke(6, '#6d5060', 28);
                break;
            default:
                spawnRing(sparks, definition.blastRadius / 8.5, definition.projectileColor, 'spark', 18);
                spawnRing(dust, definition.blastRadius / 10, '#8d5a3a', 'dust', 24);
                spawnSmoke(5, '#5d5366', 34);
                break;
        }
    }
    private persistShotTrace(ownerId: string, history: Array<{ x: number; y: number }>) {
        const owner = this.players.find((player) => player.id === ownerId);
        if (!owner || history.length < 2) return;
        this.shotTraces.push({ color: owner.color, points: history.map((point) => ({ x: point.x, y: point.y })) });
        if (this.shotTraces.length > 90) this.shotTraces.shift();
    }


    private findRemoteProjectileCandidate(weaponType: WeaponType, impactX: number, impactY: number, ownerId?: string) {
        const candidates = this.projectiles
            .map((projectile, index) => ({ projectile, index }))
            .filter(({ projectile }) => projectile.weaponType === weaponType && (!ownerId || projectile.ownerId === ownerId));
        if (!candidates.length) return null;

        return candidates
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
    }

    private reconcileRemoteProjectile(weaponType: WeaponType, impactX: number, impactY: number, ownerId?: string) {
        const best = this.findRemoteProjectileCandidate(weaponType, impactX, impactY, ownerId);
        if (!best) return;

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
        this.drawProgressiveBlasts();
        this.drawGravityPulses();
        this.drawTechPulses();
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

    private updateProgressiveBlasts() {
        let changed = false;
        for (let index = this.progressiveBlasts.length - 1; index >= 0; index -= 1) {
            const blast = this.progressiveBlasts[index];
            const previousRadius = blast.currentRadius;
            const speedFactor = blast.style === 'solar' ? 0.082 : blast.style === 'void' ? 0.066 : 0.072;
            const minStep = blast.style === 'solar' ? 2.9 : blast.style === 'void' ? 2.3 : 2.6;
            if (blast.currentRadius < blast.targetRadius) {
                blast.currentRadius = Math.min(blast.targetRadius, blast.currentRadius + Math.max(minStep, blast.targetRadius * speedFactor));
                if (blast.currentRadius > blast.lastCarvedRadius + 0.45) {
                    this.terrain.carveCircle(blast.x, blast.y, blast.currentRadius);
                    blast.lastCarvedRadius = blast.currentRadius;
                    changed = true;
                }
            } else {
                blast.settleFrames += 1;
            }
            if (blast.currentRadius !== previousRadius) {
                changed = true;
            }
            if (blast.currentRadius >= blast.targetRadius && blast.settleFrames > 10) {
                this.progressiveBlasts.splice(index, 1);
            }
        }
        return changed;
    }

    private queueProgressiveBlast(x: number, y: number, radius: number, weaponType: WeaponType) {
        const style = getWeaponExplosionStyle(weaponType);
        if (style !== 'nuclear' && style !== 'nova_blast' && style !== 'solar' && style !== 'void') return;

        const palette = style === 'nova_blast'
            ? { coreColor: '#fffaff', outerColor: '#8fd8ff', glowColor: '#4ea5ff', rimColor: '#eaf8ff' }
            : style === 'solar'
                ? { coreColor: '#fff1a8', outerColor: '#ffd36e', glowColor: '#ffe28d', rimColor: '#00000000' }
                : style === 'void'
                    ? { coreColor: '#090410', outerColor: '#6d38c9', glowColor: '#b279ff', rimColor: '#f2deff' }
                    : { coreColor: '#fff1cf', outerColor: '#ff8d4d', glowColor: '#ffbb73', rimColor: '#fff7e8' };

        this.progressiveBlasts.push({
            x,
            y,
            targetRadius: radius,
            currentRadius: 4,
            lastCarvedRadius: 0,
            settleFrames: 0,
            style,
            ...palette
        });
    }

    private drawProgressiveBlasts() {
        this.progressiveBlasts.forEach((blast) => {
            const ratio = Math.max(0, Math.min(1, blast.currentRadius / blast.targetRadius));
            const outerRadius = Math.max(4, blast.currentRadius);
            const middleRadius = Math.max(3, outerRadius * 0.72);
            const coreRadius = Math.max(2, outerRadius * 0.44);

            this.ctx.save();
            if (blast.style === 'solar') {
                this.ctx.globalAlpha = Math.max(0.12, 0.32 * (1 - ratio * 0.42));
                this.ctx.fillStyle = this.colorWithAlpha(blast.glowColor, 1);
                this.ctx.beginPath();
                this.ctx.arc(blast.x, blast.y, outerRadius, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.globalAlpha = Math.max(0.18, 0.58 * (1 - ratio * 0.25));
                this.ctx.fillStyle = this.colorWithAlpha(blast.coreColor, 1);
                this.ctx.beginPath();
                this.ctx.arc(blast.x, blast.y, outerRadius * 0.58, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.restore();
                return;
            }

            if (blast.style === 'void') {
                this.ctx.globalAlpha = Math.max(0.1, 0.28 * (1 - ratio * 0.3));
                this.ctx.fillStyle = this.colorWithAlpha(blast.glowColor, 1);
                this.ctx.beginPath();
                this.ctx.arc(blast.x, blast.y, outerRadius, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.globalAlpha = Math.max(0.18, 0.46 * (1 - ratio * 0.22));
                this.ctx.fillStyle = this.colorWithAlpha(blast.outerColor, 1);
                this.ctx.beginPath();
                this.ctx.arc(blast.x, blast.y, middleRadius, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.globalAlpha = Math.max(0.28, 0.72 * (1 - ratio * 0.18));
                this.ctx.fillStyle = this.colorWithAlpha(blast.coreColor, 1);
                this.ctx.beginPath();
                this.ctx.arc(blast.x, blast.y, coreRadius, 0, Math.PI * 2);
                this.ctx.fill();

                this.ctx.globalAlpha = Math.max(0.12, 0.42 * (1 - ratio * 0.32));
                this.ctx.strokeStyle = this.colorWithAlpha(blast.rimColor, 1);
                this.ctx.lineWidth = 1;
                this.ctx.beginPath();
                this.ctx.arc(blast.x, blast.y, outerRadius * 0.94, 0, Math.PI * 2);
                this.ctx.stroke();
                this.ctx.restore();
                return;
            }

            this.ctx.globalAlpha = Math.max(0.08, 0.24 * (1 - ratio * 0.45));
            this.ctx.fillStyle = this.colorWithAlpha(blast.glowColor, 1);
            this.ctx.beginPath();
            this.ctx.arc(blast.x, blast.y, outerRadius, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.globalAlpha = Math.max(0.12, 0.36 * (1 - ratio * 0.35));
            this.ctx.fillStyle = this.colorWithAlpha(blast.outerColor, 1);
            this.ctx.beginPath();
            this.ctx.arc(blast.x, blast.y, middleRadius, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.globalAlpha = Math.max(0.16, 0.62 * (1 - ratio * 0.28));
            this.ctx.fillStyle = this.colorWithAlpha(blast.coreColor, 1);
            this.ctx.beginPath();
            this.ctx.arc(blast.x, blast.y, coreRadius, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.globalAlpha = Math.max(0.1, 0.28 * (1 - ratio * 0.55));
            this.ctx.strokeStyle = this.colorWithAlpha(blast.rimColor, 1);
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.arc(blast.x, blast.y, outerRadius * 0.98, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.restore();
        });
    }

    private updateGravityPulses() {
        for (let index = this.gravityPulses.length - 1; index >= 0; index -= 1) {
            const pulse = this.gravityPulses[index];
            pulse.life -= 1;
            pulse.radius = Math.min(pulse.maxRadius, pulse.radius + Math.max(1.2, pulse.maxRadius * 0.045));
            pulse.rotation += 0.04;
            if (pulse.life <= 0) {
                this.gravityPulses.splice(index, 1);
            }
        }
    }

    private queueGravityPulse(x: number, y: number, radius: number, color: string) {
        this.gravityPulses.push({
            x,
            y,
            radius: 4,
            maxRadius: Math.max(12, radius * 1.45),
            life: 28,
            maxLife: 28,
            rotation: this.nextRandom() * Math.PI * 2,
            coreColor: '#f3fbff',
            glowColor: color,
            lineColor: '#8be6ff'
        });
    }

    private drawGravityPulses() {
        this.gravityPulses.forEach((pulse) => {
            const alpha = Math.max(0, pulse.life / pulse.maxLife);
            const innerRadius = pulse.radius * 0.38;
            const rimRadius = pulse.radius * 0.82;

            this.ctx.save();
            this.ctx.translate(pulse.x, pulse.y);
            this.ctx.rotate(pulse.rotation);

            this.ctx.globalAlpha = 0.14 * alpha;
            this.ctx.fillStyle = this.colorWithAlpha(pulse.glowColor, 1);
            this.ctx.beginPath();
            this.ctx.arc(0, 0, pulse.radius, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.globalAlpha = 0.18 * alpha;
            this.ctx.fillStyle = '#08111d';
            this.ctx.beginPath();
            this.ctx.arc(0, 0, innerRadius, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.globalAlpha = 0.52 * alpha;
            this.ctx.strokeStyle = this.colorWithAlpha(pulse.lineColor, 1);
            this.ctx.lineWidth = 1;
            for (let index = 0; index < 6; index += 1) {
                const angle = (Math.PI * 2 * index) / 6;
                const inner = innerRadius + 2;
                const outer = pulse.radius * (0.9 + (index % 2) * 0.06);
                this.ctx.beginPath();
                this.ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
                this.ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
                this.ctx.stroke();
            }

            this.ctx.globalAlpha = 0.42 * alpha;
            this.ctx.strokeStyle = this.colorWithAlpha(pulse.coreColor, 1);
            this.ctx.beginPath();
            this.ctx.arc(0, 0, rimRadius, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.beginPath();
            this.ctx.arc(0, 0, pulse.radius, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.restore();
        });
    }

    private updateTechPulses() {
        for (let index = this.techPulses.length - 1; index >= 0; index -= 1) {
            const pulse = this.techPulses[index];
            pulse.life -= 1;
            pulse.size = Math.min(pulse.maxSize, pulse.size + Math.max(1.4, pulse.maxSize * 0.055));
            pulse.rotation += 0.028;
            if (pulse.life <= 0) {
                this.techPulses.splice(index, 1);
            }
        }
    }

    private queueTechPulse(x: number, y: number, radius: number, primaryColor: string, secondaryColor: string) {
        this.techPulses.push({
            x,
            y,
            size: 6,
            maxSize: Math.max(14, radius * 1.5),
            life: 24,
            maxLife: 24,
            rotation: this.nextRandom() * Math.PI * 2,
            primaryColor,
            secondaryColor
        });
    }

    private drawTechPulses() {
        this.techPulses.forEach((pulse) => {
            const alpha = Math.max(0, pulse.life / pulse.maxLife);
            const outer = pulse.size;
            const middle = pulse.size * 0.68;
            const inner = pulse.size * 0.36;

            this.ctx.save();
            this.ctx.translate(pulse.x, pulse.y);
            this.ctx.rotate(pulse.rotation);
            this.ctx.globalAlpha = 0.58 * alpha;
            this.ctx.strokeStyle = this.colorWithAlpha(pulse.primaryColor, 1);
            this.ctx.lineWidth = 1;
            this.ctx.strokeRect(-outer, -outer, outer * 2, outer * 2);
            this.ctx.rotate(Math.PI / 4);
            this.ctx.strokeRect(-middle, -middle, middle * 2, middle * 2);
            this.ctx.rotate(-Math.PI / 4);

            this.ctx.globalAlpha = 0.22 * alpha;
            this.ctx.fillStyle = this.colorWithAlpha(pulse.secondaryColor, 1);
            this.ctx.fillRect(-inner, -inner, inner * 2, inner * 2);

            this.ctx.globalAlpha = 0.46 * alpha;
            this.ctx.strokeStyle = this.colorWithAlpha('#e8fbff', 1);
            this.ctx.beginPath();
            this.ctx.moveTo(-outer * 1.05, 0);
            this.ctx.lineTo(outer * 1.05, 0);
            this.ctx.moveTo(0, -outer * 1.05);
            this.ctx.lineTo(0, outer * 1.05);
            this.ctx.stroke();
            this.ctx.restore();
        });
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
                mirvSpread: 'normal',
                canAdjustMirvSpread: false,
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
        const debugSuffix = this.settings.debugUnlimitedArsenal
            ? ` | DBG stale ${this.stalemateCounter}/${this.stalemateLimit} | wind ${this.state.wind.toFixed(2)} | proj ${this.projectiles.length}+${this.pendingProjectiles.length}`
            : '';
        const hintLabel = this.state.phase === 'game_over'
            ? this.roundEndReason === 'stalemate'
                ? `Stalemate cap reached. ${winner?.name ?? 'No one'} gets the round on advantage.`
                : `${winner?.name ?? 'No one'} won the round. Open the debrief and shop to continue.`
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
            campaignLabel: `Round ${this.roundNumber}/${this.settings.rounds} | ${this.settings.terrainCollapse ? 'Collapse on' : 'Collapse off'}${debugSuffix}`, 
            shieldPercent: currentPlayer.maxShield > 0 ? currentPlayer.shield / currentPlayer.maxShield : 0,
            weaponLabel: `${weaponDefinition.name} | Ammo ${ammoLabel}`,
            healthPercent: currentPlayer.health / 100,
            weaponDetail: `${weaponDefinition.flavor} | Blast ${weaponDefinition.blastRadius} | Damage ${weaponDefinition.damage}`,
            powerLabel: `Charge ${Math.round(currentPlayer.power)} / ${currentMaxPower}`,
            powerPercent: currentPlayer.power / Math.max(1, currentMaxPower),
            angleLabel: `Angle ${angleDegrees} deg`,
            mirvSpread: currentPlayer.mirvSpread,
            canAdjustMirvSpread: this.canLocalControlCurrentTank() && weapon.type === 'command_mirv',
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
            winnerLabel: this.state.phase === 'game_over'
                ? this.roundEndReason === 'stalemate'
                    ? `Stalemate cap reached | ${winner?.name ?? 'No one'} takes round ${this.roundNumber}`
                    : `${winner?.name ?? 'No one'} wins round ${this.roundNumber}`
                : '',
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
            mirvSpread: tank.mirvSpread,
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

        const baseChoice = best.score > Number.NEGATIVE_INFINITY ? best : safest.score > Number.NEGATIVE_INFINITY ? safest : {
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
        const attemptedWeaponType = tank.weapons[chosen.weaponIndex]?.type ?? tank.currentWeapon.type;
        const attemptedImpact = this.simulateBotImpact(tank, attemptedWeaponType, attemptedAngle, attemptedPower);
        const attemptedScore = attemptedImpact ? this.scoreBotImpact(tank, attemptedWeaponType, attemptedImpact.x, attemptedImpact.y, rankedTargets[0]?.id ?? '') : Number.NEGATIVE_INFINITY;
        if (attemptedImpact
            && this.isBotImpactSafe(tank, attemptedWeaponType, attemptedImpact.x, attemptedImpact.y)
            && attemptedScore >= best.score - 18
            && attemptedScore > -24) {
            chosen.angle = attemptedAngle;
            chosen.power = attemptedPower;
        }
        return chosen;
    }

    private simulateBotImpact(owner: Tank, weaponType: WeaponType, angle: number, power: number) {
        const start = owner.barrelTip;
        const projectile = new Projectile(start.x, start.y, angle, power, owner.id, weaponType, undefined, undefined, undefined, undefined, { mirvSpread: owner.mirvSpread });
        const activePlayers = this.players.filter((player) => player.alive);
        for (let tick = 0; tick < 480; tick += 1) {
            const impact = projectile.step(this.terrain, activePlayers, this.state.gravity, this.state.wind);
            if (impact) return impact;
            if ((weaponType === 'merv' || weaponType === 'merv_mk2' || weaponType === 'chaos_mirv' || weaponType === 'large_merv' || weaponType === 'large_chaos_mirv' || weaponType === 'command_mirv' || weaponType === 'supernova_mirv' || weaponType === 'apocalypse_mirv' || weaponType === 'solar_mirv') && projectile.shouldSplit(this.terrain)) {
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
            + (weaponType === 'autocannon' || weaponType === 'large_autocannon' ? 4 : 0)
            + (weaponType === 'grapeshot' ? 4 : 0)
            + (weaponType === 'orbital_lance' || weaponType === 'deadfall' || weaponType === 'prism_lance' ? 12 : 0)
            + (weaponType === 'aftershock' || weaponType === 'fault_line' ? 10 : 0)
            + (weaponType === 'geyser' ? 6 : 0)
            + (weaponType === 'storm_net' || weaponType === 'chaos_crown' || weaponType === 'eclipse_shell' ? 12 : 0)
            + (weaponType === 'supernova_mirv' || weaponType === 'solar_mirv' ? 10 : 0)
            + (weaponType === 'apocalypse_mirv' ? 14 : 0)
            + (weaponType === 'void_bomb' || weaponType === 'singularity_echo' ? 16 : 0)
            + (weaponType === 'aurora_helix' ? 10 : 0);
        const selfDistance = Math.hypot(owner.x - impactX, (owner.y - owner.bodyHeight / 2) - impactY);
        let total = selfDistance < effectiveRadius + 18 ? -220 : 0;
        let nearestEnemyDistance = Number.POSITIVE_INFINITY;
        let affectedEnemy = false;
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
            nearestEnemyDistance = Math.min(nearestEnemyDistance, distance);
            if (estimatedDamage <= 0) continue;
            affectedEnemy = true;
            const focusBonus = tank.id === focusTargetId ? 1.7 : 1.1;
            total += estimatedDamage * focusBonus;
            if (tank.health + tank.shield <= estimatedDamage) total += 42;
            if (tank.shield > 0) total += 4;
        }
        if (Number.isFinite(nearestEnemyDistance)) {
            total -= nearestEnemyDistance * 0.18;
        }
        if (!affectedEnemy) {
            total -= 110;
        }
        return total + effectiveRadius * 0.15;
    }

    private isBotImpactSafe(owner: Tank, weaponType: WeaponType, impactX: number, impactY: number) {
        const definition = WEAPON_DEFINITIONS[weaponType];
        const effectiveRadius = definition.blastRadius
            + (weaponType === 'merv' || weaponType === 'chaos_mirv' || weaponType === 'large_merv' || weaponType === 'large_chaos_mirv' ? 8 : 0)
            + (weaponType === 'chaos' || weaponType === 'large_chaos' ? 6 : 0)
            + (weaponType === 'driller' || weaponType === 'large_driller' ? 10 : 0)
            + (weaponType === 'autocannon' || weaponType === 'large_autocannon' ? 4 : 0)
            + (weaponType === 'grapeshot' ? 4 : 0)
            + (weaponType === 'orbital_lance' || weaponType === 'deadfall' ? 12 : 0)
            + (weaponType === 'aftershock' || weaponType === 'fault_line' ? 10 : 0)
            + (weaponType === 'geyser' ? 6 : 0);
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
            mirvSpread: currentPlayer.mirvSpread,
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
        if (weaponType === 'minigun') return 15;
        if (weaponType === 'large_autocannon') return 7;
        if (weaponType === 'autocannon') return 5;
        if (weaponType === 'grapeshot') return 7;
        return 1;
    }

    private getWeaponSpendValue(weaponType: WeaponType) {
        return getWeaponAmmoUnitPrice(weaponType, 1) ?? 24;
    }
    private setActiveProjectilesFromBurst(burst: Projectile[], weaponType: WeaponType) {
        this.pendingProjectiles = [];
        if (weaponType !== 'autocannon' && weaponType !== 'large_autocannon' && weaponType !== 'minigun') {
            this.projectiles = burst;
            return;
        }

        const cadence = weaponType === 'minigun' ? 68 : weaponType === 'large_autocannon' ? 128 : 145;
        this.projectiles = burst.length ? [burst[0]] : [];
        this.pendingProjectiles = burst.slice(1).map((projectile, index) => ({
            delayMs: (index + 1) * cadence,
            projectile,
            playFire: true
        }));
    }

    private getChaosFollowupLimit(weaponType: WeaponType) {
        if (weaponType === 'chaos' || weaponType === 'chaos_mirv') return 2;
        if (weaponType === 'large_chaos' || weaponType === 'large_chaos_mirv') return 4;
        return -1;
    }

    private createProjectileBurst(startX: number, startY: number, angle: number, power: number, ownerId: string, weaponType: WeaponType, mirvSpread: MirvSpreadMode = 'normal') {
        if (weaponType === 'grapeshot') {
            const offsets = [-0.18, -0.12, -0.06, 0, 0.06, 0.12, 0.18];
            return offsets.map((angleOffset, index) => {
                const powerOffset = index === 3 ? 0 : (index < 3 ? -6 + index * 2 : -6 + (6 - index) * 2);
                return new Projectile(
                    startX,
                    startY,
                    angle + angleOffset,
                    Math.max(6, power + powerOffset),
                    ownerId,
                    weaponType,
                    undefined,
                    undefined,
                    undefined,
                    undefined,
                    { mirvSpread }
                );
            });
        }

        if (weaponType !== 'autocannon' && weaponType !== 'large_autocannon' && weaponType !== 'minigun') {
            return [new Projectile(startX, startY, angle, power, ownerId, weaponType, undefined, undefined, undefined, undefined, { mirvSpread })];
        }

        const shotCount = weaponType === 'minigun' ? 15 : weaponType === 'large_autocannon' ? 7 : 5;
        const maxOffset = weaponType === 'minigun' ? 2 : weaponType === 'large_autocannon' ? 4 : 3;
        return Array.from({ length: shotCount }, (_, index) => {
            const spread = this.getAutocannonSpread(ownerId, index, maxOffset);
            return new Projectile(
                startX,
                startY,
                angle + spread.angleOffset,
                Math.max(6, power + spread.powerOffset),
                ownerId,
                weaponType,
                undefined,
                undefined,
                undefined,
                undefined,
                { mirvSpread }
            );
        });
    }

    public setMirvSpread(mode: MirvSpreadMode) {
        if (!this.canLocalControlCurrentTank()) return;
        const tank = this.currentPlayer;
        if (!tank || tank.currentWeapon.type !== 'command_mirv') return;
        tank.mirvSpread = mode;
        this.turnInteractionStarted = true;
        this.broadcastAimState();
        this.emitHud();
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
            this.terrain.raiseWall(primary.x, primary.y, 11, 72, '#8b7454');
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

    private pullTanksToward(centerX: number, centerY: number, radius: number, maxShift: number) {
        for (const tank of this.players) {
            if (!tank.alive) continue;
            const tankCenterY = tank.y - tank.bodyHeight / 2;
            const dx = centerX - tank.x;
            const dy = centerY - tankCenterY;
            const distance = Math.hypot(dx, dy);
            if (distance <= 0 || distance > radius) continue;
            const pull = (1 - distance / radius) * maxShift;
            const nextX = tank.x + (dx / distance) * pull;
            const nextY = tank.y + (dy / distance) * Math.min(1.5, pull * 0.35);
            tank.x = clamp(nextX, 5, LOGICAL_WIDTH - 6);
            tank.y = clamp(nextY, 0, LOGICAL_HEIGHT - 1);
            if (this.tankIntersectsTerrain(tank)) {
                tank.y -= 1;
            }
        }
    }

    private pushTanksAway(centerX: number, centerY: number, radius: number, maxShift: number) {
        for (const tank of this.players) {
            if (!tank.alive) continue;
            const tankCenterY = tank.y - tank.bodyHeight / 2;
            let dx = tank.x - centerX;
            let dy = tankCenterY - centerY;
            let distance = Math.hypot(dx, dy);
            if (distance > radius) continue;
            if (distance < 0.001) {
                dx = tank.x <= centerX ? -1 : 1;
                dy = -0.35;
                distance = 1;
            }
            const push = (1 - distance / radius) * maxShift;
            const nextX = tank.x + (dx / distance) * push;
            const nextY = tank.y + (dy / distance) * Math.min(1.8, push * 0.3) - Math.max(0.2, push * 0.16);
            tank.x = clamp(nextX, 5, LOGICAL_WIDTH - 6);
            tank.y = clamp(nextY, 0, LOGICAL_HEIGHT - 1);
            if (this.tankIntersectsTerrain(tank)) {
                tank.y -= 1;
            }
        }
    }

    private queueImpactFollowups(ownerId: string, weaponType: WeaponType, impactX: number, impactY: number, impactDirX: number, impactDirY: number) {
        const definition = WEAPON_DEFINITIONS[weaponType];
        const groundedY = (rawX: number, fallbackY = impactY) => {
            const x = Math.round(clamp(rawX, 2, LOGICAL_WIDTH - 3));
            const rawSampleY = Math.round(clamp(fallbackY, 2, LOGICAL_HEIGHT - 3));
            const y = this.terrain.isSolid(x, rawSampleY)
                ? this.terrain.getSurfaceY(x) - 1
                : rawSampleY;
            return { x, y: Math.round(clamp(y, 2, LOGICAL_HEIGHT - 3)) };
        };

        if (weaponType === 'singularity_echo') {
            this.queueGravityPulse(impactX, impactY, Math.max(22, definition.blastRadius + 10), '#b77bff');
            this.pendingBursts.push(
                {
                    delayMs: 170,
                    ownerId,
                    weaponType,
                    x: impactX,
                    y: impactY,
                    radius: Math.max(22, definition.blastRadius + 10),
                    damage: 0,
                    mode: 'echo_implode'
                },
                {
                    delayMs: 520,
                    ownerId,
                    weaponType,
                    x: impactX,
                    y: impactY,
                    radius: Math.max(14, definition.blastRadius + 6),
                    damage: Math.max(16, definition.damage + 8),
                    mode: 'burst'
                }
            );
            return;
        }

        if (weaponType === 'prism_lance') {
            const points = [
                { dx: 0, dy: 0, delay: 120, bonus: 5 },
                { dx: -14, dy: 0, delay: 200, bonus: 0 },
                { dx: 14, dy: 0, delay: 280, bonus: 0 },
                { dx: 0, dy: -14, delay: 360, bonus: 0 },
                { dx: 0, dy: 14, delay: 440, bonus: 0 }
            ];
            points.forEach((point) => {
                const x = Math.round(clamp(impactX + point.dx, 2, LOGICAL_WIDTH - 3));
                const y = Math.round(clamp(this.terrain.isSolid(x, Math.round(clamp(impactY + point.dy, 2, LOGICAL_HEIGHT - 3))) ? this.terrain.getSurfaceY(x) - 1 : impactY + point.dy, 2, LOGICAL_HEIGHT - 3));
                this.pendingBursts.push({
                    delayMs: point.delay,
                    ownerId,
                    weaponType,
                    x,
                    y,
                    radius: Math.max(6, definition.blastRadius + (point.bonus ? 2 : 0)),
                    damage: definition.damage + point.bonus,
                    mode: 'burst'
                });
            });
            return;
        }

        if (weaponType === 'chaos_crown') {
            const crownBursts = 6;
            for (let index = 0; index < crownBursts; index += 1) {
                const angle = (Math.PI * 2 * index) / crownBursts - Math.PI / 2;
                this.pendingBursts.push({
                    delayMs: 95 + index * 50,
                    ownerId,
                    weaponType,
                    x: Math.round(clamp(impactX + Math.cos(angle) * 20, 2, LOGICAL_WIDTH - 3)),
                    y: Math.round(clamp(impactY + Math.sin(angle) * 20, 2, LOGICAL_HEIGHT - 3)),
                    radius: Math.max(6, definition.blastRadius - 1),
                    damage: Math.max(10, definition.damage - 2),
                    mode: 'burst'
                });
            }
            return;
        }

        if (weaponType === 'eclipse_shell') {
            this.queueGravityPulse(impactX, impactY, Math.max(18, definition.blastRadius + 8), '#c9b7ff');
            const haloCount = 6;
            for (let index = 0; index < haloCount; index += 1) {
                const angle = (Math.PI * 2 * index) / haloCount;
                this.pendingBursts.push({
                    delayMs: 130 + index * 38,
                    ownerId,
                    weaponType,
                    x: Math.round(clamp(impactX + Math.cos(angle) * 18, 2, LOGICAL_WIDTH - 3)),
                    y: Math.round(clamp(impactY + Math.sin(angle) * 18, 2, LOGICAL_HEIGHT - 3)),
                    radius: Math.max(6, definition.blastRadius - 2),
                    damage: Math.max(10, definition.damage - 1),
                    mode: 'burst'
                });
            }
            return;
        }

        if (weaponType === 'aurora_helix') {
            const directionLength = Math.hypot(impactDirX, impactDirY) || 1;
            const dirX = impactDirX / directionLength;
            const dirY = impactDirY / directionLength;
            const normalX = -dirY;
            const normalY = dirX;
            for (let step = 1; step <= 6; step += 1) {
                const side = step % 2 === 0 ? -1 : 1;
                const distance = 10 + step * 9;
                const lateral = side * (5 + step * 2.1);
                this.pendingBursts.push({
                    delayMs: 70 + step * 36,
                    ownerId,
                    weaponType,
                    x: Math.round(clamp(impactX + dirX * distance + normalX * lateral, 2, LOGICAL_WIDTH - 3)),
                    y: Math.round(clamp(impactY + dirY * distance + normalY * lateral, 2, LOGICAL_HEIGHT - 3)),
                    radius: Math.max(6, definition.blastRadius - Math.floor(step / 3)),
                    damage: Math.max(10, definition.damage - Math.floor(step / 2)),
                    mode: 'burst'
                });
            }
            return;
        }

        if (weaponType === 'storm_net') {
            this.queueGravityPulse(impactX, impactY, Math.max(22, definition.blastRadius + 12), '#7feaff');
            const offsets = [
                { dx: -18, dy: -14 },
                { dx: 18, dy: -14 },
                { dx: 0, dy: 0 },
                { dx: -18, dy: 14 },
                { dx: 18, dy: 14 },
                { dx: 0, dy: -20 },
                { dx: 0, dy: 20 },
                { dx: -24, dy: 0 },
                { dx: 24, dy: 0 }
            ];
            offsets.forEach((offset, index) => {
                const x = Math.round(clamp(impactX + offset.dx, 2, LOGICAL_WIDTH - 3));
                const y = Math.round(clamp(this.terrain.isSolid(x, Math.round(clamp(impactY + offset.dy, 2, LOGICAL_HEIGHT - 3))) ? this.terrain.getSurfaceY(x) - 1 : impactY + offset.dy, 2, LOGICAL_HEIGHT - 3));
                this.pendingBursts.push({
                    delayMs: 80 + index * 32,
                    ownerId,
                    weaponType,
                    x,
                    y,
                    radius: Math.max(5, definition.blastRadius),
                    damage: Math.max(8, definition.damage - (index === 2 ? 0 : 1)),
                    mode: 'burst'
                });
            });
            return;
        }

        if (weaponType === 'echo_shell') {
            this.queueGravityPulse(impactX, impactY, Math.max(18, definition.blastRadius + 6), '#86d9ff');
            this.pendingBursts.push(
                {
                    delayMs: 150,
                    ownerId,
                    weaponType,
                    x: impactX,
                    y: impactY,
                    radius: Math.max(18, definition.blastRadius + 8),
                    damage: 0,
                    mode: 'echo_implode'
                },
                {
                    delayMs: 430,
                    ownerId,
                    weaponType,
                    x: impactX,
                    y: impactY,
                    radius: Math.max(8, definition.blastRadius + 1),
                    damage: Math.max(12, definition.damage + 4),
                    mode: 'echo_blast'
                }
            );
            return;
        }

        if (weaponType === 'orbital_lance') {
            this.queueGravityPulse(impactX, impactY, Math.max(10, definition.blastRadius - 2), '#bfefff');
            [-6, 0, 6].forEach((offset, index) => {
                const point = groundedY(impactX + offset, this.terrain.getSurfaceY(impactX + offset) - 1);
                this.pendingBursts.push({
                    delayMs: 150 + index * 90,
                    ownerId,
                    weaponType,
                    x: point.x,
                    y: point.y,
                    radius: Math.max(7, definition.blastRadius - 2 + (index === 1 ? 2 : 0)),
                    damage: definition.damage + (index === 1 ? 6 : 0),
                    mode: 'burst'
                });
            });
            return;
        }

        if (weaponType === 'arc_mine') {
            this.queueGravityPulse(impactX, impactY, Math.max(8, definition.blastRadius - 4), '#ffdcb8');
            this.pendingBursts.push({
                delayMs: 650,
                ownerId,
                weaponType,
                x: impactX,
                y: impactY,
                radius: definition.blastRadius,
                damage: definition.damage,
                mode: 'burst'
            });
            return;
        }

        if (weaponType === 'aftershock') {
            for (let step = 1; step <= 3; step += 1) {
                [-1, 1].forEach((direction, sideIndex) => {
                    const point = groundedY(impactX + direction * step * 13, impactY + step * 2);
                    this.pendingBursts.push({
                        delayMs: 70 + step * 55 + sideIndex * 14,
                        ownerId,
                        weaponType,
                        x: point.x,
                        y: point.y,
                        radius: Math.max(5, definition.blastRadius - Math.floor(step / 2)),
                        damage: Math.max(8, definition.damage - step * 2),
                        mode: 'burst'
                    });
                });
            }
            return;
        }

        if (weaponType === 'deadfall') {
            [-18, -8, 0, 8, 18].forEach((offset, index) => {
                const point = groundedY(impactX + offset, this.terrain.getSurfaceY(impactX + offset) - 1);
                this.pendingBursts.push({
                    delayMs: 120 + index * 70,
                    ownerId,
                    weaponType,
                    x: point.x,
                    y: point.y,
                    radius: Math.max(5, definition.blastRadius - (index === 2 ? -1 : 0)),
                    damage: Math.max(9, definition.damage - Math.abs(index - 2)),
                    mode: 'burst'
                });
            });
            return;
        }

        if (weaponType === 'helix_shell') {
            const directionLength = Math.hypot(impactDirX, impactDirY) || 1;
            const dirX = impactDirX / directionLength;
            const dirY = impactDirY / directionLength;
            const normalX = -dirY;
            const normalY = dirX;
            for (let step = 1; step <= 6; step += 1) {
                const side = step % 2 === 0 ? -1 : 1;
                const distance = 8 + step * 8;
                const lateral = side * (4 + step * 1.8);
                const point = groundedY(impactX + dirX * distance + normalX * lateral, impactY + dirY * distance + normalY * lateral);
                this.pendingBursts.push({
                    delayMs: 70 + step * 38,
                    ownerId,
                    weaponType,
                    x: point.x,
                    y: point.y,
                    radius: Math.max(4, definition.blastRadius - Math.floor(step / 3)),
                    damage: Math.max(8, definition.damage - Math.floor(step / 2)),
                    mode: 'burst'
                });
            }
            return;
        }

        if (weaponType === 'volt_net') {
            this.queueGravityPulse(impactX, impactY, Math.max(24, definition.blastRadius + 14), '#8feeff');
            this.queueTechPulse(impactX, impactY, Math.max(18, definition.blastRadius + 10), '#f6ffff', '#74f2ff');
            const offsets = [
                { dx: -18, dy: -14 },
                { dx: 18, dy: -14 },
                { dx: -18, dy: 14 },
                { dx: 18, dy: 14 },
                { dx: 0, dy: 0 }
            ];
            offsets.forEach((offset, index) => {
                const point = groundedY(impactX + offset.dx, impactY + offset.dy);
                this.pendingBursts.push({
                    delayMs: 75 + index * 42,
                    ownerId,
                    weaponType,
                    x: point.x,
                    y: point.y,
                    radius: Math.max(5, definition.blastRadius),
                    damage: Math.max(9, definition.damage - (index === 4 ? 0 : 1)),
                    mode: 'burst'
                });
            });
            return;
        }

        if (weaponType === 'shrapnel_cone') {
            const directionLength = Math.hypot(impactDirX, impactDirY) || 1;
            const dirX = impactDirX / directionLength;
            const dirY = impactDirY / directionLength;
            for (let step = 1; step <= 6; step += 1) {
                const distance = step * 7;
                const point = {
                    x: Math.round(clamp(impactX + dirX * distance, 2, LOGICAL_WIDTH - 3)),
                    y: Math.round(clamp(impactY + dirY * distance, 2, LOGICAL_HEIGHT - 3))
                };
                this.pendingBursts.push({
                    delayMs: 55 + step * 48,
                    ownerId,
                    weaponType,
                    x: point.x,
                    y: point.y,
                    radius: Math.max(4, definition.blastRadius - 1 + step),
                    damage: Math.max(8, definition.damage - Math.floor(step / 2)),
                    mode: 'burst'
                });
            }
            return;
        }

        if (weaponType === 'flux_bomb') {
            this.queueTechPulse(impactX, impactY, Math.max(16, definition.blastRadius), '#f2f6ff', '#9eb6ff');
            this.pendingBursts.push({
                delayMs: 260,
                ownerId,
                weaponType,
                x: impactX,
                y: impactY,
                radius: definition.blastRadius + 6,
                damage: Math.max(10, definition.damage - 10),
                mode: 'burst'
            });
            return;
        }

        if (weaponType === 'blossom') {
            return;
        }

        if (weaponType === 'crossfire') {
            this.queueTechPulse(impactX, impactY, Math.max(14, definition.blastRadius + 6), '#fff8de', '#ffd166');
            const rays = [
                { dx: 1, dy: 0 },
                { dx: -1, dy: 0 },
                { dx: 0, dy: 1 },
                { dx: 0, dy: -1 }
            ];
            rays.forEach((ray, rayIndex) => {
                for (let step = 1; step <= 3; step += 1) {
                    this.pendingBursts.push({
                        delayMs: 55 + rayIndex * 18 + step * 42,
                        ownerId,
                        weaponType,
                        x: Math.round(clamp(impactX + ray.dx * step * 13, 2, LOGICAL_WIDTH - 3)),
                        y: Math.round(clamp(impactY + ray.dy * step * 13, 2, LOGICAL_HEIGHT - 3)),
                        radius: Math.max(4, definition.blastRadius - Math.floor(step / 2)),
                        damage: Math.max(9, definition.damage - step),
                        mode: 'burst'
                    });
                }
            });
            return;
        }
    }

    private resolveDelayedBurst(pending: PendingBurst) {
        if (pending.mode === 'echo_implode') {
            this.queueGravityPulse(pending.x, pending.y, pending.radius, '#86d9ff');
            this.pullTanksToward(pending.x, pending.y, pending.radius + 14, Math.max(16, pending.radius * 0.26));
            this.audio.playExplosion(Math.max(8, Math.round(pending.radius * 0.45)), 'gravity_well');
            this.screenShake = Math.max(this.screenShake, pending.radius / 9);
            this.finalizeDelayedResolutionIfIdle();
            return;
        }

        if (this.usesProgressiveBlastEffect(pending.weaponType)) {
            this.queueProgressiveBlast(pending.x, pending.y, pending.radius, pending.weaponType);
        } else {
            this.terrain.carveCircle(pending.x, pending.y, pending.radius);
        }

        const damageEvents = this.damagePlayers(pending.ownerId, pending.x, pending.y, pending.radius, pending.damage);
        if (damageEvents.some((event) => event.amount > 0)) this.turnDamageDealt = true;
        if (pending.weaponType === 'blast_bomb' || pending.weaponType === 'large_blast_bomb') {
            this.pushTanksAway(pending.x, pending.y, pending.radius + 90, pending.weaponType === 'large_blast_bomb' ? 82 : 62);
        }
        this.spawnExplosion(pending.x, pending.y, pending.weaponType);
        this.spawnDamagePopups(damageEvents);
        this.spawnKillDebrisFromEvents(damageEvents);
        if (!this.isSilentImpactWeapon(pending.weaponType)) {
            this.audio.playExplosion(Math.max(1, pending.radius), pending.weaponType);
            this.screenShake = Math.max(this.screenShake, pending.radius / 5);
        }
        this.finalizeDelayedResolutionIfIdle();
    }

    private finalizeDelayedResolutionIfIdle() {
        const hasRemaining = this.projectiles.length > 0 || this.pendingProjectiles.length > 0 || this.pendingBursts.length > 0;
        if (!hasRemaining && this.state.phase === 'projectile') {
            this.awaitingShotResult = false;
            this.resolveTimer = 0.85;
            this.state.phase = 'settling';
        }
    }

    private applyWeaponImpact(ownerId: string, weaponType: WeaponType, bursts: Array<{ x: number; y: number; radius: number; damage: number }>) {
        if (this.isUtilityImpactWeapon(weaponType)) {
            this.applyUtilityImpact(ownerId, weaponType, bursts);
            return [];
        }

        const damageEvents: DamageEvent[] = [];
        const empDrain = weaponType === 'large_needle' ? 999 : weaponType === 'emp_shell' ? 75 : weaponType === 'emp_bomb' || weaponType === 'emp_missile' ? 50 : 0;
        const shieldedTargetsBeforeImpact = weaponType === 'leech'
            ? this.players.some((tank) => tank.alive && tank.id !== ownerId && tank.shield > 0 && bursts.some((burst) => Math.hypot(tank.x - burst.x, (tank.y - tank.bodyHeight / 2) - burst.y) <= burst.radius + 10))
            : false;
        bursts.forEach((burst) => {
            if (empDrain > 0) {
                damageEvents.push(...this.drainShieldBurst(ownerId, burst.x, burst.y, burst.radius, empDrain));
            }
            if (this.usesProgressiveBlastEffect(weaponType)) {
                this.queueProgressiveBlast(burst.x, burst.y, burst.radius, weaponType);
            } else {
                this.terrain.carveCircle(burst.x, burst.y, burst.radius);
            }
            damageEvents.push(...this.damagePlayers(ownerId, burst.x, burst.y, burst.radius, burst.damage));
            this.spawnExplosion(burst.x, burst.y, weaponType);
        });

        if (weaponType === 'leech' && shieldedTargetsBeforeImpact) {
            const leeched = Math.max(0, Math.round(damageEvents.filter((event) => event.targetId !== ownerId).reduce((sum, event) => sum + event.amount, 0) * 0.65));
            if (leeched > 0) {
                const owner = this.players.find((entry) => entry.id === ownerId);
                const restored = owner?.restoreShield(leeched) ?? 0;
                if (restored > 0 && owner) {
                    this.damagePopups.push({
                        x: owner.x,
                        y: owner.y - owner.bodyHeight - 8,
                        text: '+' + restored + ' SH',
                        color: '#62e7ff',
                        life: 40
                    });
                }
            }
        }

        if (weaponType === 'blast_bomb' || weaponType === 'large_blast_bomb') {
            this.pushTanksAway(bursts[0]?.x ?? 0, bursts[0]?.y ?? 0, (bursts[0]?.radius ?? 0) + 90, weaponType === 'large_blast_bomb' ? 82 : 62);
        }

        if (weaponType === 'bulwark_shell') {
            this.terrain.raiseWall(bursts[0]?.x ?? 0, (bursts[0]?.y ?? 0) + 4, 5, 38, '#907455');
        }

        if (weaponType === 'gravity_well') {
            this.pullTanksToward(bursts[0]?.x ?? 0, bursts[0]?.y ?? 0, 138, 34);
        } else if (weaponType === 'magnet_shell') {
            this.pullTanksToward(bursts[0]?.x ?? 0, bursts[0]?.y ?? 0, 116, 26);
        } else if (weaponType === 'volt_net') {
            this.pullTanksToward(bursts[0]?.x ?? 0, bursts[0]?.y ?? 0, 118, 18);
        } else if (weaponType === 'storm_net') {
            this.pullTanksToward(bursts[0]?.x ?? 0, bursts[0]?.y ?? 0, 136, 24);
        } else if (weaponType === 'void_bomb') {
            this.pullTanksToward(bursts[0]?.x ?? 0, bursts[0]?.y ?? 0, 200, 48);
        } else if (weaponType === 'singularity_echo' || weaponType === 'eclipse_shell') {
            this.pullTanksToward(bursts[0]?.x ?? 0, bursts[0]?.y ?? 0, 118, 20);
        }

        return damageEvents;
    }

    private buildImpactBursts(weaponType: WeaponType, impactX: number, impactY: number, impactDirX: number, impactDirY: number) {
        const definition = WEAPON_DEFINITIONS[weaponType];
        if (this.isUtilityImpactWeapon(weaponType)) {
            return [{ x: impactX, y: impactY, radius: 0, damage: 0 }];
        }

        if (weaponType === 'blossom') {
            return [{ x: impactX, y: impactY, radius: Math.max(6, definition.blastRadius), damage: definition.damage + 2 }];
        }

        if (weaponType === 'sinker') {
            return Array.from({ length: 7 }, (_, index) => ({
                x: Math.round(clamp(impactX, 2, LOGICAL_WIDTH - 3)),
                y: Math.round(clamp(impactY + index * 8, 2, LOGICAL_HEIGHT - 3)),
                radius: Math.max(4, definition.blastRadius - Math.floor(index / 2)),
                damage: Math.max(7, definition.damage - index)
            }));
        }

        if (weaponType === 'geyser') {
            return Array.from({ length: 6 }, (_, index) => ({
                x: Math.round(clamp(impactX, 2, LOGICAL_WIDTH - 3)),
                y: Math.round(clamp(impactY - index * 10, 2, LOGICAL_HEIGHT - 3)),
                radius: Math.max(4, definition.blastRadius - Math.floor(index / 2)),
                damage: Math.max(7, definition.damage - index)
            }));
        }

        if (weaponType === 'crossfire') {
            return [{ x: impactX, y: impactY, radius: Math.max(6, definition.blastRadius), damage: definition.damage + 1 }];
        }

        if (weaponType === 'seeder' || weaponType === 'nuclear_seeder') {
            return [{ x: impactX, y: impactY, radius: Math.max(5, definition.blastRadius - 1), damage: definition.damage }];
        }

        if (weaponType === 'echo_shell' || weaponType === 'singularity_echo' || weaponType === 'orbital_lance' || weaponType === 'prism_lance' || weaponType === 'arc_mine' || weaponType === 'shrapnel_cone') {
            return [];
        }


        if (weaponType === 'flux_bomb') {
            return [
                { x: impactX, y: impactY, radius: Math.max(7, definition.blastRadius - 6), damage: definition.damage + 8 }
            ];
        }

        if (weaponType === 'eclipse_shell') {
            return [{ x: impactX, y: impactY, radius: Math.max(9, definition.blastRadius - 5), damage: Math.max(12, definition.damage - 8) }];
        }

        if (weaponType === 'fault_line') {
            const horizontalDir = Math.abs(impactDirX) < 0.18 ? 1 : Math.sign(impactDirX);
            return Array.from({ length: 6 }, (_, index) => {
                const x = Math.round(clamp(impactX + horizontalDir * index * 11, 2, LOGICAL_WIDTH - 3));
                const y = Math.round(clamp(this.terrain.getSurfaceY(x) - 1, 2, LOGICAL_HEIGHT - 3));
                return {
                    x,
                    y,
                    radius: Math.max(4, definition.blastRadius - Math.floor(index / 2)),
                    damage: Math.max(8, definition.damage - index)
                };
            });
        }

        if (weaponType === 'bunker_buster') {
            const directionLength = Math.hypot(impactDirX, impactDirY) || 1;
            const dirX = impactDirX / directionLength;
            const dirY = impactDirY / directionLength;
            return [
                { x: impactX, y: impactY, radius: Math.max(8, definition.blastRadius - 4), damage: definition.damage },
                {
                    x: Math.round(clamp(impactX + dirX * 9, 2, LOGICAL_WIDTH - 3)),
                    y: Math.round(clamp(impactY + dirY * 9, 2, LOGICAL_HEIGHT - 3)),
                    radius: Math.max(6, definition.blastRadius - 6),
                    damage: definition.damage + 10
                },
                {
                    x: Math.round(clamp(impactX + dirX * 16, 2, LOGICAL_WIDTH - 3)),
                    y: Math.round(clamp(impactY + dirY * 16, 2, LOGICAL_HEIGHT - 3)),
                    radius: Math.max(5, definition.blastRadius - 8),
                    damage: definition.damage + 4
                }
            ];
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

    private noise(seed: number) {
        const value = Math.sin(seed * 12.9898) * 43758.5453;
        return value - Math.floor(value);
    }

    private usesProgressiveBlastEffect(weaponType: WeaponType) {
        const style = getWeaponExplosionStyle(weaponType);
        return style === 'nuclear' || style === 'nova_blast' || style === 'solar' || style === 'void';
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














































