'use strict';

const context = require('../core/agent-context');
const logger = require('../core/logger');

class WorldScanner {

    constructor() {
        this.running = false;

        this.players = new Map();
        this.entities = new Map();
        this.blocks = new Map();

        this.events = [];
        this.chatHistory = [];

        this.scanInterval = 250;
        this.reportInterval = 2000;

        this.lastReport = 0;
        this.lastScan = 0;

        this.watchMode = 'normal';

        this.watchTarget = null;

        this.radius = 32;

        this.maxEvents = 5000;
        this.maxChat = 5000;

        this.previousSnapshot = null;
    }

    start() {
        if (this.running) {
            return;
        }

        this.running = true;

        this.attachEvents();

        logger.info(
            'World Scanner ishga tushdi.'
        );

        context.eventBus.emitSafe(
            'scanner:started',
            {}
        );
    }

    attachEvents() {

        context.eventBus.onSafe(
            'bedrock:packet',
            data => {
                this.handlePacket(data);
            }
        );

        context.eventBus.onSafe(
            'minecraft:chat',
            data => {
                this.handleChat(data);
            }
        );

        context.eventBus.onSafe(
            'minecraft:position',
            data => {
                this.scan();
            }
        );
    }

    handlePacket(data) {

        if (!data) {
            return;
        }

        const packet =
            data.packet ||
            data;

        const name =
            data.name ||
            packet.name ||
            packet.type ||
            '';

        const normalized =
            String(name)
                .toLowerCase();

        if (
            normalized.includes('player') ||
            normalized.includes('add_player')
        ) {

            this.processPlayerPacket(
                packet
            );
        }

        if (
            normalized.includes('remove') &&
            normalized.includes('player')
        ) {

            this.processPlayerRemove(
                packet
            );
        }

        if (
            normalized.includes('entity')
        ) {

            this.processEntityPacket(
                packet
            );
        }

        if (
            normalized.includes('block')
        ) {

            this.processBlockPacket(
                packet
            );
        }

        if (
            normalized.includes('chat') ||
            normalized.includes('text')
        ) {

            this.handleChat(
                packet
            );
        }

        this.recordEvent({
            type:
                'packet',

            packet:
                this.summarizePacket(
                    packet
                ),

            timestamp:
                Date.now()
        });
    }

    processPlayerPacket(packet) {

        const name =
            packet.username ||
            packet.name ||
            packet.playerName;

        const uuid =
            packet.uuid ||
            packet.xuid ||
            packet.runtime_id ||
            name;

        if (!name) {
            return;
        }

        const position =
            this.extractPosition(
                packet
            );

        const player = {

            id:
                String(uuid),

            name:
                String(name),

            position:
                position,

            yaw:
                this.number(
                    packet.yaw
                ),

            pitch:
                this.number(
                    packet.pitch
                ),

            health:
                packet.health !== undefined
                    ? this.number(
                        packet.health
                    )
                    : null,

            sneaking:
                Boolean(
                    packet.sneaking
                ),

            sprinting:
                Boolean(
                    packet.sprinting
                ),

            lastSeen:
                Date.now()
        };

        const previous =
            this.players.get(
                player.name
            );

        this.players.set(
            player.name,
            player
        );

        this.detectPlayerChange(
            previous,
            player
        );

        context.eventBus.emitSafe(
            'observer:player_update',
            player
        );
    }

    processPlayerRemove(packet) {

        const name =
            packet.username ||
            packet.name ||
            packet.playerName;

        if (!name) {
            return;
        }

        const existing =
            this.players.get(
                String(name)
            );

        if (existing) {

            this.players.delete(
                String(name)
            );

            this.recordEvent({

                type:
                    'player_left',

                player:
                    existing.name,

                position:
                    existing.position,

                timestamp:
                    Date.now()
            });

            context.eventBus.emitSafe(
                'observer:player_left',
                existing
            );
        }
    }

    processEntityPacket(packet) {

        const id =
            packet.runtime_id ||
            packet.entityId ||
            packet.id;

        if (
            id === undefined ||
            id === null
        ) {
            return;
        }

        const entity = {

            id:
                String(id),

            type:
                packet.entityType ||
                packet.type ||
                packet.identifier ||
                'unknown',

            name:
                packet.name ||
                null,

            position:
                this.extractPosition(
                    packet
                ),

            velocity:
                packet.velocity ||
                null,

            health:
                packet.health !== undefined
                    ? this.number(
                        packet.health
                    )
                    : null,

            lastSeen:
                Date.now()
        };

        const previous =
            this.entities.get(
                entity.id
            );

        this.entities.set(
            entity.id,
            entity
        );

        if (
            previous
        ) {

            this.detectEntityMovement(
                previous,
                entity
            );
        } else {

            this.recordEvent({

                type:
                    'entity_seen',

                entity:
                    this.safeEntity(
                        entity
                    ),

                timestamp:
                    Date.now()
            });
        }

        context.eventBus.emitSafe(
            'observer:entity_update',
            entity
        );
    }

