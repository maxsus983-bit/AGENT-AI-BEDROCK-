'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

const context = require('../core/agent-context');
const logger = require('../core/logger');

class MessageGateway extends EventEmitter {

    constructor(options = {}) {

        super();

        this.name =
            'message-gateway';

        this.running = false;

        this.channels = new Map();

        this.handlers = new Map();

        this.history = [];

        this.maxHistory =
            Number(
                options.maxHistory || 5000
            );

        this.defaultTimeout =
            Number(
                options.timeout || 30000
            );

        this.stats = {

            received: 0,

            successful: 0,

            failed: 0,

            rejected: 0
        };

        context.register(
            'message-gateway',
            this
        );
    }

    start() {

        if (this.running) {

            return {
                success: true,
                alreadyRunning: true
            };
        }

        this.running = true;

        logger.info(
            'Message Gateway ishga tushdi.'
        );

        this.emit(
            'started'
        );

        return {
            success: true
        };
    }

    stop() {

        this.running = false;

        this.emit(
            'stopped'
        );

        return {
            success: true
        };
    }

    registerChannel(
        name,
        handler,
        options = {}
    ) {

        const channel =
            String(
                name
            )
            .trim()
            .toLowerCase();

        if (!channel) {

            throw new Error(
                'Channel nomi berilmagan.'
            );
        }

        if (
            typeof handler !==
            'function'
        ) {

            throw new Error(
                `Channel handler function bo‘lishi kerak: ${channel}`
            );
        }

        this.channels.set(
            channel,
            {

                name:
                    channel,

                handler,

                enabled:
                    options.enabled !== false,

                description:
                    options.description ||
                    '',

                metadata:
                    options.metadata ||
                    {}
            }
        );

        logger.info(
            `Message channel qo‘shildi: ${channel}`
        );

        return {
            success: true,
            channel
        };
    }

    removeChannel(
        name
    ) {

        const channel =
            String(
                name
            )
            .trim()
            .toLowerCase();

        const existed =
            this.channels.delete(
                channel
            );

        return {
            success: existed,
            channel
        };
    }

    enableChannel(
        name
    ) {

        const channel =
            this.channels.get(
                String(
                    name
                )
                .toLowerCase()
            );

        if (!channel) {

            return {
                success: false,
                error:
                    'Channel topilmadi.'
            };
        }

        channel.enabled = true;

        return {
            success: true
        };
    }

    disableChannel(
        name
    ) {

        const channel =
            this.channels.get(
                String(
                    name
                )
                .toLowerCase()
            );

        if (!channel) {

            return {
                success: false,
                error:
                    'Channel topilmadi.'
            };
        }

        channel.enabled = false;

        return {
            success: true
        };
    }

    registerHandler(
        event,
        handler
    ) {

        if (
            typeof handler !==
            'function'
        ) {

            throw new Error(
                'Handler function bo‘lishi kerak.'
            );
        }

        const key =
            String(
                event
            )
            .trim()
            .toLowerCase();

        this.handlers.set(
            key,
            handler
        );

        return {
            success: true,
            event: key
        };
    }

    async receive(
        payload = {}
    ) {

        if (!this.running) {

            this.start();
        }

        const request =
            this.normalizePayload(
                payload
            );

        this.stats.received++;

        this.emit(
            'message:received',
            request
        );

        /*
         * Tashqi kanal ruxsatsiz bo‘lsa,
         * command-executorgacha yetkazmaymiz.
         */

        const permission =
            await this.checkPermission(
                request
            );

        if (
            permission &&
            permission.allowed === false
        ) {

            this.stats.rejected++;

            const result = {

                success: false,

                rejected: true,

                requestId:
                    request.requestId,

                error:
                    permission.reason ||
                    'Buyruqqa ruxsat berilmadi.'
            };

            this.record(
                request,
                result
            );

            this.emit(
                'message:rejected',
                {
                    request,
                    result
                }
            );

            return result;
        }

        try {

            const result =
                await this.execute(
                    request
                );

            if (
                result &&
                result.success === false
            ) {

                this.stats.failed++;

            } else {

                this.stats.successful++;
            }

            this.record(
                request,
                result
            );

            this.emit(
                'message:processed',
                {
                    request,
                    result
                }
            );

            return result;

        } catch (error) {

            this.stats.failed++;

            const result = {

                success: false,

                requestId:
                    request.requestId,

                error:
                    error.message
            };

            this.record(
                request,
                result
            );

            this.emit(
                'message:error',
                {
                    request,
                    error
                }
            );

            logger.error(
                `Gateway xatosi: ${error.message}`
            );

            return result;
        }
    }

