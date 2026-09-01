'use strict';

const fs = require('fs');
const path = require('path');

/*
===============================================================
 AKV CORE LOGGER
===============================================================

Markaziy logging tizimi.

Vazifalar:

  - Console log
  - File log
  - INFO
  - WARN
  - ERROR
  - DEBUG
  - SUCCESS
  - Event context
  - Timestamp
  - JSON metadata
  - Log rotation
  - Sensitive data masking

Barcha modullar logger orqali xabar chiqaradi.
===============================================================
*/

class Logger {

    constructor(options = {}) {

        this.root =
            options.root ||
            path.resolve(__dirname, '../..');

        this.logDirectory =
            options.logDirectory ||
            path.join(
                this.root,
                'data',
                'logs'
            );

        this.logFile =
            options.logFile ||
            path.join(
                this.logDirectory,
                'akv.log'
            );

        this.errorFile =
            options.errorFile ||
            path.join(
                this.logDirectory,
                'error.log'
            );

        this.maxFileSize =
            Number(options.maxFileSize) ||
            10 * 1024 * 1024;

        this.maxFiles =
            Number(options.maxFiles) ||
            5;

        this.debugEnabled =
            options.debugEnabled !== false;

        this.consoleEnabled =
            options.consoleEnabled !== false;

        this.fileEnabled =
            options.fileEnabled !== false;

        this.initialized = false;

        this.initialize();
    }

    /* ========================================================
       INITIALIZE
    ======================================================== */

    initialize() {

        try {

            if (
                !fs.existsSync(
                    this.logDirectory
                )
            ) {

                fs.mkdirSync(
                    this.logDirectory,
                    {
                        recursive: true
                    }
                );
            }

            if (
                this.fileEnabled &&
                !fs.existsSync(
                    this.logFile
                )
            ) {

                fs.writeFileSync(
                    this.logFile,
                    '',
                    'utf8'
                );
            }

            if (
                this.fileEnabled &&
                !fs.existsSync(
                    this.errorFile
                )
            ) {

                fs.writeFileSync(
                    this.errorFile,
                    '',
                    'utf8'
                );
            }

            this.initialized = true;

        } catch (error) {

            this.initialized = false;

            console.error(
                '[LOGGER] Initialization failed:',
                error.message
            );
        }
    }

    /* ========================================================
       TIMESTAMP
    ======================================================== */

    timestamp() {

        return new Date()
            .toISOString();
    }

    /* ========================================================
       NORMALIZE ERROR
    ======================================================== */

    normalizeError(error) {

        if (!error) {
            return null;
        }

        if (error instanceof Error) {

            return {

                name:
                    error.name,

                message:
                    error.message,

                stack:
                    error.stack
            };
        }

        if (
            typeof error === 'object'
        ) {

            return {
                ...error
            };
        }

        return {
            message:
                String(error)
        };
    }

    /* ========================================================
       SANITIZE
    ======================================================== */

    sanitize(value, key = '') {

        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        const lowerKey =
            String(key)
                .toLowerCase();

        const sensitiveKeys = [
            'password',
            'passwd',
            'token',
            'api_key',
            'apikey',
            'authorization',
            'cookie',
            'secret',
            'access_token',
            'refresh_token',
            'private_key'
        ];

        if (
            sensitiveKeys.some(
                sensitive =>
                    lowerKey.includes(
                        sensitive
                    )
            )
        ) {

            return '[REDACTED]';
        }

        if (
            value instanceof Error
        ) {

            return this.normalizeError(
                value
            );
        }

        if (
            Array.isArray(value)
        ) {

            return value.map(
                item =>
                    this.sanitize(item)
            );
        }

        if (
            typeof value === 'object'
        ) {

            const result = {};

            for (
                const [
                    childKey,
                    childValue
                ] of Object.entries(value)
            ) {

                result[childKey] =
                    this.sanitize(
                        childValue,
                        childKey
                    );
            }

            return result;
        }

        return value;
    }

