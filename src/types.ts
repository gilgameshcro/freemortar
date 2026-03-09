export type LoadoutId = 'balanced' | 'siege' | 'duelist';

export type BotDifficulty = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type MirvSpreadMode = 'narrow' | 'normal' | 'wide';

export type WeaponType =
    | 'cannon'
    | 'mortar'
    | 'needle'
    | 'nova'
    | 'omega_blast'
    | 'merv'
    | 'merv_mk2'
    | 'chaos'
    | 'chaos_mirv'
    | 'driller'
    | 'blast_bomb'
    | 'autocannon'
    | 'wall'
    | 'large_wall'
    | 'bunker_buster'
    | 'homing_missile'
    | 'missile_mk2'
    | 'missile_mk3'
    | 'nuclear_missile_mk1'
    | 'nuclear_missile_mk2'
    | 'nuclear_missile_mk3'
    | 'bridge'
    | 'relocator'
    | 'leech'
    | 'blossom'
    | 'sinker'
    | 'crossfire'
    | 'roller'
    | 'flux_bomb'
    | 'command_mirv'
    | 'seeder'
    | 'nuclear_seeder'
    | 'echo_shell'
    | 'shrapnel_cone'
    | 'emp_bomb'
    | 'emp_missile'
    | 'emp_shell'
    | 'minigun'
    | 'phase_round'
    | 'gravity_well'
    | 'magnet_shell'
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
    | 'grapeshot'
    | 'orbital_lance'
    | 'aftershock'
    | 'bulwark_shell'
    | 'deadfall'
    | 'helix_shell'
    | 'arc_mine'
    | 'volt_net'
    | 'geyser'
    | 'fault_line'
    | 'supernova_mirv'
    | 'apocalypse_mirv'
    | 'solar_mirv'
    | 'void_bomb'
    | 'singularity_echo'
    | 'prism_lance'
    | 'chaos_crown'
    | 'eclipse_shell'
    | 'aurora_helix'
    | 'storm_net'
    | 'shield_small'
    | 'shield_medium'
    | 'shield_large';

export type WindMode = 'variable' | 'constant' | 'disabled';
export type PowerRule = 'static' | 'health_linked';
export type RoundOrderMode = 'player_number' | 'random' | 'winning_order' | 'reverse_winning_order';
export type TerrainTheme = 'rolling' | 'flats' | 'hills' | 'mountains' | 'highlands' | 'divide' | 'caldera' | 'spires' | 'badlands' | 'trench';

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
    shieldVisibility: boolean;
    debugUnlimitedArsenal: boolean;
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
    isBot?: boolean;
    botDifficulty?: BotDifficulty;
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
    mirvSpread?: MirvSpreadMode;
    isBot?: boolean;
    botDifficulty?: BotDifficulty;
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
    mirvSpread: MirvSpreadMode;
    selectedWeaponIndex: number;
    weapons: WeaponState[];
}

export interface PlayerStatsSnapshot {
    id: string;
    damage: number;
    hits: number;
    kills: number;
    shots: number;
    spent: number;
    damageTaken: number;
    score: number;
    roundWins: number;
    totalDamage: number;
    totalHits: number;
    totalKills: number;
    totalShots: number;
    totalSpent: number;
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
    isBot?: boolean;
    botDifficulty?: BotDifficulty;
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
        mirvSpread: MirvSpreadMode;
        weaponIndex: number;
        turnNumber: number;
    }
    | {
        kind: 'FIRE_REQUEST';
        playerId: string;
        angle: number;
        power: number;
        mirvSpread: MirvSpreadMode;
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
        mirvSpread?: MirvSpreadMode;
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
        stalemateCounter: number;
        roundEndReason?: 'normal' | 'stalemate';
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


