'use strict';

const context = require('../core/agent-context');
const logger = require('../core/logger');

class EventObserver {

    constructor() {

        this.running = false;

        this.listeners = [];

        this.statistics = {
            chats: 0,
            joins: 0,
            leaves: 0,
            movements: 0,
            entities: 0,
            blocks: 0,
            inventories: 0,
            events: 0
        };

        this.lastEvents = [];

        this.maxEvents = 2000;
    }

    start() {

        if (this.running) {
            return;
        }

        this.running = true;

        this.listen(
            'minecraft:chat',
            data =>
                this.handleChat(data)
        );

        this.listen(
            'minecraft:player_join',
            data =>
                this.handlePlayerJoin(data)
        );

        this.listen(
            'minecraft:player_leave',
            data =>
                this.handlePlayerLeave(data)
        );

        this.listen(
            'minecraft:move_player',
            data =>
                this.handlePlayerMove(data)
        );

        this.listen(
            'minecraft:entity_spawn',
            data =>
                this.handleEntitySpawn(data)
        );

        this.listen(
            'minecraft:entity_remove',
            data =>
                this.handleEntityRemove(data)
        );

        this.listen(
            'minecraft:block_update',
            data =>
                this.handleBlockUpdate(data)
        );

        this.listen(
            'minecraft:inventory',
            data =>
                this.handleInventory(data)
        );

        this.listen(
            'minecraft:start_game',
            data =>
                this.handleStartGame(data)
        );

        this.listen(
            'minecraft:spawn',
            data =>
                this.handleSpawn(data)
        );

        this.listen(
            'minecraft:connected',
            data =>
                this.handleConnected(data)
        );

        this.listen(
            'minecraft:disconnected',
            data =>
                this.handleDisconnected(data)
        );

        logger.info(
            'Event Observer ishga tushdi.'
        );
    }

    listen(
        event,
        handler
    ) {

        const listener =
            context.eventBus.onSafe(
                event,
                handler
            );

        this.listeners.push(
            listener
        );
    }

    /* ========================================================
       CHAT
    ======================================================== */

    async handleChat(data) {

        this.statistics.chats++;
        this.statistics.events++;

        const sender =
            data?.sender ||
            data?.source_name ||
            'Unknown';

        const message =
            data?.message ||
            '';

        const event = {

            type: 'chat',

            sender,

            message,

            timestamp:
                Date.now()
        };

        this.record(event);

        /*
        Chatni doimiy xotiraga yozamiz.
        */

        const memory =
            context.get(
                'memory'
            );

        if (memory) {

            try {

                memory.saveChat(
                    sender,
                    message,
                    'minecraft'
                );

            } catch (error) {

                logger.error(
                    'Chat memory xatosi.',
                    {
                        error:
                            error.message
                    }
                );
            }
        }

        /*
        Boshqa modullarga yuborish.
        */

        context.eventBus.emitSafe(
            'observation:chat',
            event
        );
    }

    /* ========================================================
       PLAYER JOIN
    ======================================================== */

    handlePlayerJoin(data) {

        this.statistics.joins++;
        this.statistics.events++;

        const player =
            this.extractPlayer(
                data
            );

        const event = {

            type:
                'player_join',

            player,

            timestamp:
                Date.now()
        };

        this.record(event);

        const memory =
            context.get(
                'memory'
            );

        if (
            memory &&
            player.name
        ) {

            memory.savePlayer(
                player.name,
                player
            );

            memory.saveObservation(
                'player_join',
                event,
                {
                    subject:
                        player.name
                }
            );
        }

        context.eventBus.emitSafe(
            'observation:player_join',
            event
        );

        logger.info(
            `Player kirdi: ${player.name}`
        );
    }

    /* ========================================================
       PLAYER LEAVE
    ======================================================== */

    handlePlayerLeave(data) {

        this.statistics.leaves++;
        this.statistics.events++;

        const player =
            this.extractPlayer(
                data
            );

        const event = {

            type:
                'player_leave',

            player,

            timestamp:
                Date.now()
        };

        this.record(event);

        const memory =
            context.get(
                'memory'
            );

        if (
            memory &&
            player.name
        ) {

            memory.saveObservation(
                'player_leave',
                event,
                {
                    subject:
                        player.name
                }
            );
        }

        context.eventBus.emitSafe(
            'observation:player_leave',
            event
        );

        logger.info(
            `Player chiqdi: ${player.name}`
        );
    }

    /* ========================================================
       PLAYER MOVEMENT
    ======================================================== */

