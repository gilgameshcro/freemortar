import { WEAPON_DEFINITIONS } from './config';
import type { WeaponType } from './types';

type AudioChannel = 'music' | 'sfx';

export class AudioManager {
    private context: AudioContext | null = null;
    private masterGain: GainNode | null = null;
    private musicGain: GainNode | null = null;
    private sfxGain: GainNode | null = null;
    private musicTimer: number | null = null;
    private isMuted = false;
    private musicMuted = false;
    private volume = 0.72;

    public async unlock() {
        if (this.isMuted) return;
        const context = this.getContext();
        if (context.state === 'suspended') {
            await context.resume();
        }
    }

    public setMuted(nextMuted: boolean) {
        this.isMuted = nextMuted;
        this.applyVolumes();
        if (nextMuted) {
            this.stopMusic();
        } else if (!this.musicMuted) {
            this.startMusic();
        }
    }

    public setMusicMuted(nextMuted: boolean) {
        this.musicMuted = nextMuted;
        this.applyVolumes();
        if (this.musicMuted) {
            this.stopMusic();
        } else if (!this.isMuted) {
            this.startMusic();
        }
    }

    public setVolume(nextVolume: number) {
        this.volume = Math.max(0, Math.min(1, nextVolume));
        this.applyVolumes();
    }

    public get muted() {
        return this.isMuted;
    }

    public get musicOnlyMuted() {
        return this.musicMuted;
    }

    public get currentVolume() {
        return this.volume;
    }

    public startMusic() {
        if (this.isMuted || this.musicMuted || this.musicTimer !== null) return;
        const pattern = [82.41, 98, 123.47, 110];
        this.scheduleMusicPattern(pattern);
        this.musicTimer = window.setInterval(() => {
            this.scheduleMusicPattern(pattern);
        }, 2600);
    }

    public stopMusic() {
        if (this.musicTimer !== null) {
            window.clearInterval(this.musicTimer);
            this.musicTimer = null;
        }
    }

    public playReady() {
        this.playTone(523.25, 0.07, 'square', 0.07, 0, 'sfx');
        this.playTone(659.25, 0.09, 'square', 0.055, 0.06, 'sfx');
    }

    public playAimTick() {
        this.playTone(320, 0.03, 'square', 0.026, 0, 'sfx');
    }

    public playFire(weaponType: WeaponType) {
        const weapon = WEAPON_DEFINITIONS[weaponType];
        const root = weaponType === 'nova' ? 92 : weaponType === 'needle' ? 176 : weaponType === 'chaos' ? 148 : 128;
        this.playTone(root, 0.08, 'sawtooth', 0.07, 0, 'sfx');
        this.playTone(root * 0.5, 0.14, 'square', 0.05, 0.02, 'sfx');
        if (weapon.blastRadius >= 14) {
            this.playNoise(0.08, 0.03, 900);
        }
    }

    public playExplosion(radius: number) {
        const noiseVolume = Math.min(0.16, 0.05 + radius * 0.003);
        this.playNoise(0.22, noiseVolume, 1300 - radius * 20);
        this.playTone(48 + radius * 1.6, 0.2, 'triangle', 0.08, 0, 'sfx');
    }

    public dispose() {
        this.stopMusic();
        if (this.context) {
            void this.context.close();
            this.context = null;
            this.masterGain = null;
            this.musicGain = null;
            this.sfxGain = null;
        }
    }

    private scheduleMusicPattern(pattern: number[]) {
        if (this.isMuted || this.musicMuted) return;
        pattern.forEach((frequency, index) => {
            this.playTone(frequency, 0.22, 'triangle', 0.028, index * 0.32, 'music');
            this.playTone(frequency * 2, 0.12, 'square', 0.014, index * 0.32 + 0.08, 'music');
        });
    }

    private playTone(
        frequency: number,
        duration: number,
        type: OscillatorType,
        volume: number,
        delay = 0,
        channel: AudioChannel = 'sfx'
    ) {
        if (this.isMuted) return;
        if (channel === 'music' && this.musicMuted) return;
        const context = this.getContext();
        const gain = context.createGain();
        const oscillator = context.createOscillator();
        const startAt = context.currentTime + delay;

        oscillator.type = type;
        oscillator.frequency.setValueAtTime(frequency, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(volume, startAt + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);

        oscillator.connect(gain);
        gain.connect(channel === 'music' ? this.musicBus() : this.sfxBus());
        oscillator.start(startAt);
        oscillator.stop(startAt + duration + 0.02);
    }

    private playNoise(duration: number, volume: number, filterFrequency: number) {
        if (this.isMuted) return;
        const context = this.getContext();
        const buffer = context.createBuffer(1, context.sampleRate * duration, context.sampleRate);
        const data = buffer.getChannelData(0);

        for (let index = 0; index < data.length; index += 1) {
            data[index] = Math.random() * 2 - 1;
        }

        const source = context.createBufferSource();
        const filter = context.createBiquadFilter();
        const gain = context.createGain();

        source.buffer = buffer;
        filter.type = 'lowpass';
        filter.frequency.value = Math.max(120, filterFrequency);

        gain.gain.setValueAtTime(volume, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + duration);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.sfxBus());
        source.start();
        source.stop(context.currentTime + duration);
    }

    private getContext(): AudioContext {
        if (!this.context) {
            this.context = new AudioContext();
        }
        return this.context;
    }

    private master(): GainNode {
        if (!this.masterGain) {
            const context = this.getContext();
            this.masterGain = context.createGain();
            this.masterGain.connect(context.destination);
        }
        return this.masterGain;
    }

    private musicBus(): GainNode {
        if (!this.musicGain) {
            const context = this.getContext();
            this.musicGain = context.createGain();
            this.musicGain.connect(this.master());
            this.applyVolumes();
        }
        return this.musicGain;
    }

    private sfxBus(): GainNode {
        if (!this.sfxGain) {
            const context = this.getContext();
            this.sfxGain = context.createGain();
            this.sfxGain.connect(this.master());
            this.applyVolumes();
        }
        return this.sfxGain;
    }

    private applyVolumes() {
        if (this.masterGain) {
            this.masterGain.gain.value = this.isMuted ? 0 : 0.9 * this.volume;
        }
        if (this.musicGain) {
            this.musicGain.gain.value = this.musicMuted ? 0 : 0.55;
        }
        if (this.sfxGain) {
            this.sfxGain.gain.value = 0.9;
        }
    }
}


