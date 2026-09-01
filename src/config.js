'use strict';

require('dotenv').config();

/*
===============================================================
 AKV BEDROCK AI AGENT - CONFIG
===============================================================
 Minecraft Bedrock Server:

 Address : Soloraft.aternos.me
 Port    : 27295
 Version : 1.26.30

 Bot:
 Username : AKV_AI

 MUHIM:
 Minecraft server manzili ataylab shu faylda
 to'g'ridan-to'g'ri yozilgan.

 .env dagi MC_HOST va MC_PORT endi ishlatilmaydi.
===============================================================
*/

const config = {

    /* =========================================================
       MINECRAFT
    ========================================================= */

    minecraft: {

        // BEDROCK SERVER MANZILI
        host: 'Soloraft.aternos.me',

        // BEDROCK SERVER PORTI
        port: 27295,

        // BEDROCK VERSION
        version: '1.26.30',

        // BOT NOMI
        username: 'AKV_AI',

        /*
        Offline authentication.

        true:
          Offline/local server.

        false:
          Microsoft/Xbox authentication kerak bo'lishi mumkin.
        */
        offline: true,

        // Ulanish uzilsa qayta ulanish
        autoReconnect: true,

        // Birinchi reconnect kutish vaqti
        reconnectDelay: 10000
    },


    /* =========================================================
       AI
    ========================================================= */

    ai: {

        enabled: true,

        autonomous: true,

        model:
            process.env.AI_MODEL ||
            'openrouter/free',

        temperature: 0.7,

        maxTokens: 4000,

        // AI qaror oralig'i
        decisionInterval: 1500
    },


    /* =========================================================
       OPENROUTER
    ========================================================= */

    openrouter: {

        /*
        API KEY kodga yozilmaydi.

        GitHub Secret:
        OPENROUTER_API_KEY
        */

        apiKey:
            process.env.OPENROUTER_API_KEY ||
            '',

        baseURL:
            'https://openrouter.ai/api/v1',

        timeout: 60000,

        maxRetries: 3
    },


    /* =========================================================
       MEMORY
    ========================================================= */

    memory: {

        enabled: true,

        database:
            process.env.MEMORY_DATABASE ||
            './data/memory/akv-memory.db',

        permanent: true,

        maxRecentMessages: 1000,

        maxObservations: 100000
    },


    /* =========================================================
       OBSERVER
    ========================================================= */

    observer: {

        enabled: true,

        watchPlayers: true,

        watchEntities: true,

        watchChat: true,

        watchBlocks: true,

        watchCombat: true,

        watchMovement: true,

        reportEverything: true,

        realtime: true
    },


    /* =========================================================
       COMMANDS
    ========================================================= */

    commands: {

        remote: true,

        telegram: true,

        github: true,

        minecraftChat: true,

        requireConfirmationForDangerous: true
    },


    /* =========================================================
       TELEGRAM
    ========================================================= */

    telegram: {

        enabled:
            Boolean(
                process.env.TELEGRAM_BOT_TOKEN
            ),

        token:
            process.env.TELEGRAM_BOT_TOKEN ||
            '',

        adminId:
            process.env.TELEGRAM_ADMIN_ID ||
            ''
    },


    /* =========================================================
       GITHUB
    ========================================================= */

    github: {

        enabled:
            Boolean(
                process.env.GITHUB_TOKEN
            ),

        token:
            process.env.GITHUB_TOKEN ||
            '',

        repository:
            process.env.GITHUB_REPOSITORY ||
            '',

        pollInterval:
            Number(
                process.env.GITHUB_POLL_INTERVAL ||
                10000
            )
    },


    /* =========================================================
       REPORTS
    ========================================================= */

    reports: {

        enabled: true,

        autonomousReports: true,

        chatReports: true,

        playerReports: true,

        combatReports: true,

        buildReports: true,

        movementReports: true
    },


    /* =========================================================
       SECURITY
    ========================================================= */

    security: {

        requireAuthentication: true,

        allowUnknownCommands: false
    },


    /* =========================================================
       LOGGING
    ========================================================= */

    logging: {

        enabled: true,

        debug:
            process.env.DEBUG === 'true'
    }
};


/* =============================================================
   CONFIGURATION CHECK
============================================================= */

if (!config.minecraft.host) {

    throw new Error(
        'Minecraft server manzili mavjud emas.'
    );
}

if (
    !Number.isInteger(config.minecraft.port) ||
    config.minecraft.port < 1 ||
    config.minecraft.port > 65535
) {

    throw new Error(
        'Minecraft port noto‘g‘ri: ' +
        config.minecraft.port
    );
}


/* =============================================================
   STARTUP INFORMATION
============================================================= */

console.log(
    `[CONFIG] Minecraft Server: ` +
    `${config.minecraft.host}:${config.minecraft.port}`
);

console.log(
    `[CONFIG] Bedrock Version: ` +
    `${config.minecraft.version}`
);

console.log(
    `[CONFIG] Bot Username: ` +
    `${config.minecraft.username}`
);


/* =============================================================
   EXPORT
============================================================= */

module.exports = config;
