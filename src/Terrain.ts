import { clamp, LOGICAL_HEIGHT, LOGICAL_WIDTH } from './config';

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

    constructor(width = LOGICAL_WIDTH, height = LOGICAL_HEIGHT, seed = 1) {
        this.width = width;
        this.height = height;
        this.randomState = seed >>> 0;
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

    public regenerate(seed: number) {
        this.randomState = seed >>> 0;
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
        const heights = new Int16Array(this.width);
        let current = this.height * 0.55;
        const phaseA = this.random() * Math.PI * 2;
        const phaseB = this.random() * Math.PI * 2;

        for (let x = 0; x < this.width; x += 1) {
            const horizon = this.height * 0.52;
            const macro = Math.sin((x / this.width) * Math.PI * 2.2 + phaseA) * 18;
            const ridge = Math.sin((x / this.width) * Math.PI * 6.1 + phaseB) * 7;
            current += (this.random() - 0.5) * 2.4;
            current = current * 0.7 + (horizon + macro + ridge) * 0.3;
            heights[x] = Math.round(clamp(current, this.height * 0.34, this.height - 22));
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
}