    async execute(
        request
    ) {

        /*
         * Maxsus kanal handler mavjud bo‘lsa,
         * avval uni ishlatamiz.
         */

        const channel =
            this.channels.get(
                request.channel
            );

        if (
            channel &&
            channel.enabled &&
            typeof channel.handler ===
            'function'
        ) {

            return this.withTimeout(
                Promise.resolve(
                    channel.handler(
                        request
                    )
                ),
                this.defaultTimeout
            );
        }

        /*
         * Asosiy yo‘l:
         *
         * Message Gateway
         *       ↓
         * Command Executor
         *       ↓
         * AI / Action Engine
         */

        const executor =
            context.get(
                'command-executor'
            );

        if (!executor) {

            throw new Error(
                'Command Executor topilmadi.'
            );
        }

        if (
            typeof executor.handleExternal ===
            'function'
        ) {

            return this.withTimeout(

                executor.handleExternal(
                    {

                        command:
                            request.command,

                        source:
                            request.source,

                        channel:
                            request.channel,

                        user:
                            request.user,

                        requestId:
                            request.requestId,

                        metadata:
                            request.metadata
                    }
                ),

                this.defaultTimeout
            );
        }

        if (
            typeof executor.execute ===
            'function'
        ) {

            return this.withTimeout(

                executor.execute(
                    request.command,
                    {

                        source:
                            request.source,

                        channel:
                            request.channel,

                        user:
                            request.user,

                        requestId:
                            request.requestId
                    }
                ),

                this.defaultTimeout
            );
        }

        throw new Error(
            'Command Executorda execute metodi yo‘q.'
        );
    }

    normalizePayload(
        payload
    ) {

        if (
            typeof payload ===
            'string'
        ) {

            return {

                requestId:
                    this.generateRequestId(),

                command:
                    payload.trim(),

                source:
                    'external',

                channel:
                    'unknown',

                user:
                    null,

                timestamp:
                    Date.now(),

                metadata: {}
            };
        }

        const source =
            this.clean(
                payload.source ||
                payload.origin ||
                'external'
            );

        const channel =
            this.clean(
                payload.channel ||
                payload.platform ||
                source ||
                'unknown'
            );

        const command =
            this.clean(
                payload.command ||
                payload.text ||
                payload.message ||
                payload.prompt ||
                ''
            );

        return {

            requestId:
                this.clean(
                    payload.requestId
                ) ||
                this.generateRequestId(),

            command,

            source,

            channel,

            user:
                this.normalizeUser(
                    payload.user ||
                    payload.sender ||
                    payload.from
                ),

            timestamp:
                Number(
                    payload.timestamp
                ) ||
                Date.now(),

            metadata:
                payload.metadata &&
                typeof payload.metadata ===
                'object'
                    ? payload.metadata
                    : {},

            raw:
                payload
        };
    }

    normalizeUser(
        user
    ) {

        if (!user) {
            return null;
        }

        if (
            typeof user ===
            'string'
        ) {

            return {
                id: user,
                name: user
            };
        }

        return {

            id:
                user.id ||
                user.userId ||
                user.username ||
                null,

            name:
                user.name ||
                user.username ||
                user.firstName ||
                null,

            username:
                user.username ||
                null
        };
    }

    async checkPermission(
        request
    ) {

        const manager =
            context.get(
                'permission-manager'
            );

        /*
         * Permission manager hali yozilmagan
         * bo‘lsa, gateway buyruqni davom ettiradi.
         */

        if (!manager) {

            return {
                allowed: true
            };
        }

        try {

            if (
                typeof manager.check ===
                'function'
            ) {

                return await manager.check(
                    request
                );
            }

            if (
                typeof manager.authorize ===
                'function'
            ) {

                return await manager.authorize(
                    request
                );
            }

        } catch (error) {

            logger.warn(
                `Permission tekshiruvi xatosi: ${error.message}`
            );

            return {

                allowed: false,

                reason:
                    'Permission tekshiruvida xatolik.'
            };
        }

        return {
            allowed: true
        };
    }