    /* ========================================================
       SERIALIZE
    ======================================================== */

    serializeMeta(meta) {

        if (
            meta === undefined ||
            meta === null
        ) {
            return '';
        }

        try {

            const sanitized =
                this.sanitize(meta);

            return JSON.stringify(
                sanitized
            );

        } catch (error) {

            return JSON.stringify({
                serialization_error:
                    error.message
            });
        }
    }

    /* ========================================================
       LEVEL
    ======================================================== */

    levelName(level) {

        return String(
            level || 'INFO'
        ).toUpperCase();
    }

    /* ========================================================
       FORMAT
    ======================================================== */

    format(
        level,
        message,
        meta = null
    ) {

        const timestamp =
            this.timestamp();

        const normalizedLevel =
            this.levelName(level);

        let text =
            `[${timestamp}] [${normalizedLevel}] ${message}`;

        if (
            meta !== null &&
            meta !== undefined
        ) {

            const serialized =
                this.serializeMeta(
                    meta
                );

            if (serialized) {
                text += ` ${serialized}`;
            }
        }

        return text;
    }

    /* ========================================================
       WRITE FILE
    ======================================================== */

    writeFile(
        file,
        line
    ) {

        if (!this.fileEnabled) {
            return;
        }

        try {

            this.rotateIfNeeded(
                file
            );

            fs.appendFileSync(
                file,
                line + '\n',
                'utf8'
            );

        } catch (error) {

            console.error(
                '[LOGGER] File write failed:',
                error.message
            );
        }
    }

    /* ========================================================
       ROTATION
    ======================================================== */

    rotateIfNeeded(file) {

        if (!fs.existsSync(file)) {
            return;
        }

        let stats;

        try {

            stats =
                fs.statSync(file);

        } catch (_) {

            return;
        }

        if (
            stats.size <
            this.maxFileSize
        ) {
            return;
        }

        /*
        Eski fayllarni orqaga suramiz:
          akv.log
          akv.log.1
          akv.log.2
          ...
        */

        for (
            let index =
                this.maxFiles - 1;
            index >= 1;
            index--
        ) {

            const source =
                index === 1
                    ? file
                    : `${file}.${index - 1}`;

            const destination =
                `${file}.${index}`;

            if (
                fs.existsSync(
                    source
                )
            ) {

                try {

                    fs.renameSync(
                        source,
                        destination
                    );

                } catch (_) {
                    // Rotation failure should not crash agent.
                }
            }
        }

        try {

            fs.writeFileSync(
                file,
                '',
                'utf8'
            );

        } catch (_) {
            // Ignore.
        }
    }

    /* ========================================================
       OUTPUT
    ======================================================== */

    write(
        level,
        message,
        meta = null
    ) {

        const line =
            this.format(
                level,
                message,
                meta
            );

        if (this.consoleEnabled) {

            const normalized =
                this.levelName(level);

            if (
                normalized === 'ERROR'
            ) {

                console.error(
                    line
                );

            } else if (
                normalized === 'WARN'
            ) {

                console.warn(
                    line
                );

            } else {

                console.log(
                    line
                );
            }
        }

        this.writeFile(
            this.logFile,
            line
        );

        if (
            this.levelName(level) ===
            'ERROR'
        ) {

            this.writeFile(
                this.errorFile,
                line
            );
        }

        return line;
    }

    /* ========================================================
       INFO
    ======================================================== */

    info(
        message,
        meta = null
    ) {

        return this.write(
            'INFO',
            message,
            meta
        );
    }

    /* ========================================================
       WARN
    ======================================================== */

    warn(
        message,
        meta = null
    ) {

        return this.write(
            'WARN',
            message,
            meta
        );
    }

    /* ========================================================
       ERROR
    ======================================================== */

    error(
        message,
        meta = null
    ) {

        return this.write(
            'ERROR',
            message,
            meta
        );
    }

