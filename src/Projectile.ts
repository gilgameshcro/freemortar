import { clamp, WEAPON_DEFINITIONS } from './config';
import { Tank } from './Tank';
import { Terrain } from './Terrain';
import type { MirvSpreadMode, WeaponType } from './types';

export interface ProjectileImpact {
    x: number;
    y: number;
}

const BASE_SPEED = 0.35;
const POWER_SPEED_FACTOR = 6.9;

function isMirvType(type: WeaponType) {
    return type === 'merv' || type === 'merv_mk2' || type === 'chaos_mirv' || type === 'large_merv' || type === 'large_chaos_mirv' || type === 'command_mirv' || type === 'supernova_mirv' || type === 'apocalypse_mirv' || type === 'solar_mirv';
}

function isHomingType(type: WeaponType) {
    return type === 'homing_missile'
        || type === 'missile_mk2'
        || type === 'missile_mk3'
        || type === 'nuclear_missile_mk1'
        || type === 'nuclear_missile_mk2'
        || type === 'nuclear_missile_mk3'
        || type === 'emp_missile';
}

function getHomingProfile(type: WeaponType) {
    switch (type) {
        case 'missile_mk2':
        case 'nuclear_missile_mk2':
        case 'emp_missile':
            return { fuel: 36, lockFrames: 0, range: 120, turnRate: 0.02, triggerRadius: 35 };
        case 'missile_mk3':
        case 'nuclear_missile_mk3':
            return { fuel: 52, lockFrames: 0, range: 120, turnRate: 0.028, triggerRadius: 35 };
        default:
            return { fuel: 24, lockFrames: 0, range: 120, turnRate: 0.012, triggerRadius: 35 };
    }
}

function isBunkerType(type: WeaponType) {
    return type === 'bunker_buster';
}

function isPhaseType(type: WeaponType) {
    return type === 'phase_round';
}

function isRollerType(type: WeaponType) {
    return type === 'roller';
}

export class Projectile {
    public x: number;
    public y: number;
    public vx: number;
    public vy: number;
    public bounceCount = 0;
    public readonly trail: Array<{ x: number; y: number }> = [];
    public readonly history: Array<{ x: number; y: number }> = [];
    public readonly color: string;
    public readonly trailColor: string;
    public readonly radius: number;
    public readonly splitArmed: boolean;
    public readonly launchPower: number;
    public readonly chaosDepth: number;
    private readonly maxBounces = 7;
    private readonly mirvSpread: MirvSpreadMode;
    private seederDropsRemaining = 0;
    private seederDropTimerMs = 500;
    private pendingSeederDrops = 0;
    private rollerSoundSteps = 0;
    private homingFuel = 24;
    private readonly directFireCandidate = false;
    private bunkerInsideTerrain = false;
    private phasePassedFirstLayer = false;
    private phaseInsideFirstLayer = false;
    private rolling = false;
    private rollDirection = 1;
    private rollDistance = 0;

    constructor(
        x: number,
        y: number,
        angle: number,
        power: number,
        public readonly ownerId: string,
        public readonly weaponType: WeaponType,
        initialVelocity?: { vx: number; vy: number },
        splitArmed = isMirvType(weaponType),
        launchPower = power,
        chaosDepth = 0,
        options?: { mirvSpread?: MirvSpreadMode; allowSeederDrops?: boolean }
    ) {
        const definition = WEAPON_DEFINITIONS[weaponType];
        const speed = (BASE_SPEED + (power / 160) * POWER_SPEED_FACTOR) * definition.speedMultiplier;

        this.x = x;
        this.y = y;
        this.vx = initialVelocity?.vx ?? Math.cos(angle) * speed;
        this.vy = initialVelocity?.vy ?? Math.sin(angle) * speed;
        this.color = definition.projectileColor;
        this.trailColor = definition.trailColor;
        this.radius = weaponType === 'nova'
            || weaponType === 'large_nova'
            || weaponType === 'omega_blast'
            || isMirvType(weaponType)
            || weaponType === 'chaos'
            || weaponType === 'large_chaos'
            || weaponType === 'blast_bomb'
            || weaponType === 'large_blast_bomb'
            || isHomingType(weaponType)
            || weaponType === 'gravity_well'
            ? 2
            : 1;
        this.splitArmed = splitArmed;
        this.launchPower = launchPower;
        this.chaosDepth = chaosDepth;
        this.mirvSpread = options?.mirvSpread ?? 'normal';
        this.seederDropsRemaining = (weaponType === 'seeder' || weaponType === 'nuclear_seeder') && options?.allowSeederDrops !== false ? 5 : 0;
        this.history.push({ x, y });
    }