    processBlockPacket(packet) {

        const position =
            this.extractPosition(
                packet
            );

        if (!position) {
            return;
        }

        const key =
            this.positionKey(
                position
            );

        const block = {

            position,

            block:
                packet.block ||
                packet.blockName ||
                packet.runtime_id ||
                packet.id ||
                'unknown',

            state:
                packet.state ||
                null,

            timestamp:
                Date.now()
        };

        const previous =
            this.blocks.get(
                key
            );

        this.blocks.set(
            key,
            block
        );

        if (
            previous &&
            previous.block !==
                block.block
        ) {

            this.recordEvent({

                type:
                    'block_changed',

                position,

                before:
                    previous.block,

                after:
                    block.block,

                timestamp:
                    Date.now()
            });

        } else if (
            !previous
        ) {

            this.recordEvent({

                type:
                    'block_seen',

                position,

                block:
                    block.block,

                timestamp:
                    Date.now()
            });
        }

        context.eventBus.emitSafe(
            'observer:block_update',
            block
        );
    }

    handleChat(data) {

        if (!data) {
            return;
        }

        const message =
            data.message ||
            data.text ||
            data.raw ||
            '';

        const sender =
            data.sender ||
            data.username ||
            data.name ||
            'Unknown';

        const chat = {

            sender:
                String(sender),

            message:
                String(message),

            timestamp:
                Date.now()
        };

        this.chatHistory.push(
            chat
        );

        if (
            this.chatHistory.length >
            this.maxChat
        ) {

            this.chatHistory.shift();
        }

        this.recordEvent({

            type:
                'chat',

            sender:
                chat.sender,

            message:
                chat.message,

            timestamp:
                chat.timestamp
        });

        context.eventBus.emitSafe(
            'observer:chat',
            chat
        );
    }

    detectPlayerChange(
        previous,
        current
    ) {

        if (!previous) {

            this.recordEvent({

                type:
                    'player_joined',

                player:
                    current.name,

                position:
                    current.position,

                timestamp:
                    Date.now()
            });

            return;
        }

        if (
            previous.position &&
            current.position
        ) {

            const distance =
                this.distance(
                    previous.position,
                    current.position
                );

            if (
                distance >
                0.5
            ) {

                this.recordEvent({

                    type:
                        'player_moved',

                    player:
                        current.name,

                    from:
                        previous.position,

                    to:
                        current.position,

                    distance,

                    timestamp:
                        Date.now()
                });
            }
        }

        if (
            previous.sprinting !==
            current.sprinting
        ) {

            this.recordEvent({

                type:
                    current.sprinting
                        ? 'player_started_sprinting'
                        : 'player_stopped_sprinting',

                player:
                    current.name,

                timestamp:
                    Date.now()
            });
        }

        if (
            previous.sneaking !==
            current.sneaking
        ) {

            this.recordEvent({

                type:
                    current.sneaking
                        ? 'player_started_sneaking'
                        : 'player_stopped_sneaking',

                player:
                    current.name,

                timestamp:
                    Date.now()
            });
        }
    }

    detectEntityMovement(
        previous,
        current
    ) {

        if (
            !previous.position ||
            !current.position
        ) {
            return;
        }

        const distance =
            this.distance(
                previous.position,
                current.position
            );

        if (
            distance >
            0.5
        ) {

            this.recordEvent({

                type:
                    'entity_moved',

                entity:
                    current.type,

                id:
                    current.id,

                from:
                    previous.position,

                to:
                    current.position,

                distance,

                timestamp:
                    Date.now()
            });
        }
    }

