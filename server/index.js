import http from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT ?? 3000);
const SOCKET_PATH = process.env.SOCKET_PATH ?? '/socket.io';
const MAX_PLAYERS = 8;
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '..', 'dist');

const mimeByExtension = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.txt': 'text/plain; charset=utf-8'
};

/** @typedef {{ id: string, name: string, color: string, loadout: string, ready: boolean, isHost: boolean }} LobbyPlayer */
/** @typedef {{ code: string, hostSocketId: string, players: Map<string, LobbyPlayer>, socketToPlayer: Map<string, string> }} Room */

/** @type {Map<string, Room>} */
const rooms = new Map();

const requestHandler = (request, response) => {
    const requestUrl = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === '/') {
        pathname = '/index.html';
    }

    const normalized = path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
    const candidate = path.join(distDir, normalized);
    const safePath = candidate.startsWith(distDir) ? candidate : path.join(distDir, 'index.html');

    if (existsSync(safePath) && statSync(safePath).isFile()) {
        return streamFile(safePath, response);
    }

    return streamFile(path.join(distDir, 'index.html'), response);
};

const server = http.createServer(requestHandler);
const io = new Server(server, {
    path: SOCKET_PATH,
    cors: {
        origin: true,
        credentials: false
    }
});

io.on('connection', (socket) => {
    socket.on('host-game', ({ player }, acknowledge) => {
        try {
            const room = createRoom(socket.id, player);
            socket.join(room.code);
            socket.data.roomCode = room.code;
            socket.data.playerId = 'host';
            socket.data.role = 'host';
            acknowledge?.({ ok: true, roomCode: room.code, playerId: 'host' });
            broadcastLobbyState(room);
        } catch (error) {
            acknowledge?.({ ok: false, error: readErrorMessage(error) });
        }
    });

    socket.on('join-game', ({ roomCode, player }, acknowledge) => {
        const normalizedCode = String(roomCode ?? '').trim().toUpperCase();
        const room = rooms.get(normalizedCode);
        if (!room) {
            acknowledge?.({ ok: false, error: 'Room not found.' });
            return;
        }
        if (room.players.size >= MAX_PLAYERS) {
            acknowledge?.({ ok: false, error: 'Room is full.' });
            return;
        }

        const playerId = generatePlayerId(room);
        room.players.set(playerId, {
            id: playerId,
            name: sanitizeName(player?.name),
            color: sanitizeColor(player?.color),
            loadout: sanitizeLoadout(player?.loadout),
            ready: false,
            isHost: false
        });
        room.socketToPlayer.set(socket.id, playerId);
        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.playerId = playerId;
        socket.data.role = 'client';

        acknowledge?.({ ok: true, roomCode: room.code, playerId });
        broadcastLobbyState(room);
        io.to(room.hostSocketId).emit('status', { message: `${room.players.get(playerId)?.name ?? 'A pilot'} joined the lobby.` });
    });

    socket.on('update-player', ({ patch }) => {
        const membership = getMembership(socket.id);
        if (!membership) return;
        membership.player.name = sanitizeName(patch?.name);
        membership.player.color = sanitizeColor(patch?.color);
        membership.player.loadout = sanitizeLoadout(patch?.loadout);
        membership.player.ready = false;
        broadcastLobbyState(membership.room);
    });

    socket.on('set-ready', ({ ready }) => {
        const membership = getMembership(socket.id);
        if (!membership) return;
        membership.player.ready = Boolean(ready);
        broadcastLobbyState(membership.room);
    });

    socket.on('start-game', ({ payload }) => {
        const membership = getMembership(socket.id);
        if (!membership || !membership.player.isHost) return;
        io.to(membership.room.code).emit('game-start', { payload });
    });

    socket.on('game-message', ({ message }) => {
        const membership = getMembership(socket.id);
        if (!membership) return;
        if (membership.player.isHost) {
            socket.to(membership.room.code).emit('game-message', { message, senderId: 'host' });
            return;
        }
        io.to(membership.room.hostSocketId).emit('game-message', { message, senderId: membership.player.id });
    });

    socket.on('disconnect', () => {
        const roomCode = socket.data.roomCode;
        const playerId = socket.data.playerId;
        if (typeof roomCode !== 'string' || typeof playerId !== 'string') return;
        const room = rooms.get(roomCode);
        if (!room) return;

        room.socketToPlayer.delete(socket.id);
        room.players.delete(playerId);

        if (playerId === 'host') {
            socket.to(room.code).emit('room-closed', { message: 'The host left the room.' });
            rooms.delete(room.code);
            return;
        }

        broadcastLobbyState(room);
        io.to(room.hostSocketId).emit('status', { message: 'A pilot disconnected from the lobby.' });
    });
});

server.listen(PORT, () => {
    console.log(`FreeMortar server listening on ${PORT}`);
});

function streamFile(filePath, response) {
    const extension = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
        'Content-Type': mimeByExtension[extension] ?? 'application/octet-stream'
    });
    createReadStream(filePath).pipe(response);
}

function createRoom(hostSocketId, player) {
    const code = generateRoomCode();
    /** @type {Room} */
    const room = {
        code,
        hostSocketId,
        players: new Map([
            ['host', {
                id: 'host',
                name: sanitizeName(player?.name),
                color: sanitizeColor(player?.color),
                loadout: sanitizeLoadout(player?.loadout),
                ready: false,
                isHost: true
            }]
        ]),
        socketToPlayer: new Map([[hostSocketId, 'host']])
    };
    rooms.set(code, room);
    return room;
}

function getMembership(socketId) {
    for (const room of rooms.values()) {
        const playerId = room.socketToPlayer.get(socketId);
        if (!playerId) continue;
        const player = room.players.get(playerId);
        if (!player) return null;
        return { room, player };
    }
    return null;
}

function broadcastLobbyState(room) {
    io.to(room.code).emit('lobby-state', {
        roomCode: room.code,
        players: [...room.players.values()]
    });
}

function generateRoomCode() {
    let code = '';
    do {
        code = '';
        for (let index = 0; index < 4; index += 1) {
            code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
        }
    } while (rooms.has(code));
    return code;
}

function generatePlayerId(room) {
    let index = room.players.size;
    let candidate = `pilot-${index}`;
    while (room.players.has(candidate)) {
        index += 1;
        candidate = `pilot-${index}`;
    }
    return candidate;
}

function sanitizeName(value) {
    const text = String(value ?? '').trim();
    return text.slice(0, 16) || 'Pilot';
}

function sanitizeColor(value) {
    const text = String(value ?? '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text : '#fff4d7';
}

function sanitizeLoadout(value) {
    const text = String(value ?? '').trim();
    return text || 'balanced';
}

function readErrorMessage(error) {
    return error instanceof Error ? error.message : 'Unknown server error.';
}