    public step(terrain: Terrain, players: Tank[], gravity: number, wind: number): ProjectileImpact | null {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 18) {
            this.trail.shift();
        }

        if ((this.weaponType === 'seeder' || this.weaponType === 'nuclear_seeder') && this.seederDropsRemaining > 0) {
            this.seederDropTimerMs -= 1000 / 60;
            while (this.seederDropTimerMs <= 0 && this.seederDropsRemaining > 0) {
                this.pendingSeederDrops += 1;
                this.seederDropsRemaining -= 1;
                this.seederDropTimerMs += 500;
            }
        }

        if (this.rolling) {
            return this.stepRolling(terrain, players);
        }

        if (isHomingType(this.weaponType)) {
            this.applyHoming(players);
        }

        this.vx += wind * 0.006;
        this.vy += gravity;

        const deltaX = this.vx;
        const deltaY = this.vy;
        const steps = Math.max(1, Math.ceil(Math.max(Math.abs(deltaX), Math.abs(deltaY), 1)));
        const stepX = deltaX / steps;
        const stepY = deltaY / steps;

        for (let step = 0; step < steps; step += 1) {
            this.x += stepX;
            this.y += stepY;
            this.history.push({ x: this.x, y: this.y });

            if (isBunkerType(this.weaponType) && this.bunkerInsideTerrain) {
                const bunkerImpact = this.stepBunker(terrain);
                if (bunkerImpact) return bunkerImpact;
                continue;
            }

            if (this.handleWallBounce(terrain)) {
                const speed = Math.abs(this.vx) + Math.abs(this.vy);
                if (this.bounceCount > this.maxBounces || speed < 0.8) {
                    return {
                        x: clamp(Math.round(this.x), 0, terrain.width - 1),
                        y: clamp(Math.round(this.y), 0, terrain.height - 1)
                    };
                }
                return null;
            }

            if (this.y > terrain.height + 8) {
                return { x: clamp(this.x, 0, terrain.width - 1), y: terrain.height - 1 };
            }

            const sampleX = clamp(Math.round(this.x), 0, terrain.width - 1);
            const sampleY = clamp(Math.round(this.y), 0, terrain.height - 1);
            const inTerrain = terrain.isSolid(sampleX, sampleY);

            const tankImpact = this.sampleTankImpact(players);
            if (tankImpact) {
                return tankImpact;
            }

            if (isBunkerType(this.weaponType) && inTerrain) {
                this.bunkerInsideTerrain = true;
                continue;
            }

            if (isPhaseType(this.weaponType)) {
                if (inTerrain) {
                    if (!this.phasePassedFirstLayer) {
                        this.phaseInsideFirstLayer = true;
                        continue;
                    }
                    return { x: sampleX, y: sampleY };
                }

                if (this.phaseInsideFirstLayer && !this.phasePassedFirstLayer) {
                    this.phaseInsideFirstLayer = false;
                    this.phasePassedFirstLayer = true;
                }
            }

            if (isRollerType(this.weaponType) && inTerrain) {
                this.rolling = true;
                this.rollDirection = this.vx >= 0 ? 1 : -1;
                this.vx = this.rollDirection * 1.1;
                this.vy = 0;
                this.y = terrain.getSurfaceY(sampleX) - 1;
                return null;
            }

            if (inTerrain) {
                return { x: sampleX, y: sampleY };
            }
        }