    scan() {

        if (!this.running) {
            return;
        }

        const now =
            Date.now();

        if (
            now -
            this.lastScan <
            this.scanInterval
        ) {
            return;
        }

        this.lastScan =
            now;

        const position =
            this.getBotPosition();

        const nearbyPlayers =
            this.getNearbyPlayers(
                position,
                this.radius
            );

        const nearbyEntities =
            this.getNearbyEntities(
                position,
                this.radius
            );

        const nearbyBlocks =
            this.getNearbyBlocks(
                position,
                this.radius
            );

        const snapshot = {

            timestamp:
                now,

            botPosition:
                position,

            players:
                nearbyPlayers,

            entities:
                nearbyEntities,

            blocks:
                nearbyBlocks,

            chat:
                this.chatHistory.slice(
                    -20
                )
        };

        const changes =
            this.compareSnapshot(
                this.previousSnapshot,
                snapshot
            );

        this.previousSnapshot =
            snapshot;

        if (
            changes.length
        ) {

            for (
                const change of changes
            ) {

                this.recordEvent(
                    change
                );
            }
        }

        if (
            now -
            this.lastReport >=
            this.reportInterval
        ) {

            this.lastReport =
                now;

            context.eventBus.emitSafe(
                'observer:report',
                this.createReport()
            );
        }

        context.eventBus.emitSafe(
            'observer:snapshot',
            snapshot
        );

        return snapshot;
    }

    compareSnapshot(
        previous,
        current
    ) {

        if (!previous) {
            return [];
        }

        const changes = [];

        const previousPlayers =
            new Map(
                previous.players.map(
                    p => [
                        p.name,
                        p
                    ]
                )
            );

        const currentPlayers =
            new Map(
                current.players.map(
                    p => [
                        p.name,
                        p
                    ]
                )
            );

        for (
            const player of current.players
        ) {

            if (
                !previousPlayers.has(
                    player.name
                )
            ) {

                changes.push({

                    type:
                        'nearby_player_entered',

                    player:
                        player.name,

                    position:
                        player.position,

                    timestamp:
                        Date.now()
                });
            }
        }

        for (
            const player of previous.players
        ) {

            if (
                !currentPlayers.has(
                    player.name
                )
            ) {

                changes.push({

                    type:
                        'nearby_player_left',

                    player:
                        player.name,

                    timestamp:
                        Date.now()
                });
            }
        }

        return changes;
    }

    createReport() {

        const position =
            this.getBotPosition();

        const players =
            this.getNearbyPlayers(
                position,
                this.radius
            );

        const entities =
            this.getNearbyEntities(
                position,
                this.radius
            );

        return {

            timestamp:
                Date.now(),

            mode:
                this.watchMode,

            position,

            players:
                players.map(
                    player => ({
                        name:
                            player.name,

                        position:
                            player.position,

                        distance:
                            this.distance(
                                position,
                                player.position
                            ),

                        sneaking:
                            player.sneaking,

                        sprinting:
                            player.sprinting
                    })
                ),

            entities:
                entities.map(
                    entity => ({
                        id:
                            entity.id,

                        type:
                            entity.type,

                        name:
                            entity.name,

                        position:
                            entity.position,

                        distance:
                            this.distance(
                                position,
                                entity.position
                            )
                    })
                ),

            recentChat:
                this.chatHistory.slice(
                    -10
                ),

            recentEvents:
                this.events.slice(
                    -20
                )
        };
    }

    getNearbyPlayers(
        position,
        radius = 32
    ) {

        return Array.from(
            this.players.values()
        )
            .filter(
                player =>
                    player.position &&
                    this.distance(
                        position,
                        player.position
                    ) <= radius
            )
            .sort(
                (a, b) =>
                    this.distance(
                        position,
                        a.position
                    ) -
                    this.distance(
                        position,
                        b.position
                    )
            );
    }

    getNearbyEntities(
        position,
        radius = 32
    ) {

        return Array.from(
            this.entities.values()
        )
            .filter(
                entity =>
                    entity.position &&
                    this.distance(
                        position,
                        entity.position
                    ) <= radius
            )
            .sort(
                (a, b) =>
                    this.distance(
                        position,
                        a.position
                    ) -
                    this.distance(
                        position,
                        b.position
                    )
            );
    }

    getNearbyBlocks(
        position,
        radius = 16
    ) {

        return Array.from(
            this.blocks.values()
        )
            .filter(
                block =>
                    block.position &&
                    this.distance(
                        position,
                        block.position
                    ) <= radius
            );
    }

    getPlayer(
        name
    ) {

        if (!name) {
            return null;
        }

        return (
            this.players.get(
                String(name)
            ) ||
            null
        );
    }

    getEntity(
        id
    ) {

        return (
            this.entities.get(
                String(id)
            ) ||
            null
        );
    }

    getPlayers() {

        return Array.from(
            this.players.values()
        );
    }

    getEntities() {

        return Array.from(
            this.entities.values()
        );
    }

    getChat(
        limit = 100
    ) {

        return this.chatHistory.slice(
            -Math.max(
                1,
                Number(limit) || 100
            )
        );
    }