    /* ========================================================
       DEBUG
    ======================================================== */

    debug(
        message,
        meta = null
    ) {

        if (!this.debugEnabled) {
            return;
        }

        return this.write(
            'DEBUG',
            message,
            meta
        );
    }

    /* ========================================================
       SUCCESS
    ======================================================== */

    success(
        message,
        meta = null
    ) {

        return this.write(
            'SUCCESS',
            message,
            meta
        );
    }

    /* ========================================================
       TRACE
    ======================================================== */

    trace(
        message,
        meta = null
    ) {

        return this.write(
            'TRACE',
            message,
            meta
        );
    }

    /* ========================================================
       EVENT
    ======================================================== */

    event(
        eventName,
        payload = {}
    ) {

        return this.write(
            'EVENT',
            eventName,
            payload
        );
    }

    /* ========================================================
       CHAT
    ======================================================== */

    chat(
        username,
        message,
        extra = {}
    ) {

        return this.write(
            'CHAT',
            `${username}: ${message}`,
            extra
        );
    }

    /* ========================================================
       PLAYER
    ======================================================== */

    player(
        message,
        meta = null
    ) {

        return this.write(
            'PLAYER',
            message,
            meta
        );
    }

    /* ========================================================
       COMBAT
    ======================================================== */

    combat(
        message,
        meta = null
    ) {

        return this.write(
            'COMBAT',
            message,
            meta
        );
    }

    /* ========================================================
       ACTION
    ======================================================== */

    action(
        message,
        meta = null
    ) {

        return this.write(
            'ACTION',
            message,
            meta
        );
    }

    /* ========================================================
       AI
    ======================================================== */

    ai(
        message,
        meta = null
    ) {

        return this.write(
            'AI',
            message,
            meta
        );
    }

    /* ========================================================
       MEMORY
    ======================================================== */

    memory(
        message,
        meta = null
    ) {

        return this.write(
            'MEMORY',
            message,
            meta
        );
    }

    /* ========================================================
       CONNECTION
    ======================================================== */

    connection(
        message,
        meta = null
    ) {

        return this.write(
            'CONNECTION',
            message,
            meta
        );
    }

    /* ========================================================
       PERFORMANCE
    ======================================================== */

    performance(
        message,
        meta = null
    ) {

        return this.write(
            'PERFORMANCE',
            message,
            meta
        );
    }

    /* ========================================================
       CHILD LOGGER
    ======================================================== */

    child(contextName) {

        const parent =
            this;

        return {

            info(message, meta = {}) {
                parent.info(
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            },

            warn(message, meta = {}) {
                parent.warn(
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            },

            error(message, meta = {}) {
                parent.error(
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            },

            debug(message, meta = {}) {
                parent.debug(
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            },

            success(message, meta = {}) {
                parent.success(
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            },

            ai(message, meta = {}) {
                parent.ai(
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            },

            action(message, meta = {}) {
                parent.action(
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            },

            combat(message, meta = {}) {
                parent.combat(
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            },

            memory(message, meta = {}) {
                parent.memory(
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            },

            chat(username, message, meta = {}) {
                parent.chat(
                    username,
                    message,
                    {
                        context:
                            contextName,
                        ...meta
                    }
                );
            }
        };
    }

    /* ========================================================
       FLUSH
    ======================================================== */

    flush() {
        /*
        fs.appendFileSync ishlatilgani uchun
        alohida flush talab qilinmaydi.
        API compatibility uchun mavjud.
        */
        return true;
    }

    /* ========================================================
       CLOSE
    ======================================================== */

    close() {

        this.initialized =
            false;

        return true;
    }
}

/* ============================================================
   DEFAULT LOGGER
============================================================ */

const logger =
    new Logger({
        root:
            path.resolve(
                __dirname,
                '../..'
            )
    });

/* ============================================================
   EXPORT
============================================================ */

module.exports = logger;

module.exports.Logger =
    Logger;