        return null;
    }

    public shouldSplit(terrain: Terrain): boolean {
        if (!isMirvType(this.weaponType) || !this.splitArmed || this.history.length < 14) {
            return false;
        }

        const descending = this.vy >= 0.03;
        const touchingBounds = this.x <= 2 || this.x >= terrain.width - 3 || this.y <= 2;
        return descending || touchingBounds;
    }

    public split(): Projectile[] {
        if (!isMirvType(this.weaponType) || !this.splitArmed) {
            return [];
        }

        let spreadAngles: number[];
        if (this.weaponType === 'command_mirv') {
            const dynamicSpread = this.mirvSpread === 'narrow'
                ? 0.07 + (this.launchPower / 160) * 0.12
                : this.mirvSpread === 'wide'
                    ? 0.2 + (this.launchPower / 160) * 0.28
                    : 0.12 + (this.launchPower / 160) * 0.22;
            spreadAngles = [-dynamicSpread, 0, dynamicSpread];
        } else if (this.weaponType === 'merv_mk2' || this.weaponType === 'apocalypse_mirv') {
            const dynamicSpread = this.weaponType === 'apocalypse_mirv' ? 0.16 + (this.launchPower / 160) * 0.12 : 0.13 + (this.launchPower / 160) * 0.1;
            spreadAngles = [-dynamicSpread * 2, -dynamicSpread, 0, dynamicSpread, dynamicSpread * 2];
        } else {
            const dynamicSpread = this.weaponType === 'supernova_mirv' ? 0.22 : this.weaponType === 'solar_mirv' ? 0.3 : 0.26;
            spreadAngles = [-dynamicSpread, 0, dynamicSpread];
        }

        const centerIndex = (spreadAngles.length - 1) / 2;
        return spreadAngles.map((offset, index) => {
            const cos = Math.cos(offset);
            const sin = Math.sin(offset);
            const lateralIndex = index - centerIndex;
            const lateralKick = this.weaponType === 'command_mirv'
                ? lateralIndex * (0.08 + this.launchPower / 480)
                : this.weaponType === 'merv_mk2' || this.weaponType === 'apocalypse_mirv'
                    ? lateralIndex * 0.14
                    : this.weaponType === 'solar_mirv'
                        ? lateralIndex * 0.2
                        : lateralIndex * 0.18;
            const vx = this.vx * cos - this.vy * sin + lateralKick;
            const vy = this.vx * sin + this.vy * cos - 0.1 - Math.abs(offset) * 0.05;
            return new Projectile(
                this.x,
                this.y,
                0,
                0,
                this.ownerId,
                this.weaponType,
                { vx, vy },
                false,
                this.launchPower,
                this.chaosDepth,
                { mirvSpread: this.mirvSpread, allowSeederDrops: false }
            );
        });
    }

    public createChaosFollowup(x: number, y: number, angle: number) {
        const followType: WeaponType = this.weaponType === 'large_chaos' || this.weaponType === 'large_chaos_mirv'
            ? 'large_chaos'
            : 'chaos';
        const reducedPower = Math.max(8, this.launchPower * (2 / 3));
        return new Projectile(
            x,
            y,
            angle,
            reducedPower,
            this.ownerId,
            followType,
            undefined,
            false,
            reducedPower,
            this.chaosDepth + 1,
            { mirvSpread: this.mirvSpread, allowSeederDrops: false }
        );
    }

    public consumeSeederDrops() {
        const drops: Projectile[] = [];
        while (this.pendingSeederDrops > 0) {
            this.pendingSeederDrops -= 1;
            const dropVx = this.vx * 0.18;
            const dropVy = Math.max(0.45, this.vy * 0.22 + 0.62);
            drops.push(new Projectile(
                this.x,
                this.y,
                Math.PI / 2,
                Math.max(12, this.launchPower * 0.35),
                this.ownerId,
                this.weaponType,
                { vx: dropVx, vy: dropVy },
                false,
                Math.max(12, this.launchPower * 0.35),
                this.chaosDepth,
                { mirvSpread: this.mirvSpread, allowSeederDrops: false }
            ));
        }
        return drops;
    }

    public consumeRollingSound() {
        if (!this.rolling) return false;
        if (this.rollerSoundSteps >= 6) {
            this.rollerSoundSteps = 0;
            return true;
        }
        return false;
    }

    public draw(ctx: CanvasRenderingContext2D) {
        for (let index = 0; index < this.trail.length; index += 1) {
            const point = this.trail[index];
            const alpha = (index + 1) / this.trail.length;
            ctx.save();
            ctx.globalAlpha = alpha * 0.65;
            ctx.fillStyle = this.trailColor;
            if (this.weaponType === 'roller') {
                ctx.fillRect(Math.round(point.x), Math.round(point.y), 2, 1);
            } else if (this.weaponType === 'phase_round') {
                ctx.fillStyle = index % 2 === 0 ? '#b8ffd0' : '#f4fff7';
                ctx.fillRect(Math.round(point.x), Math.round(point.y) - 1, 2, 3);
                ctx.fillStyle = this.trailColor;
                ctx.fillRect(Math.round(point.x) - 1, Math.round(point.y), 1, 1);
            } else if (this.weaponType === 'gravity_well' || this.weaponType === 'magnet_shell') {
                ctx.fillRect(Math.round(point.x), Math.round(point.y), 1, 2);
            } else {
                ctx.fillRect(Math.round(point.x), Math.round(point.y), 1, 1);
            }
            ctx.restore();
        }

        ctx.fillStyle = this.color;
        const drawX = Math.round(this.x);
        const drawY = Math.round(this.y);
        if (this.weaponType === 'roller') {
            ctx.fillRect(drawX - 1, drawY, 3, 2);
        } else if (this.weaponType === 'phase_round') {
            ctx.fillStyle = '#ecfff5';
            ctx.fillRect(drawX, drawY - 1, 2, this.radius + 2);
            ctx.fillStyle = '#8bffc0';
            ctx.fillRect(drawX, drawY, 1, this.radius + 1);
        } else {
            ctx.fillRect(drawX, drawY, this.radius + 1, this.radius + 1);
        }
    }

    private applyHoming(players: Tank[]) {
        if (!isHomingType(this.weaponType) || this.homingFuel <= 0) return;
        const profile = getHomingProfile(this.weaponType);
        if (this.history.length < profile.lockFrames) return;

        const candidates = players
            .filter((tank) => tank.alive && tank.id !== this.ownerId)
            .map((tank) => ({
                tank,
                distance: Math.hypot(tank.x - this.x, tank.y - tank.bodyHeight / 2 - this.y)
            }))
            .sort((left, right) => left.distance - right.distance);
        const closest = candidates[0];
        if (!closest) return;

        const descendingReady = this.vy >= 0.02;
        const bounceReady = this.bounceCount > 0;
        const closeDirectReady = this.directFireCandidate && closest.distance <= profile.triggerRadius;
        const triggerReady = bounceReady || descendingReady || closeDirectReady;
        if (!triggerReady) return;
        if (closest.distance > profile.range) return;

        const target = closest.tank;
        const speed = Math.max(0.001, Math.hypot(this.vx, this.vy));
        const currentAngle = Math.atan2(this.vy, this.vx);
        const targetAngle = Math.atan2(target.y - target.bodyHeight / 2 - this.y, target.x - this.x);
        let delta = targetAngle - currentAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const nextAngle = currentAngle + clamp(delta, -profile.turnRate, profile.turnRate);
        this.vx = Math.cos(nextAngle) * speed;
        this.vy = Math.sin(nextAngle) * speed;
        this.homingFuel -= 1;
    }

    private stepRolling(terrain: Terrain, players: Tank[]): ProjectileImpact | null {
        const nextX = clamp(this.x + this.rollDirection * 1.1, 1, terrain.width - 2);
        const currentSurface = terrain.getSurfaceY(this.x);
        const nextSurface = terrain.getSurfaceY(nextX);
        const surfaceDelta = nextSurface - currentSurface;
        this.rollDistance += Math.abs(nextX - this.x);
        this.x = nextX;
        this.y = nextSurface - 1;
        this.history.push({ x: this.x, y: this.y });
        this.rollerSoundSteps += 1;

        const tankImpact = this.sampleTankImpact(players);
        if (tankImpact) return tankImpact;

        if (this.rollDistance > 120 || Math.abs(surfaceDelta) > 5 || this.x <= 2 || this.x >= terrain.width - 3) {
            return { x: Math.round(this.x), y: Math.round(this.y) };
        }

        return null;
    }

    private sampleTankImpact(players: Tank[]): ProjectileImpact | null {
        for (const tank of players) {
            if (!tank.alive) continue;
            if (
                this.x >= tank.x - tank.bodyWidth / 2 &&
                this.x <= tank.x + tank.bodyWidth / 2 &&
                this.y >= tank.y - tank.bodyHeight &&
                this.y <= tank.y
            ) {
                return { x: Math.round(this.x), y: Math.round(this.y) };
            }
        }
        return null;
    }

    private stepBunker(terrain: Terrain): ProjectileImpact | null {
        const sampleX = clamp(Math.round(this.x), 0, terrain.width - 1);
        const sampleY = clamp(Math.round(this.y), 0, terrain.height - 1);
        if (this.x <= 1 || this.x >= terrain.width - 2 || this.y <= 1 || this.y >= terrain.height - 1) {
            return { x: sampleX, y: sampleY };
        }
        if (!terrain.isSolid(sampleX, sampleY)) {
            return { x: sampleX, y: sampleY };
        }
        return null;
    }

    private handleWallBounce(terrain: Terrain) {
        let bounced = false;

        if (this.x <= 1) {
            this.x = 1;
            this.vx = Math.abs(this.vx) * 0.84;
            bounced = true;
        } else if (this.x >= terrain.width - 2) {
            this.x = terrain.width - 2;
            this.vx = -Math.abs(this.vx) * 0.84;
            bounced = true;
        }

        if (this.y <= 1) {
            this.y = 1;
            this.vy = Math.abs(this.vy) * 0.84;
            bounced = true;
        }

        if (bounced) {
            this.bounceCount += 1;
            this.history.push({ x: this.x, y: this.y });
        }

        return bounced;
    }
}







