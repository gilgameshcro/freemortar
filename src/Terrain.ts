import { clamp, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './config';
import type { TerrainTheme } from './types';

export class Terrain {
    public readonly width: number;
    public readonly height: number;

    private readonly cells: Uint8Array;
    private readonly cellColors: Uint32Array;
    private readonly surface: Int16Array;
    private readonly canvas: HTMLCanvasElement;
    private readonly ctx: CanvasRenderingContext2D;
    private dirty = true;
    private randomState: number;
    private collapsePending = false;
    private theme: TerrainTheme;

    constructor(width = LOGICAL_WIDTH, height = LOGICAL_HEIGHT, seed = 1, theme: TerrainTheme = 'rolling') {
        this.width = width;
        this.height = height;
        this.randomState = seed >>> 0;
        this.theme = theme;
        this.cells = new Uint8Array(width * height);
        this.cellColors = new Uint32Array(width * height);
        this.surface = new Int16Array(width);
        this.canvas = document.createElement('canvas');
        this.canvas.width = width;
        this.canvas.height = height;

        const context = this.canvas.getContext('2d');
        if (!context) {
            throw new Error('Unable to create terrain buffer');
        }
        this.ctx = context;
        this.generate();
    }

    public regenerate(seed: number, theme = this.theme) {
        this.randomState = seed >>> 0;
        this.theme = theme;
        this.generate();
    }

    public generate() {
        this.cells.fill(0);
        this.cellColors.fill(0);
        const heights = this.generateHeights();
        for (let x = 0; x < this.width; x += 1) {
            const surfaceY = heights[x];
            this.surface[x] = surfaceY;
            for (let y = surfaceY; y < this.height; y += 1) {
                this.cells[this.index(x, y)] = 1;
            }
        }
        this.collapsePending = false;
        this.dirty = true;
        this.render();
    }

    public draw(ctx: CanvasRenderingContext2D) {
        if (this.dirty) {
            this.render();
        }
        ctx.drawImage(this.canvas, 0, 0);
    }

    public isSolid(x: number, y: number): boolean {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) return false;
        return this.cells[this.index(x, y)] === 1;
    }

    public getSurfaceY(x: number): number {
        const sampleX = clamp(Math.round(x), 0, this.width - 1);
        return this.surface[sampleX];
    }

    public flattenPlatform(centerX: number, halfWidth: number) {
        const left = clamp(Math.round(centerX - halfWidth), 0, this.width - 1);
        const right = clamp(Math.round(centerX + halfWidth), 0, this.width - 1);
        let targetY = this.getSurfaceY(centerX);

        for (let x = left; x <= right; x += 1) {
            targetY = Math.min(targetY, this.getSurfaceY(x));
        }

        for (let x = left; x <= right; x += 1) {
            for (let y = 0; y < this.height; y += 1) {
                const index = this.index(x, y);
                this.cells[index] = y >= targetY ? 1 : 0;
                this.cellColors[index] = 0;
            }
            this.surface[x] = targetY;
        }

        this.collapsePending = false;
        this.dirty = true;
    }

    public carveCircle(centerX: number, centerY: number, radius: number) {
        const left = clamp(Math.floor(centerX - radius), 0, this.width - 1);
        const right = clamp(Math.ceil(centerX + radius), 0, this.width - 1);
        const top = clamp(Math.floor(centerY - radius), 0, this.height - 1);
        const bottom = clamp(Math.ceil(centerY + radius), 0, this.height - 1);
        const radiusSquared = radius * radius;

        for (let y = top; y <= bottom; y += 1) {
            for (let x = left; x <= right; x += 1) {
                const dx = x - centerX;
                const dy = y - centerY;
                if (dx * dx + dy * dy <= radiusSquared) {
                    const index = this.index(x, y);
                    this.cells[index] = 0;
                    this.cellColors[index] = 0;
                }
            }
        }

        this.refreshSurface(left, right);
        this.collapsePending = true;
        this.dirty = true;
    }

    public depositPixel(x: number, y: number, color: string) {
        const pixelX = clamp(Math.round(x), 0, this.width - 1);
        const pixelY = clamp(Math.round(y), 0, this.height - 1);
        const index = this.index(pixelX, pixelY);
        this.cells[index] = 1;
        this.cellColors[index] = this.packColor(color);
        this.surface[pixelX] = Math.min(this.surface[pixelX], pixelY);
        this.dirty = true;
    }

    public raiseWall(centerX: number, baseY: number, halfWidth: number, height: number, color: string) {
        const left = clamp(Math.round(centerX - halfWidth), 0, this.width - 1);
        const right = clamp(Math.round(centerX + halfWidth), 0, this.width - 1);
        const bottom = clamp(Math.round(baseY), 0, this.height - 1);
        const top = clamp(Math.round(baseY - height), 0, this.height - 1);

        for (let x = left; x <= right; x += 1) {
            for (let y = top; y <= bottom; y += 1) {
                const inset = Math.abs(x - centerX) > Math.max(0, halfWidth - 1) ? 1 : 0;
                const finalY = clamp(y + inset, 0, this.height - 1);
                const index = this.index(x, finalY);
                this.cells[index] = 1;
                this.cellColors[index] = this.packColor(color);
            }
        }

        this.refreshSurface(left, right);
        this.collapsePending = true;
        this.dirty = true;
    }

    public raiseBridge(centerX: number, centerY: number, halfWidth: number, thickness: number, color: string) {
        const left = clamp(Math.round(centerX - halfWidth), 0, this.width - 1);
        const right = clamp(Math.round(centerX + halfWidth), 0, this.width - 1);
        const top = clamp(Math.round(centerY - thickness / 2), 0, this.height - 1);
        const bottom = clamp(Math.round(centerY + thickness / 2), 0, this.height - 1);

        for (let x = left; x <= right; x += 1) {
            const taper = Math.round(Math.abs(x - centerX) / Math.max(1, halfWidth) * 2);
            for (let y = top + taper; y <= bottom; y += 1) {
                const index = this.index(x, y);
                this.cells[index] = 1;
                this.cellColors[index] = this.packColor(color);
            }
        }

        this.refreshSurface(left, right);
        this.collapsePending = true;
        this.dirty = true;
    }

    public stepCollapse(maxMoves = 1800) {
        if (!this.collapsePending) return false;

        let moved = false;
        let moves = 0;

        for (let y = this.height - 2; y >= 0; y -= 1) {
            for (let x = 0; x < this.width; x += 1) {
                const currentIndex = this.index(x, y);
                const belowIndex = this.index(x, y + 1);
                if (this.cells[currentIndex] === 1 && this.cells[belowIndex] === 0) {
                    this.cells[currentIndex] = 0;
                    this.cells[belowIndex] = 1;
                    this.cellColors[belowIndex] = this.cellColors[currentIndex];
                    this.cellColors[currentIndex] = 0;
                    moved = true;
                    moves += 1;
                    if (moves >= maxMoves) {
                        break;
                    }
                }
            }
            if (moves >= maxMoves) {
                break;
            }
        }

        if (moved) {
            this.refreshSurface(0, this.width - 1);
            this.dirty = true;
            return true;
        }

        this.collapsePending = false;
        return false;
    }

    public get collapseActive() {
        return this.collapsePending;
    }

    private generateHeights(): Int16Array {
        switch (this.theme) {
            case 'flats':
                return this.generateFlatHeights();
            case 'hills':
                return this.generateHillHeights();
            case 'mountains':
                return this.generateMountainHeights();
            case 'highlands':
                return this.generateHighlandHeights();
            case 'divide':
                return this.generateDivideHeights();
            default:
                return this.generateRollingHeights();
        }
    }

    private generateRollingHeights() {
        const heights = new Int16Array(this.width);
        let current = this.height * 0.55;
        const phaseA = this.random() * Math.PI * 2;
        const phaseB = this.random() * Math.PI * 2;

        for (let x = 0; x < this.width; x += 1) {
            const t = x / Math.max(1, this.width - 1);
            const target = this.height * 0.54
                + Math.sin(t * Math.PI * 2.2 + phaseA) * 18
                + Math.sin(t * Math.PI * 6.1 + phaseB) * 7;
            current += (this.random() - 0.5) * 2.4;
            current = current * 0.7 + target * 0.3;
            heights[x] = Math.round(clamp(current, this.height * 0.34, this.height - 22));
        }

        return heights;
    }

    private generateFlatHeights() {
        const heights = new Int16Array(this.width);
        let current = this.height * 0.72;
        const phaseA = this.random() * Math.PI * 2;
        const phaseB = this.random() * Math.PI * 2;

        for (let x = 0; x < this.width; x += 1) {
            const t = x / Math.max(1, this.width - 1);
            const target = this.height * 0.72
                + Math.sin(t * Math.PI * 2.6 + phaseA) * 4
                + Math.sin(t * Math.PI * 8.5 + phaseB) * 2;
            current = current * 0.82 + target * 0.18 + (this.random() - 0.5) * 0.8;
            heights[x] = Math.round(clamp(current, this.height * 0.62, this.height - 16));
        }

        return heights;
    }

    private generateHillHeights() {
        const heights = new Int16Array(this.width);
        let current = this.height * 0.61;
        const phaseA = this.random() * Math.PI * 2;
        const phaseB = this.random() * Math.PI * 2;
        const phaseC = this.random() * Math.PI * 2;

        for (let x = 0; x < this.width; x += 1) {
            const t = x / Math.max(1, this.width - 1);
            const target = this.height * 0.63
                + Math.sin(t * Math.PI * 1.5 + phaseA) * 18
                + Math.sin(t * Math.PI * 4.2 + phaseB) * 12
                + Math.sin(t * Math.PI * 10.8 + phaseC) * 4;
            current = current * 0.72 + target * 0.28 + (this.random() - 0.5) * 1.7;
            heights[x] = Math.round(clamp(current, this.height * 0.34, this.height - 18));
        }

        return heights;
    }

    private generateMountainHeights() {
        const heights = new Int16Array(this.width);
        let current = this.height * 0.62;
        const phaseA = this.random() * Math.PI * 2;
        const phaseB = this.random() * Math.PI * 2;
        const phaseC = this.random() * Math.PI * 2;

        for (let x = 0; x < this.width; x += 1) {
            const t = x / Math.max(1, this.width - 1);
            const ridgeMask = Math.pow(Math.abs(Math.sin(t * Math.PI * 1.7 + phaseC)), 0.72);
            const ravineMask = Math.pow(Math.abs(Math.sin(t * Math.PI * 4.8 + phaseB)), 2.1);
            const target = this.height * 0.67
                + Math.sin(t * Math.PI * 1.05 + phaseA) * 22
                + Math.sin(t * Math.PI * 6.1 + phaseB) * 15
                - ridgeMask * 64
                + ravineMask * 26;
            current = current * 0.66 + target * 0.34 + (this.random() - 0.5) * 2.8;
            heights[x] = Math.round(clamp(current, this.height * 0.1, this.height - 14));
        }

        return heights;
    }

    private generateHighlandHeights() {
        const heights = new Int16Array(this.width);
        let current = this.height * 0.72;
        const plateauCenter = 0.28 + this.random() * 0.44;
        const plateauWidth = 0.22 + this.random() * 0.12;
        const plateauStart = plateauCenter - plateauWidth * 0.5;
        const plateauEnd = plateauCenter + plateauWidth * 0.5;
        const fade = 0.05 + this.random() * 0.02;
        const phaseA = this.random() * Math.PI * 2;

        for (let x = 0; x < this.width; x += 1) {
            const t = x / Math.max(1, this.width - 1);
            const plateauMask = this.smoothstep(plateauStart - fade, plateauStart + fade, t)
                * (1 - this.smoothstep(plateauEnd - fade, plateauEnd + fade, t));
            const lowland = this.height * 0.79 + Math.sin(t * Math.PI * 2.2 + phaseA) * 3;
            const plateau = this.height * 0.24 + Math.sin(t * Math.PI * 10.5 + phaseA) * 1.2;
            const target = this.lerp(lowland, plateau, plateauMask);
            current = current * 0.82 + target * 0.18 + (this.random() - 0.5) * 0.8;
            heights[x] = Math.round(clamp(current, this.height * 0.12, this.height - 10));
        }

        return heights;
    }

    private generateDivideHeights() {
        const heights = new Int16Array(this.width);
        const highOnLeft = this.random() > 0.5;
        let current = this.height * 0.62;
        const phaseA = this.random() * Math.PI * 2;

        for (let x = 0; x < this.width; x += 1) {
            const t = x / Math.max(1, this.width - 1);
            const slope = this.smoothstep(0.38, 0.62, t);
            const step = highOnLeft ? this.lerp(-54, 26, slope) : this.lerp(26, -54, slope);
            const target = this.height * 0.71
                + step
                + Math.sin(t * Math.PI * 2.2 + phaseA) * 4;
            current = current * 0.8 + target * 0.2 + (this.random() - 0.5) * 0.9;
            heights[x] = Math.round(clamp(current, this.height * 0.14, this.height - 10));
        }

        return heights;
    }

    private refreshSurface(left: number, right: number) {
        for (let x = left; x <= right; x += 1) {
            this.surface[x] = this.findSurface(x);
        }
    }

    private findSurface(x: number) {
        for (let y = 0; y < this.height; y += 1) {
            if (this.cells[this.index(x, y)] === 1) {
                return y;
            }
        }
        return this.height;
    }

    private render() {
        const image = this.ctx.createImageData(this.width, this.height);
        const data = image.data;

        for (let y = 0; y < this.height; y += 1) {
            for (let x = 0; x < this.width; x += 1) {
                const offset = (y * this.width + x) * 4;
                const index = this.index(x, y);
                if (this.cells[index] !== 1) {
                    data[offset + 3] = 0;
                    continue;
                }

                const packedColor = this.cellColors[index];
                if (packedColor !== 0) {
                    data[offset] = (packedColor >> 16) & 255;
                    data[offset + 1] = (packedColor >> 8) & 255;
                    data[offset + 2] = packedColor & 255;
                    data[offset + 3] = 255;
                    continue;
                }

                const depth = y - this.surface[x];
                const hash = this.hash(x, y);
                let r = 0;
                let g = 0;
                let b = 0;

                if (!this.isSolid(x, y - 1)) {
                    r = 154 + (hash % 18);
                    g = 196 + (hash % 28);
                    b = 77 + (hash % 12);
                } else if (depth < 8) {
                    r = 118 + (hash % 16);
                    g = 84 + (hash % 12);
                    b = 48 + (hash % 10);
                } else {
                    r = 86 + (hash % 14);
                    g = 58 + (hash % 10);
                    b = 36 + (hash % 8);
                }

                data[offset] = r;
                data[offset + 1] = g;
                data[offset + 2] = b;
                data[offset + 3] = 255;
            }
        }

        this.ctx.putImageData(image, 0, 0);
        this.dirty = false;
    }

    private packColor(hex: string) {
        return parseInt(hex.replace('#', ''), 16) & 0xffffff;
    }

    private index(x: number, y: number) {
        return y * this.width + x;
    }

    private random() {
        this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
        return this.randomState / 0xffffffff;
    }

    private hash(x: number, y: number) {
        let value = x * 374761393 + y * 668265263;
        value = (value ^ (value >> 13)) * 1274126177;
        return (value ^ (value >> 16)) & 255;
    }

    private smoothstep(edge0: number, edge1: number, value: number) {
        const t = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
        return t * t * (3 - 2 * t);
    }

    private lerp(a: number, b: number, t: number) {
        return a + (b - a) * t;
    }
}


