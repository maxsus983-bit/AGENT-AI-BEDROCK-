'use strict';

require('dotenv').config();

/*
===============================================================
 AKV BEDROCK AI AGENT
 CONFIGURATION
===============================================================

 Minecraft:
   Address : Soloraft.aternos.me
   Port    : 27295
   Version : 1.26.30
   Bot     : AKV_AI

 DIQQAT:
 OpenRouter API key va Telegram token bu faylga yozilmaydi.
 Ular .env / GitHub Secrets orqali beriladi.
===============================================================
*/

const config = {

    /* =========================================================
       MINECRAFT
    ========================================================= */

    minecraft: {

        /*
        Server manzili.
        Agar .env da MC_HOST berilsa,
        .env qiymati ustun bo'ladi.
        */

        host:
            process.env.MC_HOST ||
            'Soloraft.aternos.me',

        /*
        Bedrock server porti.
        */

        port:
            Number(
                process.env.MC_PORT ||
                27295
            ),

        /*
        Minecraft Bedrock versiyasi.
        */

        version:
            process.env.MC_VERSION ||
            '1.26.30',

        /*
        Bot username.
        */

        username:
            process.env.MC_USERNAME ||
            'AKV_AI',

        /*
        Bedrock authentication.

        true  = offline/local authentication
        false = Microsoft authentication kerak bo'lishi mumkin
        */

        offline:
            process.env.MC_OFFLINE !== 'false',

        /*
        Aloqa uzilsa avtomatik qayta ulanadi.
        */

        autoReconnect:
            process.env.MC_AUTO_RECONNECT !== 'false',

        /*
        Birinchi reconnect kutish vaqti.
        */

        reconnectDelay:
            Number(
                process.env.MC_RECONNECT_DELAY ||
                10000
            )
    },

    /* =========================================================
       AI
    ========================================================= */

    ai: {

        enabled: true,

        /*
        AI agent mustaqil qaror qabul qilishi mumkin.
        */

        autonomous: true,

        /*
        OpenRouter modeli.
        */

        model:
            process.env.AI_MODEL ||
            'openrouter/free',

        temperature:
            0.7,

        maxTokens:
            4000,

        /*
        AI har qaroridan oldin
        mavjud dunyo holatini tekshiradi.
        */

        decisionInterval:
            1500
    },

    /* =========================================================
       OPENROUTER
    ========================================================= */

    openrouter: {

        /*
        API key .env yoki GitHub Secretdan olinadi.
        */

        apiKey:
            process.env.OPENROUTER_API_KEY ||
            '',

        baseURL:
            process.env.OPENROUTER_BASE_URL ||
            'https://openrouter.ai/api/v1',

        timeout:
            60000,

        maxRetries:
            3
    },

    /* =========================================================
       MEMORY
    ========================================================= */

    memory: {

        enabled: true,

        database:
            process.env.MEMORY_DATABASE ||
            './data/memory/akv-memory.db',

        /*
        Uzoq muddatli xotira.
        */

        permanent: true,

        /*
        Oxirgi chat xabarlari.
        */

        maxRecentMessages:
            1000,

        /*
        Kuzatilgan world/entity ma'lumotlari.
        */

        maxObservations:
            100000
    },

    /* =========================================================
       OBSERVER
    ========================================================= */

    observer: {

        enabled: true,

        /*
        Playerlarni kuzatish.
        */

        watchPlayers:
            true,

        /*
        Mob va boshqa entitylarni kuzatish.
        */

        watchEntities:
            true,

        /*
        Chatni kuzatish.
        */

        watchChat:
            true,

        /*
        Block/world o'zgarishlarini kuzatish.
        */

        watchBlocks:
            true,

        /*
        Combat eventlarini kuzatish.
        */

        watchCombat:
            true,

        /*
        Harakatlarni kuzatish.
        */

        watchMovement:
            true,

        /*
        Mavjud kuzatuv ma'lumotlarini imkon qadar
        to'liq yig'ish.
        */

        reportEverything:
            true,

        /*
        Real-time observer.
        */

        realtime:
            true
    },

    /* =========================================================
       COMMANDS
    ========================================================= */

    commands: {

        /*
        Remote commandlar.
        */

        remote:
            true,

        /*
        Telegram orqali command.
        */

        telegram:
            true,

        /*
        GitHub orqali command.
        */

        github:
            true,

        /*
        Minecraft chat orqali command.
        */

        minecraftChat:
            true,

        /*
        Xavfli commandlar uchun tasdiqlash.
        */

        requireConfirmationForDangerous:
            true
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

        /*
        GitHub command polling interval.
        */

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

        /*
        AI muhim voqealar haqida xabar beradi.
        */

        autonomousReports:
            true,

        chatReports:
            true,

        playerReports:
            true,

        combatReports:
            true,

        buildReports:
            true,

        movementReports:
            true
    },

    /* =========================================================
       SECURITY
    ========================================================= */

    security: {

        /*
        Tashqi commandlar authenticationdan o'tadi.
        */

        requireAuthentication:
            true,

        /*
        Noma'lum commandlarni bajarishni taqiqlash.
        */

        allowUnknownCommands:
            false
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
   CONFIG VALIDATION
============================================================= */

if (!config.minecraft.host) {

    throw new Error(
        'Minecraft server manzili topilmadi.'
    );
}

if (
    !Number.isInteger(config.minecraft.port) ||
    config.minecraft.port <= 0 ||
    config.minecraft.port > 65535
) {

    throw new Error(
        `Minecraft port noto'g'ri: ${config.minecraft.port}`
    );
}


/* =============================================================
   EXPORT
============================================================= */

module.exports = config;
