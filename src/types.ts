export type LoadoutId = 'balanced' | 'siege' | 'duelist';

export type WeaponType =
    | 'cannon'
    | 'mortar'
    | 'needle'
    | 'nova'
    | 'merv'
    | 'chaos'
    | 'chaos_mirv'
    | 'driller'
    | 'blast_bomb'
    | 'autocannon'
    | 'wall'
    | 'large_wall'
    | 'bunker_buster'
    | 'homing_missile'
    | 'bridge'
    | 'relocator'
    | 'leech'
    | 'blossom'
    | 'sinker'
    | 'crossfire'
    | 'large_cannon'
    | 'large_mortar'
    | 'large_needle'
    | 'large_nova'
    | 'large_merv'
    | 'large_chaos'
    | 'large_chaos_mirv'
    | 'large_driller'
    | 'large_blast_bomb'
    | 'large_autocannon'
    | 'shield_small'
    | 'shield_medium'
    | 'shield_large';

export type WindMode = 'variable' | 'constant' | 'disabled';

export type PowerRule = 'static' | 'health_linked';

export type RoundOrderMode = 'player_number' | 'random' | 'winning_order' | 'reverse_winning_order';

export type TerrainTheme = 'rolling' | 'flats' | 'hills' | 'mountains' | 'highlands' | 'divide';

export interface ScoringSettings {
    awardDamage: boolean;
    damagePointValue: number;
    awardKills: boolean;
    killPointValue: number;
    awardPlacement: boolean;
    firstPlacePoints: number;
    secondPlacePoints: number;
    thirdPlacePoints: number;
}

export interface MatchSettings {
    windMode: WindMode;
    maxWind: number;
    terrainThemes: TerrainTheme[];
    terrainCollapse: boolean;
    powerRule: PowerRule;
    rounds: number;
    scoring: ScoringSettings;
    weaponCostMultiplier: number;
    roundOrder: RoundOrderMode;
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
    shield?: number;
}

export interface PlayerSnapshot {
    id: string;
    x: number;
    y: number;
    health: number;
    shield: number;
    maxShield: number;
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
    shield: number;
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
        consumeAmmo?: boolean;
        chaosDepth?: number;
    }
    | {
        kind: 'SHOT_RESULT';
        impactX: number;
        impactY: number;
        impactDirX: number;
        impactDirY: number;
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
        shield: number;
    }
    | {
        kind: 'SHOP_SYNC';
        roundNumber: number;
        campaignComplete: boolean;
        players: ShopPlayerSnapshot[];
    };


