'use strict';

/*
===============================================================
 AKV BEDROCK CLIENT
 Minecraft Bedrock 1.26.30
===============================================================

Bu modul:

  - Minecraft Bedrock serveriga ulanadi
  - bot clientini boshqaradi
  - reconnect qiladi
  - chat packetlarini yuqoridagi tizimga uzatadi
  - spawn holatini kuzatadi
  - player/world packetlarini observerga uzatishga tayyorlaydi
  - boshqa modullar uchun yagona client API beradi

DIQQAT:
  Bu fayl AI emas.
  AI qarorlarini src/ai/brain.js qiladi.
  Harakatlarni src/actions/ modullari bajaradi.
  Kuzatuvni src/observer/ modullari bajaradi.

===============================================================
*/

const bedrock = require('bedrock-protocol');

let context = null;
let client = null;

let reconnectTimer = null;
let reconnectAttempts = 0;
let intentionallyDisconnected = false;

let connected = false;
let spawned = false;

let lastConnectStartedAt = 0;
let lastDisconnectAt = 0;

/* ============================================================
   INTERNAL HELPERS
============================================================ */

function log() {
    if (context && context.logger) {
        return context.logger;
    }

    return console;
}

function emit(event, payload = {}) {

    if (!context || !context.eventBus) {
        return;
    }

    context.eventBus.emitSafe(
        event,
        payload
    );
}

function wait(ms) {

    return new Promise(
        resolve => setTimeout(resolve, ms)
    );
}

function clearReconnectTimer() {

    if (reconnectTimer) {

        clearTimeout(
            reconnectTimer
        );

        reconnectTimer = null;
    }
}

/* ============================================================
   PACKET NAME HELPERS
=============================================================== */

function packetName(packet) {

    if (!packet) {
        return '';
    }

    return String(
        packet.name ||
        packet.id ||
        ''
    );
}

/* ============================================================
   POSITION EXTRACTION
=============================================================== */

function extractPosition(packet) {

    if (!packet) {
        return null;
    }

    const position =
        packet.position ||
        packet.pos ||
        packet.player_position ||
        null;

    if (!position) {
        return null;
    }

    const x = Number(position.x);
    const y = Number(position.y);
    const z = Number(position.z);

    if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(z)
    ) {
        return null;
    }

    return {
        x,
        y,
        z
    };
}

/* ============================================================
   ROTATION EXTRACTION
=============================================================== */

function extractRotation(packet) {

    if (!packet) {
        return null;
    }

    const yaw =
        packet.yaw ??
        packet.rotation?.yaw ??
        packet.yRot ??
        packet.y_rotation;

    const pitch =
        packet.pitch ??
        packet.rotation?.pitch ??
        packet.xRot ??
        packet.x_rotation;

    if (
        yaw === undefined &&
        pitch === undefined
    ) {
        return null;
    }

    return {
        yaw:
            Number(yaw || 0),

        pitch:
            Number(pitch || 0)
    };
}

/* ============================================================
   UPDATE STATE FROM PACKET
=============================================================== */

function updatePositionFromPacket(packet) {

    if (!context || !context.state) {
        return;
    }

    const position =
        extractPosition(packet);

    if (position) {

        context.state.position =
            position;

        emit(
            'minecraft:position',
            {
                position,
                packet:
                    packetName(packet)
            }
        );
    }

    const rotation =
        extractRotation(packet);

    if (rotation) {

        context.state.rotation =
            rotation;

        emit(
            'minecraft:rotation',
            {
                rotation,
                packet:
                    packetName(packet)
            }
        );
    }
}

/* ============================================================
   CHAT EXTRACTION
=============================================================== */

function extractChat(packet) {

    if (!packet) {
        return null;
    }

    const message =
        packet.message ??
        packet.text ??
        packet.rawtext ??
        packet.content ??
        null;

    if (
        message === null ||
        message === undefined
    ) {
        return null;
    }

    let text;

    if (typeof message === 'string') {

        text = message;

    } else {

        try {

            text =
                JSON.stringify(message);

        } catch (_) {

            text =
                String(message);
        }
    }

    let username =
        packet.username ??
        packet.sender ??
        packet.source_name ??
        packet.name ??
        null;

    if (
        typeof username !== 'string' &&
        username !== null
    ) {
        username =
            String(username);
    }

    return {

        username,

        message:
            text,

        timestamp:
            Date.now(),

        packet:
            packetName(packet)
    };
}

/* ============================================================
   PACKET DISPATCH
=============================================================== */

