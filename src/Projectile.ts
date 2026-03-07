import { clamp, WEAPON_DEFINITIONS } from './config';
import { Tank } from './Tank';
import { Terrain } from './Terrain';
import type { WeaponType } from './types';

export interface ProjectileImpact {
    x: number;
    y: number;
}

const BASE_SPEED = 0.35;
const POWER_SPEED_FACTOR = 6.9;

function isMirvType(type: WeaponType) {
    return type === 'merv' || type === 'chaos_mirv' || type === 'large_merv' || type === 'large_chaos_mirv';
}

function isHomingType(type: WeaponType) {
    return type === 'homing_missile';
}

function isBunkerType(type: WeaponType) {
    return type === 'bunker_buster';
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
    private bunkerInsideTerrain = false;

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
        chaosDepth = 0
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
            || isMirvType(weaponType)
            || weaponType === 'chaos'
            || weaponType === 'large_chaos'
            || weaponType === 'blast_bomb'
            || weaponType === 'large_blast_bomb'
            || weaponType === 'homing_missile'
            ? 2
            : 1;
        this.splitArmed = splitArmed;
        this.launchPower = launchPower;
        this.chaosDepth = chaosDepth;
        this.history.push({ x, y });
    }

    public step(terrain: Terrain, players: Tank[], gravity: number, wind: number): ProjectileImpact | null {
        this.trail.push({ x: this.x, y: this.y });
        if (this.trail.length > 18) {
            this.trail.shift();
        }

        if (isHomingType(this.weaponType)) {
            this.applyHoming(players);
        }

        this.vx += wind * 0.0022;
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

        const descending = this.vy > -0.04;
        const lookAheadX = clamp(Math.round(this.x + this.vx * 4), 0, terrain.width - 1);
        for (let offset = 10; offset <= 38; offset += 2) {
            if (terrain.isSolid(lookAheadX, Math.round(this.y + offset))) {
                return true;
            }
        }

        return descending;
    }

    public split(): Projectile[] {
        if (!isMirvType(this.weaponType) || !this.splitArmed) {
            return [];
        }

        const spreadAngles = [-0.26, 0, 0.26];
        return spreadAngles.map((offset, index) => {
            const cos = Math.cos(offset);
            const sin = Math.sin(offset);
            const vx = this.vx * cos - this.vy * sin + (index - 1) * 0.18;
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
                this.chaosDepth
            );
        });
    }

    public createChaosFollowup(x: number, y: number, angle: number) {
        const followType: WeaponType = this.weaponType === 'large_chaos' || this.weaponType === 'large_chaos_mirv'
            ? 'large_chaos'
            : 'chaos';
        return new Projectile(
            x,
            y,
            angle,
            this.launchPower,
            this.ownerId,
            followType,
            undefined,
            false,
            this.launchPower,
            this.chaosDepth + 1
        );
    }

    public draw(ctx: CanvasRenderingContext2D) {
        for (let index = 0; index < this.trail.length; index += 1) {
            const point = this.trail[index];
            const alpha = (index + 1) / this.trail.length;
            ctx.save();
            ctx.globalAlpha = alpha * 0.65;
            ctx.fillStyle = this.trailColor;
            ctx.fillRect(Math.round(point.x), Math.round(point.y), 1, 1);
            ctx.restore();
        }

        ctx.fillStyle = this.color;
        ctx.fillRect(Math.round(this.x), Math.round(this.y), this.radius + 1, this.radius + 1);
    }

    private applyHoming(players: Tank[]) {
        if (!isHomingType(this.weaponType) || this.history.length < 18) return;
        const target = players
            .filter((tank) => tank.alive && tank.id !== this.ownerId)
            .map((tank) => ({
                tank,
                distance: Math.hypot(tank.x - this.x, tank.y - tank.bodyHeight / 2 - this.y)
            }))
            .filter((entry) => entry.distance < 150)
            .sort((left, right) => left.distance - right.distance)[0]?.tank;
        if (!target) return;

        const speed = Math.max(0.001, Math.hypot(this.vx, this.vy));
        const currentAngle = Math.atan2(this.vy, this.vx);
        const targetAngle = Math.atan2(target.y - target.bodyHeight / 2 - this.y, target.x - this.x);
        let delta = targetAngle - currentAngle;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        const turnRate = 0.045;
        const nextAngle = currentAngle + clamp(delta, -turnRate, turnRate);
        this.vx = Math.cos(nextAngle) * speed;
        this.vy = Math.sin(nextAngle) * speed;
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