    getEvents(
        limit = 100
    ) {

        return this.events.slice(
            -Math.max(
                1,
                Number(limit) || 100
            )
        );
    }

    watch(
        mode = 'normal',
        target = null
    ) {

        this.watchMode =
            String(mode)
                .toLowerCase();

        this.watchTarget =
            target
                ? String(target)
                : null;

        context.eventBus.emitSafe(
            'observer:watch_changed',
            {
                mode:
                    this.watchMode,

                target:
                    this.watchTarget
            }
        );

        return {

            success: true,

            mode:
                this.watchMode,

            target:
                this.watchTarget
        };
    }

    stopWatch() {

        this.watchMode =
            'normal';

        this.watchTarget =
            null;

        context.eventBus.emitSafe(
            'observer:watch_stopped',
            {}
        );

        return {
            success: true
        };
    }

    recordEvent(event) {

        if (!event) {
            return;
        }

        this.events.push(
            event
        );

        if (
            this.events.length >
            this.maxEvents
        ) {

            this.events.splice(
                0,
                this.events.length -
                this.maxEvents
            );
        }

        context.eventBus.emitSafe(
            'observer:event',
            event
        );
    }

    getBotPosition() {

        const adapter =
            context.get(
                'bedrock-adapter'
            );

        if (
            adapter &&
            typeof adapter.getPosition ===
                'function'
        ) {

            return adapter.getPosition();
        }

        return (
            context.state.position ||
            {
                x: 0,
                y: 0,
                z: 0
            }
        );
    }

    extractPosition(
        object
    ) {

        if (!object) {
            return null;
        }

        const position =
            object.position ||
            object.pos ||
            object.coordinates;

        if (
            position &&
            position.x !== undefined &&
            position.y !== undefined &&
            position.z !== undefined
        ) {

            return {

                x:
                    this.number(
                        position.x
                    ),

                y:
                    this.number(
                        position.y
                    ),

                z:
                    this.number(
                        position.z
                    )
            };
        }

        if (
            object.x !== undefined &&
            object.y !== undefined &&
            object.z !== undefined
        ) {

            return {

                x:
                    this.number(
                        object.x
                    ),

                y:
                    this.number(
                        object.y
                    ),

                z:
                    this.number(
                        object.z
                    )
            };
        }

        return null;
    }

    positionKey(
        position
    ) {

        return (
            `${Math.floor(position.x)}:` +
            `${Math.floor(position.y)}:` +
            `${Math.floor(position.z)}`
        );
    }

    distance(
        a,
        b
    ) {

        if (!a || !b) {
            return Infinity;
        }

        const dx =
            a.x - b.x;

        const dy =
            a.y - b.y;

        const dz =
            a.z - b.z;

        return Math.sqrt(
            dx * dx +
            dy * dy +
            dz * dz
        );
    }

    number(
        value
    ) {

        const number =
            Number(value);

        return Number.isFinite(
            number
        )
            ? number
            : 0;
    }

    safeEntity(
        entity
    ) {

        return {

            id:
                entity.id,

            type:
                entity.type,

            name:
                entity.name,

            position:
                entity.position,

            health:
                entity.health
        };
    }

    summarizePacket(
        packet
    ) {

        if (!packet) {
            return null;
        }

        const result = {};

        const allowed = [
            'name',
            'type',
            'username',
            'playerName',
            'entityId',
            'runtime_id',
            'x',
            'y',
            'z',
            'yaw',
            'pitch',
            'message',
            'text',
            'block',
            'blockName'
        ];

        for (
            const key of allowed
        ) {

            if (
                packet[key] !== undefined
            ) {

                result[key] =
                    packet[key];
            }
        }

        return result;
    }

    status() {

        return {

            running:
                this.running,

            watchMode:
                this.watchMode,

            watchTarget:
                this.watchTarget,

            radius:
                this.radius,

            players:
                this.players.size,

            entities:
                this.entities.size,

            blocks:
                this.blocks.size,

            events:
                this.events.length,

            chatMessages:
                this.chatHistory.length,

            lastScan:
                this.lastScan,

            lastReport:
                this.lastReport
        };
    }

    stop() {

        this.running = false;

        this.watchMode =
            'normal';

        this.watchTarget =
            null;

        context.eventBus.emitSafe(
            'scanner:stopped',
            {}
        );

        logger.info(
            'World Scanner to‘xtatildi.'
        );
    }
}

const scanner =
    new WorldScanner();

module.exports =
    scanner;

module.exports.WorldScanner =
    WorldScanner;