function handlePacket(packet) {

    if (!packet) {
        return;
    }

    const name =
        packetName(packet);

    /*
    Har bir packetni Observerga uzatamiz.
    Observer keraklisini o'zi tahlil qiladi.
    */

    emit(
        'minecraft:packet',
        {
            name,
            packet
        }
    );

    /*
    Position packetlari
    */

    const positionPackets = new Set([
        'move_player',
        'player_auth_input',
        'player_action',
        'respawn',
        'start_game'
    ]);

    if (positionPackets.has(name)) {

        updatePositionFromPacket(
            packet
        );
    }

    /*
    Chat
    */

    const chatPackets = new Set([
        'text',
        'chat',
        'system_chat',
        'play_status'
    ]);

    if (chatPackets.has(name)) {

        const chat =
            extractChat(packet);

        if (chat) {

            emit(
                'minecraft:chat',
                chat
            );
        }
    }

    /*
    Spawn / start_game
    */

    if (
        name === 'start_game' ||
        name === 'play_status'
    ) {

        /*
        play_status packetida status qiymati
        server implementationiga qarab turlicha
        bo'lishi mumkin. Shu sababli start_game
        eng ishonchli spawn signallaridan biri.
        */

        if (name === 'start_game') {

            spawned = true;

            if (context && context.state) {
                context.state.spawned = true;
            }

            emit(
                'minecraft:spawned',
                {
                    packet:
                        name
                }
            );

            log().success?.(
                'Minecraft bot spawn holatiga yetdi.'
            );
        }
    }

    /*
    Entity / player packetlari.
    To'liq tahlil Observer modulida bo'ladi.
    */

    const observationPackets = new Set([
        'add_player',
        'add_entity',
        'add_item_entity',
        'remove_entity',
        'move_entity',
        'move_player',
        'set_entity_data',
        'update_attributes',
        'inventory_content',
        'mob_equipment',
        'take_item_entity',
        'animate',
        'entity_event',
        'interact'
    ]);

    if (
        observationPackets.has(name)
    ) {

        emit(
            'minecraft:observation_packet',
            {
                name,
                packet
            }
        );
    }

    /*
    Combat bilan bog'liq packetlar.
    */

    const combatPackets = new Set([
        'animate',
        'entity_event',
        'damage_event',
        'hurt_animation',
        'mob_effect'
    ]);

    if (
        combatPackets.has(name)
    ) {

        emit(
            'minecraft:combat_packet',
            {
                name,
                packet
            }
        );
    }

    /*
    Block / world packetlari.
    */

    const worldPackets = new Set([
        'block_update',
        'update_block',
        'update_sub_chunk_blocks',
        'level_chunk',
        'network_chunk_publisher_update',
        'sub_chunk'
    ]);

    if (
        worldPackets.has(name)
    ) {

        emit(
            'minecraft:world_packet',
            {
                name,
                packet
            }
        );
    }
}

/* ============================================================
   CLIENT EVENT HANDLERS
=============================================================== */

function installClientHandlers() {

    if (!client) {
        return;
    }

    /*
    Packet listener
    */

    client.on(
        'packet',
        handlePacket
    );

    /*
    Connect
    */

    client.on(
        'connect',
        () => {

            connected = true;
            spawned = false;

            reconnectAttempts = 0;

            if (context && context.state) {

                context.state.connected =
                    true;

                context.state.spawned =
                    false;

                context.state.reconnecting =
                    false;
            }

            log().success?.(
                'Minecraft serverga ulanish o‘rnatildi.'
            );

            emit(
                'minecraft:connected',
                {
                    host:
                        context?.config?.minecraft?.host,

                    port:
                        context?.config?.minecraft?.port,

                    timestamp:
                        Date.now()
                }
            );
        }
    );

    /*
    Login
    */

    client.on(
        'login',
        packet => {

            if (context && context.state) {

                context.state.authenticated =
                    true;
            }

            emit(
                'minecraft:login',
                {
                    packet
                }
            );

            log().success?.(
                'Minecraft login muvaffaqiyatli.'
            );
        }
    );

    /*
    Spawn
    */

    client.on(
        'spawn',
        packet => {

            spawned = true;

            if (context && context.state) {
                context.state.spawned = true;
            }

            emit(
                'minecraft:spawned',
                {
                    packet
                }
            );

            log().success?.(
                'Bot Minecraft dunyosiga spawn bo‘ldi.'
            );
        }
    );

    /*
    Disconnect
    */

    client.on(
        'disconnect',
        reason => {

            connected = false;
            spawned = false;

            lastDisconnectAt =
                Date.now();

            if (context && context.state) {

                context.state.connected =
                    false;

                context.state.spawned =
                    false;

                context.state.authenticated =
                    false;
            }

            const information = {

                reason:
                    typeof reason === 'string'
                        ? reason
                        : JSON.stringify(reason),

                timestamp:
                    Date.now()
            };

            log().warn(
                'Minecraft connection uzildi.',
                information
            );

            emit(
                'minecraft:disconnected',
                information
            );

            if (
                !intentionallyDisconnected &&
                context?.config?.minecraft?.autoReconnect
            ) {

                scheduleReconnect();
            }
        }
    );

    /*
    Error
    */

    client.on(
        'error',
        error => {

            log().error(
                'Minecraft client error.',
                {
                    error:
                        error?.message ||
                        String(error)
                }
            );

            emit(
                'minecraft:error',
                {
                    error:
                        error?.message ||
                        String(error)
                }
            );
        }
    );

    /*
    Close
    */

    client.on(
        'close',
        () => {

            if (connected) {
                connected = false;
            }

            emit(
                'minecraft:close',
                {
                    timestamp:
                        Date.now()
                }
            );

            if (
                !intentionallyDisconnected &&
                context?.config?.minecraft?.autoReconnect
            ) {

                scheduleReconnect();
            }
        }
    );
}

