export type LoadoutId = 'balanced' | 'siege' | 'duelist';

export type WeaponType = 'cannon' | 'mortar' | 'needle' | 'nova' | 'merv' | 'chaos';

export type WindMode = 'variable' | 'constant' | 'disabled';

export type PowerRule = 'static' | 'health_linked';

export type ScoringMode = 'damage_and_kills' | 'damage_only' | 'kills_only';

export interface MatchSettings {
    windMode: WindMode;
    maxWind: number;
    terrainCollapse: boolean;
    powerRule: PowerRule;
    rounds: number;
    scoringMode: ScoringMode;
}

export interface LobbyPlayer {
    id: string;
    name: string;
    color: string;
    loadout: LoadoutId;
    ready: boolean;
    isHost: boolean;
}

export interface WeaponState {
    type: WeaponType;
    ammo: number;
}

export interface PlayerSetup {
    id: string;
    name: string;
    color: string;
    loadout: LoadoutId;
    weapons?: WeaponState[];
}

export interface PlayerSnapshot {
    id: string;
    x: number;
    y: number;
    health: number;
    angle: number;
    power: number;
    selectedWeaponIndex: number;
    weapons: WeaponState[];
}

export interface PlayerStatsSnapshot {
    id: string;
    damage: number;
    hits: number;
    kills: number;
    shots: number;
    damageTaken: number;
    score: number;
    roundWins: number;
    totalDamage: number;
    totalHits: number;
    totalKills: number;
    totalShots: number;
    totalDamageTaken: number;
}

export interface DamageEvent {
    attackerId: string;
    targetId: string;
    amount: number;
    x: number;
    y: number;
    killed: boolean;
}

export interface MatchStartPayload {
    seed: number;
    players: PlayerSetup[];
    currentPlayerIndex: number;
    wind: number;
    turnNumber: number;
    roundNumber: number;
    settings: MatchSettings;
    campaignStats: PlayerStatsSnapshot[];
}

export interface ShopPlayerSnapshot {
    id: string;
    credits: number;
    shopReady: boolean;
    weapons: WeaponState[];
    stats: PlayerStatsSnapshot;
}

export type GameMessage =
    | {
        kind: 'AIM_STATE';
        playerId: string;
        angle: number;
        power: number;
        weaponIndex: number;
        turnNumber: number;
    }
    | {
        kind: 'FIRE_REQUEST';
        playerId: string;
        angle: number;
        power: number;
        weaponIndex: number;
        turnNumber: number;
    }
    | {
        kind: 'SHOT_FIRED';
        playerId: string;
        angle: number;
        power: number;
        weaponIndex: number;
        weaponType: WeaponType;
        startX: number;
        startY: number;
        turnNumber: number;
    }
    | {
        kind: 'SHOT_RESULT';
        impactX: number;
        impactY: number;
        weaponType: WeaponType;
        damageEvents: DamageEvent[];
        playerStates: PlayerSnapshot[];
        stats: PlayerStatsSnapshot[];
        turnNumber: number;
    }
    | {
        kind: 'TURN_STATE';
        currentPlayerIndex: number;
        wind: number;
        turnNumber: number;
        winnerId: string | null;
        playerStates: PlayerSnapshot[];
        stats: PlayerStatsSnapshot[];
        roundNumber: number;
        seed: number;
        campaignComplete: boolean;
    }
    | {
        kind: 'SHOP_UPDATE';
        playerId: string;
        credits: number;
        shopReady: boolean;
        weapons: WeaponState[];
    }
    | {
        kind: 'SHOP_SYNC';
        roundNumber: number;
        campaignComplete: boolean;
        players: ShopPlayerSnapshot[];
    };
