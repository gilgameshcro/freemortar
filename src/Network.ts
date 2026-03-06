import { io, type Socket } from 'socket.io-client';
import type { GameMessage, LobbyPlayer, MatchStartPayload } from './types';

type EditableLobbyFields = Pick<LobbyPlayer, 'name' | 'color' | 'loadout'>;

type LobbyStatePayload = {
    roomCode: string;
    players: LobbyPlayer[];
};

type StatusPayload = {
    message: string;
};

type GameMessagePayload = {
    message: GameMessage;
    senderId: string;
};

type AckSuccess = {
    ok: true;
    roomCode: string;
    playerId: string;
};

type AckFailure = {
    ok: false;
    error: string;
};

type AckResponse = AckSuccess | AckFailure;

export type NetworkRole = 'host' | 'client' | 'offline';

const REQUEST_TIMEOUT_MS = 12000;

export class Network {
    private socket: Socket | null = null;

    public role: NetworkRole = 'offline';
    public myId = '';
    public roomCode = '';

    public onLobbyState: ((players: LobbyPlayer[], roomCode: string) => void) | null = null;
    public onGameStart: ((payload: MatchStartPayload) => void) | null = null;
    public onGameMessage: ((message: GameMessage, senderId: string) => void) | null = null;
    public onStatus: ((message: string) => void) | null = null;

    public async hostGame(player: EditableLobbyFields): Promise<string> {
        this.destroy();
        this.role = 'host';
        await this.connectSocket();
        const response = await this.emitWithAck('host-game', { player });
        this.myId = response.playerId;
        this.roomCode = response.roomCode;
        this.emitStatus(`Room ${this.roomCode} is online.`);
        return this.roomCode;
    }

    public async joinGame(roomCode: string, player: EditableLobbyFields): Promise<void> {
        this.destroy();
        this.role = 'client';
        const normalizedRoomCode = roomCode.trim().toUpperCase();
        await this.connectSocket();
        const response = await this.emitWithAck('join-game', { roomCode: normalizedRoomCode, player });
        this.myId = response.playerId;
        this.roomCode = response.roomCode;
        this.emitStatus(`Connected to room ${this.roomCode}.`);
    }

    public updateLocalPlayer(patch: EditableLobbyFields) {
        this.socket?.emit('update-player', { patch });
    }

    public setReady(ready: boolean) {
        this.socket?.emit('set-ready', { ready });
    }

    public broadcastStart(payload: MatchStartPayload) {
        if (this.role !== 'host') return;
        this.socket?.emit('start-game', { payload });
    }

    public sendGameMessage(message: GameMessage) {
        this.socket?.emit('game-message', { message });
    }

    public destroy() {
        const socket = this.socket;
        this.socket = null;
        if (socket) {
            socket.removeAllListeners();
            socket.disconnect();
        }
        this.role = 'offline';
        this.myId = '';
        this.roomCode = '';
    }

    private async connectSocket() {
        if (this.socket?.connected) {
            return this.socket;
        }

        const socket = io(buildServerUrl(), {
            path: buildSocketPath(),
            autoConnect: false,
            transports: ['websocket', 'polling']
        });
        this.attachSocketListeners(socket);
        this.socket = socket;

        await new Promise<void>((resolve, reject) => {
            let settled = false;
            const timerId = window.setTimeout(() => {
                finalize(() => reject(new Error('Timed out connecting to the game server.')));
            }, REQUEST_TIMEOUT_MS);

            const finalize = (callback: () => void) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timerId);
                socket.off('connect', handleConnect);
                socket.off('connect_error', handleError);
                callback();
            };

            const handleConnect = () => finalize(resolve);
            const handleError = (error: Error) => {
                finalize(() => reject(new Error(readErrorMessage(error))));
            };

            socket.once('connect', handleConnect);
            socket.once('connect_error', handleError);
            socket.connect();
        });

        return socket;
    }

    private attachSocketListeners(socket: Socket) {
        socket.on('lobby-state', (payload: LobbyStatePayload) => {
            this.roomCode = payload.roomCode;
            this.onLobbyState?.(payload.players, payload.roomCode);
        });

        socket.on('game-start', ({ payload }: { payload: MatchStartPayload }) => {
            this.onGameStart?.(payload);
        });

        socket.on('game-message', (payload: GameMessagePayload) => {
            this.onGameMessage?.(payload.message, payload.senderId);
        });

        socket.on('status', ({ message }: StatusPayload) => {
            this.emitStatus(message);
        });

        socket.on('room-closed', ({ message }: StatusPayload) => {
            this.emitStatus(message);
            this.destroy();
        });

        socket.on('disconnect', (reason) => {
            if (!this.socket) return;
            this.emitStatus(`Disconnected from server: ${reason}.`);
        });
    }

    private emitWithAck(eventName: string, payload: unknown) {
        const socket = this.socket;
        if (!socket) {
            return Promise.reject(new Error('Socket is not connected.'));
        }

        return new Promise<AckSuccess>((resolve, reject) => {
            let settled = false;
            const timerId = window.setTimeout(() => {
                finalize(() => reject(new Error('The server did not respond in time.')));
            }, REQUEST_TIMEOUT_MS);

            const finalize = (callback: () => void) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timerId);
                callback();
            };

            socket.emit(eventName, payload, (response: AckResponse) => {
                if (!response) {
                    finalize(() => reject(new Error('Empty server response.')));
                    return;
                }
                if (!response.ok) {
                    finalize(() => reject(new Error(response.error)));
                    return;
                }
                finalize(() => resolve(response));
            });
        });
    }

    private emitStatus(message: string) {
        this.onStatus?.(message);
    }
}

function buildServerUrl() {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
    const configured = env.VITE_SOCKET_SERVER_URL?.trim();
    if (configured) {
        return configured;
    }
    return window.location.origin;
}

function buildSocketPath() {
    const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
    return env.VITE_SOCKET_PATH?.trim() || '/socket.io';
}

function readErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    return 'Unknown connection failure.';
}