/* ============================================================
   CREATE CLIENT
=============================================================== */

function createClient() {

    if (!context) {
        throw new Error(
            'Minecraft client context hali initialize qilinmagan.'
        );
    }

    const mc =
        context.config.minecraft;

    if (!mc.host) {

        throw new Error(
            'MC_HOST topilmadi.'
        );
    }

    if (!mc.port) {

        throw new Error(
            'MC_PORT topilmadi.'
        );
    }

    intentionallyDisconnected =
        false;

    lastConnectStartedAt =
        Date.now();

    log().info(
        `Minecraft serverga ulanmoqda: ${mc.host}:${mc.port}`
    );

    /*
    bedrock-protocol client configuration.

    Username va offline mode environment/config
    orqali boshqariladi.

    Online account kerak bo'lgan serverlarda
    auth/profile sozlamalari keyingi modulda
    alohida kengaytiriladi.
    */

    const options = {

        host:
            mc.host,

        port:
            mc.port,

        version:
            mc.version,

        username:
            mc.username,

        offline:
            mc.offline
    };

    try {

        client =
            bedrock.createClient(
                options
            );

    } catch (error) {

        client = null;

        log().error(
            'Bedrock client yaratilmadi.',
            {
                error:
                    error.message
            }
        );

        throw error;
    }

    installClientHandlers();

    emit(
        'minecraft:client_created',
        {
            host:
                mc.host,

            port:
                mc.port,

            version:
                mc.version
        }
    );

    return client;
}

/* ============================================================
   CONNECT
=============================================================== */

async function connect(agentContext = null) {

    if (agentContext) {
        context = agentContext;
    }

    if (!context) {
        throw new Error(
            'Agent context berilmagan.'
        );
    }

    intentionallyDisconnected =
        false;

    clearReconnectTimer();

    if (client && connected) {

        log().info(
            'Minecraft client allaqachon ulangan.'
        );

        return client;
    }

    /*
    Eski client bo'lsa yangi client yaratamiz.
    */

    client = null;

    const created =
        createClient();

    /*
    createClient event-driven.
    Connection jarayoni eventlar orqali
    davom etadi.
    */

    await wait(100);

    return created;
}

/* ============================================================
   RECONNECT
=============================================================== */

function scheduleReconnect() {

    if (intentionallyDisconnected) {
        return;
    }

    if (!context) {
        return;
    }

    clearReconnectTimer();

    reconnectAttempts++;

    const base =
        context.config.minecraft.reconnectDelay ||
        10000;

    /*
    Exponential backoff:
       10s
       20s
       40s
       80s
       ...
    maksimal 5 daqiqa.
    */

    const delay =
        Math.min(
            base *
            Math.pow(
                2,
                Math.min(
                    reconnectAttempts - 1,
                    5
                )
            ),
            300000
        );

    if (context.state) {

        context.state.reconnecting =
            true;

        context.state.statistics.reconnects++;
    }

    log().warn(
        `Reconnect rejalashtirildi: ${delay}ms`
    );

    emit(
        'minecraft:reconnect_scheduled',
        {
            delay,
            attempt:
                reconnectAttempts
        }
    );

    reconnectTimer =
        setTimeout(
            async () => {

                reconnectTimer = null;

                if (intentionallyDisconnected) {
                    return;
                }

                log().info(
                    `Minecraft reconnect urinishi #${reconnectAttempts}`
                );

                try {

                    await connect();

                } catch (error) {

                    log().error(
                        'Reconnect muvaffaqiyatsiz.',
                        {
                            error:
                                error.message
                        }
                    );

                    scheduleReconnect();
                }

            },
            delay
        );
}