    handlePlayerMove(data) {

        this.statistics.movements++;
        this.statistics.events++;

        const player =
            this.extractPlayer(
                data
            );

        const position =
            this.extractPosition(
                data
            );

        const event = {

            type:
                'player_move',

            player,

            position,

            timestamp:
                Date.now()
        };

        /*
        Har bir movementni xotiraga yozib,
        bazani keraksiz darajada kattalashtirmaymiz.

        Muhim movementlar alohida event sifatida
        saqlanadi.
        */

        if (
            this.isImportantMovement(
                data
            )
        ) {

            this.record(event);

            const memory =
                context.get(
                    'memory'
                );

            if (memory) {

                memory.saveObservation(
                    'player_move',
                    event,
                    {
                        subject:
                            player.name,

                        position
                    }
                );
            }
        }

        context.eventBus.emitSafe(
            'observation:player_move',
            event
        );
    }

    isImportantMovement(data) {

        if (
            data?.important === true
        ) {
            return true;
        }

        if (
            data?.significant === true
        ) {
            return true;
        }

        return false;
    }

    /* ========================================================
       ENTITY SPAWN
    ======================================================== */

    handleEntitySpawn(data) {

        this.statistics.entities++;
        this.statistics.events++;

        const entity =
            this.extractEntity(
                data
            );

        const event = {

            type:
                'entity_spawn',

            entity,

            timestamp:
                Date.now()
        };

        this.record(event);

        const memory =
            context.get(
                'memory'
            );

        if (memory) {

            memory.saveObservation(
                'entity_spawn',
                event,
                {
                    subject:
                        entity.type ||
                        entity.name,

                    position:
                        entity.position
                }
            );
        }

        context.eventBus.emitSafe(
            'observation:entity_spawn',
            event
        );
    }

    /* ========================================================
       ENTITY REMOVE
    ======================================================== */

    handleEntityRemove(data) {

        this.statistics.events++;

        const entity =
            this.extractEntity(
                data
            );

        const event = {

            type:
                'entity_remove',

            entity,

            timestamp:
                Date.now()
        };

        this.record(event);

        const memory =
            context.get(
                'memory'
            );

        if (memory) {

            memory.saveObservation(
                'entity_remove',
                event,
                {
                    subject:
                        entity.type ||
                        entity.name,

                    position:
                        entity.position
                }
            );
        }

        context.eventBus.emitSafe(
            'observation:entity_remove',
            event
        );
    }

    /* ========================================================
       BLOCK UPDATE
    ======================================================== */

    handleBlockUpdate(data) {

        this.statistics.blocks++;
        this.statistics.events++;

        const position =
            this.extractPosition(
                data
            );

        const event = {

            type:
                'block_update',

            position,

            block:
                data?.block ||
                data?.name ||
                data?.runtime_id ||
                null,

            timestamp:
                Date.now()
        };

        this.record(event);

        const memory =
            context.get(
                'memory'
            );

        if (memory) {

            memory.saveObservation(
                'block_update',
                event,
                {
                    position
                }
            );
        }

        context.eventBus.emitSafe(
            'observation:block_update',
            event
        );
    }

    /* ========================================================
       INVENTORY
    ======================================================== */

    handleInventory(data) {

        this.statistics.inventories++;
        this.statistics.events++;

        const event = {

            type:
                'inventory',

            data,

            timestamp:
                Date.now()
        };

        /*
        Inventar eventlarini historyga yozamiz,
        lekin juda katta packetlarni cheklaymiz.
        */

        this.record(
            this.limitEventSize(
                event
            )
        );

        context.eventBus.emitSafe(
            'observation:inventory',
            event
        );
    }

    /* ========================================================
       START GAME
    ======================================================== */

    handleStartGame(data) {

        this.statistics.events++;

        const event = {

            type:
                'start_game',

            data:
                this.limitEventSize(
                    data
                ),

            timestamp:
                Date.now()
        };

        this.record(event);

        context.eventBus.emitSafe(
            'observation:start_game',
            event
        );
    }

    /* ========================================================
       BOT SPAWN
    ======================================================== */

    handleSpawn(data) {

        this.statistics.events++;

        const event = {

            type:
                'bot_spawn',

            data,

            timestamp:
                Date.now()
        };

        this.record(event);

        context.eventBus.emitSafe(
            'observation:bot_spawn',
            event
        );
    }

    /* ========================================================
       CONNECT
    ======================================================== */

    handleConnected(data) {

        this.statistics.events++;

        const event = {

            type:
                'connected',

            data,

            timestamp:
                Date.now()
        };

        this.record(event);

        context.eventBus.emitSafe(
            'observation:connected',
            event
        );
    }

    /* ========================================================
       DISCONNECT
    ======================================================== */