    async send(
        channel,
        message,
        metadata = {}
    ) {

        const name =
            String(
                channel
            )
            .trim()
            .toLowerCase();

        const target =
            this.channels.get(
                name
            );

        if (
            !target ||
            !target.enabled
        ) {

            /*
             * Hali Telegram/GitHub adapteri ulanmagan
             * bo‘lsa ham xabarni event sifatida chiqaramiz.
             */

            const packet = {

                channel: name,

                message:
                    String(
                        message
                    ),

                metadata,

                timestamp:
                    Date.now()
            };

            this.emit(
                'outgoing',
                packet
            );

            return {

                success: true,

                queued: true,

                packet
            };
        }

        try {

            let result;

            /*
             * Channel handler outgoing sifatida
             * qo‘llab-quvvatlansa.
             */

            result =
                await target.handler(
                    {

                        type:
                            'outgoing',

                        channel:
                            name,

                        message:
                            String(
                                message
                            ),

                        metadata
                    }
                );

            this.emit(
                'message:sent',
                {
                    channel: name,
                    message,
                    result
                }
            );

            return {

                success: true,

                result
            };

        } catch (error) {

            logger.error(
                `Xabar yuborishda xatolik: ${error.message}`
            );

            return {

                success: false,

                error:
                    error.message
            };
        }
    }

    async broadcast(
        message,
        options = {}
    ) {

        const results = [];

        const selected =
            options.channels
                ? options.channels
                : [
                    ...this.channels.keys()
                ];

        for (
            const channel of
            selected
        ) {

            const result =
                await this.send(
                    channel,
                    message,
                    options.metadata ||
                    {}
                );

            results.push({

                channel,

                result
            });
        }

        return {

            success:
                results.every(
                    item =>
                        item.result?.success !== false
                ),

            results
        };
    }

    async reply(
        request,
        message,
        metadata = {}
    ) {

        if (!request) {

            return {

                success: false,

                error:
                    'Request mavjud emas.'
            };
        }

        return this.send(
            request.channel,
            message,
            {

                ...metadata,

                requestId:
                    request.requestId,

                user:
                    request.user
            }
        );
    }

    async handleGitHub(
        payload = {}
    ) {

        /*
         * GitHub Action yoki webhookdan keladigan
         * buyruq uchun umumiy endpoint.
         */

        const command =
            payload.command ||
            payload.inputs?.command ||
            payload.client_payload?.command ||
            payload.text ||
            '';

        return this.receive({

            command,

            source:
                'github',

            channel:
                'github',

            user:
                payload.user ||
                payload.sender ||
                payload.sender?.login ||
                null,

            metadata: {

                event:
                    payload.event ||
                    payload.action ||
                    null,

                repository:
                    payload.repository ||
                    payload.repository?.full_name ||
                    null,

                workflow:
                    payload.workflow ||
                    null,

                runId:
                    payload.runId ||
                    payload.workflow_run?.id ||
                    null
            }
        });
    }

    async handleTelegram(
        payload = {}
    ) {

        /*
         * Telegram adapter keyinchalik shu metodga
         * update yuboradi.
         */

        const message =
            payload.message ||
            payload.edited_message ||
            payload.channel_post ||
            payload;

        const text =
            message.text ||
            message.caption ||
            '';

        const from =
            message.from ||
            {};

        return this.receive({

            command:
                text,

            source:
                'telegram',

            channel:
                'telegram',

            user: {

                id:
                    from.id ||
                    null,

                name:
                    from.first_name ||
                    from.username ||
                    null,

                username:
                    from.username ||
                    null
            },

            metadata: {

                chatId:
                    message.chat?.id ||
                    null,

                messageId:
                    message.message_id ||
                    null,

                date:
                    message.date ||
                    null
            }
        });
    }

    async handleWeb(
        payload = {}
    ) {

        return this.receive({

            command:
                payload.command ||
                payload.text ||
                payload.message ||
                '',

            source:
                'web',

            channel:
                'web',

            user:
                payload.user ||
                null,

            metadata:
                payload.metadata ||
                {}
        });
    }