/* ============================================================
   DISCONNECT
=============================================================== */

async function disconnect() {

    intentionallyDisconnected =
        true;

    clearReconnectTimer();

    connected = false;
    spawned = false;

    if (context && context.state) {

        context.state.connected =
            false;

        context.state.spawned =
            false;

        context.state.authenticated =
            false;
    }

    if (!client) {
        return;
    }

    try {

        if (
            typeof client.disconnect ===
            'function'
        ) {

            client.disconnect(
                'AKV agent shutdown'
            );

        } else if (
            typeof client.close ===
            'function'
        ) {

            client.close();
        }

    } catch (error) {

        log().error(
            'Minecraft disconnect error.',
            {
                error:
                    error.message
            }
        );
    }

    client = null;

    emit(
        'minecraft:disconnected_intentionally',
        {
            timestamp:
                Date.now()
        }
    );
}

/* ============================================================
   SEND PACKET
=============================================================== */

function sendPacket(name, params = {}) {

    if (!client) {

        throw new Error(
            'Minecraft client mavjud emas.'
        );
    }

    if (!connected) {

        throw new Error(
            'Minecraft serverga ulanmagan.'
        );
    }

    /*
    bedrock-protocol client.write()
    packet yuborishning asosiy interfeysi.

    Action Engine keyinchalik aynan shu
    funksiyadan foydalanadi.
    */

    try {

        client.write(
            name,
            params
        );

        emit(
            'minecraft:packet_sent',
            {
                name,
                params
            }
        );

        return true;

    } catch (error) {

        log().error(
            `Packet yuborilmadi: ${name}`,
            {
                error:
                    error.message
            }
        );

        emit(
            'minecraft:packet_send_error',
            {
                name,
                params,
                error:
                    error.message
            }
        );

        return false;
    }
}

/* ============================================================
   CHAT
=============================================================== */

function chat(message) {

    if (
        typeof message !== 'string' ||
        !message.trim()
    ) {

        throw new Error(
            'Chat xabari bo‘sh bo‘lishi mumkin emas.'
        );
    }

    const text =
        message
            .trim()
            .slice(0, 512);

    /*
    Bedrock versiyasiga qarab chat packetining
    aniq fieldlari client protocol tomonidan
    belgilanadi.

    Action layer keyinchalik bundan foydalanadi.
    */

    return sendPacket(
        'text',
        {
            type: 'chat',
            needs_translation: false,
            source_name:
                context?.config?.minecraft?.username ||
                'AKV',
            message: text,
            xuid: '',
            platform_chat_id: ''
        }
    );
}

/* ============================================================
   GETTERS
=============================================================== */

function getClient() {
    return client;
}

function isConnected() {
    return connected;
}

function isSpawned() {
    return spawned;
}

function getConnectionInfo() {

    return {

        connected,

        spawned,

        reconnectAttempts,

        lastConnectStartedAt,

        lastDisconnectAt,

        host:
            context?.config?.minecraft?.host ||
            null,

        port:
            context?.config?.minecraft?.port ||
            null,

        version:
            context?.config?.minecraft?.version ||
            null
    };
}

/* ============================================================
   RAW PACKET SUBSCRIPTION
=============================================================== */

function onPacket(callback) {

    if (
        typeof callback !== 'function'
    ) {

        throw new TypeError(
            'onPacket callback function bo‘lishi kerak.'
        );
    }

    if (!client) {

        throw new Error(
            'Client hali yaratilmagan.'
        );
    }

    client.on(
        'packet',
        callback
    );

    return () => {

        try {

            client.off(
                'packet',
                callback
            );

        } catch (_) {
            // Old event emitter implementation.
        }
    };
}

/* ============================================================
   INITIALIZE
=============================================================== */

async function initialize(agentContext) {

    context =
        agentContext;

    log().info(
        'Minecraft client module initialized.'
    );

    emit(
        'minecraft:module_initialized',
        {
            version:
                context.config.minecraft.version
        }
    );

    /*
    Hozir avtomatik connect qilamiz.
    Keyinchalik startup manager buni
    boshqarishi mumkin.
    */

    await connect();
}

/* ============================================================
   EXPORTS
=============================================================== */

module.exports = {

    initialize,

    connect,

    disconnect,

    createClient,

    sendPacket,

    chat,

    onPacket,

    getClient,

    isConnected,

    isSpawned,

    getConnectionInfo,

    scheduleReconnect
};