    handleDisconnected(data) {

        this.statistics.events++;

        const event = {

            type:
                'disconnected',

            data,

            timestamp:
                Date.now()
        };

        this.record(event);

        context.eventBus.emitSafe(
            'observation:disconnected',
            event
        );
    }

    /* ========================================================
       PLAYER EXTRACTION
    ======================================================== */

    extractPlayer(data) {

        const source =
            data?.player ||
            data?.playerData ||
            data ||
            {};

        return {

            name:
                source.name ||
                source.username ||
                source.playerName ||
                source.source_name ||
                'Unknown',

            uuid:
                source.uuid ||
                source.uuidString ||
                source.xuid ||
                null,

            runtimeId:
                source.runtime_id ||
                source.runtimeId ||
                null,

            position:
                this.extractPosition(
                    source
                ),

            dimension:
                source.dimension ||
                context.state.dimension ||
                null
        };
    }

    /* ========================================================
       ENTITY EXTRACTION
    ======================================================== */

    extractEntity(data) {

        const source =
            data?.entity ||
            data ||
            {};

        return {

            id:
                source.runtime_id ||
                source.runtimeId ||
                source.unique_id ||
                source.uniqueId ||
                null,

            type:
                source.type ||
                source.identifier ||
                source.entity_type ||
                source.entityType ||
                null,

            name:
                source.name ||
                source.displayName ||
                null,

            position:
                this.extractPosition(
                    source
                ),

            health:
                source.health ??
                null
        };
    }

    /* ========================================================
       POSITION
    ======================================================== */

    extractPosition(data) {

        const position =
            data?.position ||
            data?.pos ||
            data?.coordinates ||
            data ||
            {};

        return {

            x:
                this.numberOrNull(
                    position.x
                ),

            y:
                this.numberOrNull(
                    position.y
                ),

            z:
                this.numberOrNull(
                    position.z
                ),

            dimension:
                position.dimension ||
                data?.dimension ||
                context.state.dimension ||
                null
        };
    }

    numberOrNull(value) {

        const number =
            Number(value);

        return Number.isFinite(number)
            ? number
            : null;
    }

    /* ========================================================
       EVENT HISTORY
    ======================================================== */

    record(event) {

        this.lastEvents.push(
            event
        );

        if (
            this.lastEvents.length >
            this.maxEvents
        ) {

            this.lastEvents.splice(
                0,
                this.lastEvents.length -
                    this.maxEvents
            );
        }

        context.state.statistics.events++;
    }

    getRecentEvents(
        limit = 100
    ) {

        return this.lastEvents.slice(
            -Math.max(
                1,
                Number(limit) || 100
            )
        );
    }

    /* ========================================================
       SEARCH
    ======================================================== */

    findPlayer(
        name
    ) {

        const target =
            String(
                name || ''
            ).toLowerCase();

        return this.lastEvents
            .filter(
                event =>
                    event.player?.name
                        ?.toLowerCase() ===
                    target
            )
            .pop() || null;
    }

    findEvents(
        type,
        limit = 100
    ) {

        return this.lastEvents
            .filter(
                event =>
                    event.type === type
            )
            .slice(
                -Math.max(
                    1,
                    Number(limit) || 100
                )
            );
    }

    /* ========================================================
       LIMIT EVENT SIZE
    ======================================================== */

    limitEventSize(
        value
    ) {

        try {

            const json =
                JSON.stringify(
                    value
                );

            if (
                json.length <= 50000
            ) {

                return value;
            }

            return {

                truncated: true,

                preview:
                    json.slice(
                        0,
                        50000
                    )
            };

        } catch (_) {

            return {
                error:
                    'Event serialize qilib bo‘lmadi.'
            };
        }
    }

    /* ========================================================
       REPORT
    ======================================================== */

    getReport() {

        return {

            running:
                this.running,

            statistics:
                {
                    ...this.statistics
                },

            recentEvents:
                this.getRecentEvents(20)
        };
    }

    /* ========================================================
       STATUS
    ======================================================== */

    status() {

        return {

            running:
                this.running,

            listeners:
                this.listeners.length,

            history:
                this.lastEvents.length,

            statistics:
                {
                    ...this.statistics
                }
        };
    }

    /* ========================================================
       STOP
    ======================================================== */

    stop() {

        /*
        EventBus implementatsiyasiga qarab
        listenerlarni olib tashlash keyingi
        versiyada ham qo‘llab-quvvatlanadi.
        */

        this.running = false;

        this.listeners.length = 0;

        logger.info(
            'Event Observer to‘xtatildi.'
        );
    }
}

const observer =
    new EventObserver();

module.exports =
    observer;

module.exports.EventObserver =
    EventObserver;