    async handleAPI(
        payload = {}
    ) {

        return this.receive({

            command:
                payload.command ||
                payload.text ||
                payload.prompt ||
                '',

            source:
                'api',

            channel:
                'api',

            user:
                payload.user ||
                null,

            metadata:
                payload.metadata ||
                {}
        });
    }

    formatResult(
        result
    ) {

        if (!result) {

            return '❌ Natija olinmadi.';
        }

        if (
            result.success === false
        ) {

            return (
                `❌ ${result.error || 'Buyruq bajarilmadi.'}`
            );
        }

        if (
            result.message
        ) {

            return String(
                result.message
            );
        }

        if (
            result.response
        ) {

            return String(
                result.response
            );
        }

        if (
            result.text
        ) {

            return String(
                result.text
            );
        }

        return (
            '✅ Buyruq muvaffaqiyatli bajarildi.'
        );
    }

    record(
        request,
        result
    ) {

        const item = {

            requestId:
                request.requestId,

            timestamp:
                Date.now(),

            command:
                request.command,

            source:
                request.source,

            channel:
                request.channel,

            user:
                request.user,

            success:
                result?.success !== false,

            result
        };

        this.history.push(
            item
        );

        if (
            this.history.length >
            this.maxHistory
        ) {

            this.history.splice(
                0,
                this.history.length -
                this.maxHistory
            );
        }

        /*
         * Memory Store mavjud bo‘lsa,
         * tashqi buyruq tarixini saqlaymiz.
         */

        const memory =
            context.get(
                'memory'
            );

        if (
            memory &&
            typeof memory.addCommand ===
            'function'
        ) {

            Promise.resolve(
                memory.addCommand(
                    request.command,
                    result,
                    {

                        source:
                            request.source,

                        user:
                            request.user?.id ||
                            request.user?.username ||
                            null,

                        channel:
                            request.channel
                    }
                )
            )
            .catch(
                error => {

                    logger.warn(
                        `Gateway memory saqlash xatosi: ${error.message}`
                    );
                }
            );
        }
    }

    getHistory(
        limit = 100
    ) {

        return this.history
            .slice(
                -Math.max(
                    1,
                    Number(limit) || 100
                )
            )
            .reverse();
    }

    clearHistory() {

        this.history = [];

        return {
            success: true
        };
    }

    getChannels() {

        return [
            ...this.channels.values()
        ]
        .map(
            channel => ({

                name:
                    channel.name,

                enabled:
                    channel.enabled,

                description:
                    channel.description
            })
        );
    }

    getStats() {

        return {

            running:
                this.running,

            channels:
                this.channels.size,

            handlers:
                this.handlers.size,

            history:
                this.history.length,

            received:
                this.stats.received,

            successful:
                this.stats.successful,

            failed:
                this.stats.failed,

            rejected:
                this.stats.rejected
        };
    }

    generateRequestId() {

        return (
            'gw_' +
            Date.now()
                .toString(36) +
            '_' +
            crypto.randomBytes(
                6
            )
            .toString(
                'hex'
            )
        );
    }

    clean(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {

            return '';
        }

        return String(
            value
        ).trim();
    }

    withTimeout(
        promise,
        timeout
    ) {

        return new Promise(
            (resolve, reject) => {

                let finished =
                    false;

                const timer =
                    setTimeout(
                        () => {

                            if (
                                finished
                            ) {
                                return;
                            }

                            finished = true;

                            reject(
                                new Error(
                                    `Buyruq ${timeout}ms ichida javob bermadi.`
                                )
                            );

                        },
                        timeout
                    );

                Promise.resolve(
                    promise
                )
                .then(
                    result => {

                        if (
                            finished
                        ) {
                            return;
                        }

                        finished = true;

                        clearTimeout(
                            timer
                        );

                        resolve(
                            result
                        );
                    }
                )
                .catch(
                    error => {

                        if (
                            finished
                        ) {
                            return;
                        }

                        finished = true;

                        clearTimeout(
                            timer
                        );

                        reject(
                            error
                        );
                    }
                );
            }
        );
    }
}

const gateway =
    new MessageGateway();

module.exports =
    gateway;

module.exports.MessageGateway =
    MessageGateway;
