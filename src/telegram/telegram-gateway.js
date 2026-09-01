'use strict';

const context = require('../core/agent-context');
const logger = require('../core/logger');

class TelegramGateway {

    constructor(options = {}) {

        this.name = 'telegram-gateway';

        this.running = false;

        this.bot = null;

        this.token =
            options.token ||
            process.env.TELEGRAM_BOT_TOKEN ||
            '';

        this.allowedUsers = new Set(
            (options.allowedUsers || [])
                .map(String)
                .map(v => v.trim())
                .filter(Boolean)
        );

        this.chatIds = new Set();

        context.register(
            'telegram-gateway',
            this
        );
    }

    async start() {

        if (this.running) {
            return {
                success: true,
                alreadyRunning: true
            };
        }

        if (!this.token) {

            logger.warn(
                'Telegram token berilmagan.'
            );

            return {
                success: false,
                disabled: true,
                error:
                    'TELEGRAM_BOT_TOKEN topilmadi.'
            };
        }

        let TelegramBot;

        try {

            TelegramBot =
                require('node-telegram-bot-api');

        } catch (error) {

            logger.error(
                'node-telegram-bot-api o‘rnatilmagan.'
            );

            return {
                success: false,
                error:
                    'node-telegram-bot-api o‘rnatilmagan. npm install node-telegram-bot-api qiling.'
            };
        }

        try {

            this.bot =
                new TelegramBot(
                    this.token,
                    {
                        polling: true
                    }
                );

            this.registerHandlers();

            this.running = true;

            logger.success(
                'Telegram Gateway ishga tushdi.'
            );

            return {
                success: true
            };

        } catch (error) {

            logger.error(
                `Telegram Gateway xatosi: ${error.message}`
            );

            return {
                success: false,
                error:
                    error.message
            };
        }
    }

    async stop() {

        if (
            this.bot &&
            typeof this.bot.stopPolling === 'function'
        ) {

            try {
                await this.bot.stopPolling();
            } catch (error) {
                logger.warn(
                    `Telegram polling xatosi: ${error.message}`
                );
            }
        }

        this.running = false;
        this.bot = null;

        return {
            success: true
        };
    }

    registerHandlers() {

        if (!this.bot) {
            return;
        }

        /*
         * /start
         */

        this.bot.onText(
            /^\/start$/i,
            async message => {

                await this.safeSend(
                    message.chat.id,
                    [
                        '🤖 AKV Minecraft AI Agent',
                        '',
                        '✅ Telegram boshqaruv tizimi ishlayapti.',
                        '',
                        'Minecraftga buyruq berish uchun oddiy xabar yozing:',
                        '',
                        '➡️ oldinga 10 blok yur',
                        '➡️ uy qur',
                        '➡️ atrofni kuzat',
                        '➡️ jang qil',
                        '➡️ chatga Salom yoz',
                        '➡️ avto o‘yna',
                        '➡️ to‘xta',
                        '',
                        '/status — agent holati',
                        '/help — yordam'
                    ].join('\n')
                );
            }
        );

        /*
         * /help
         */

        this.bot.onText(
            /^\/help$/i,
            async message => {

                await this.safeSend(
                    message.chat.id,
                    [
                        '🤖 AKV AI BUYRUQLARI',
                        '',
                        'Oddiy Telegram xabari sifatida yozing:',
                        '',
                        '• oldinga 10 blok yur',
                        '• orqaga 5 blok yur',
                        '• uy qur',
                        '• meni kuzat',
                        '• atrofni kuzat',
                        '• jang qil',
                        '• chatga Salom yoz',
                        '• avto o‘yna',
                        '• to‘xta',
                        '',
                        '/status'
                    ].join('\n')
                );
            }
        );

        /*
         * /status
         */

        this.bot.onText(
            /^\/status$/i,
            async message => {

                const executor =
                    context.get(
                        'command-executor'
                    );

                const router =
                    context.get(
                        'command-router'
                    );

                const minecraft =
                    context.get(
                        'minecraft'
                    );

                const state =
                    context.state;

                await this.safeSend(
                    message.chat.id,
                    [
                        '🤖 AKV AI STATUS',
                        '',
                        `⚙️ Executor: ${Boolean(executor)}`,
                        `📡 Router: ${Boolean(router)}`,
                        `🎮 Minecraft: ${state?.connected ? '🟢 Ulangan' : '🔴 Ulanmagan'}`,
                        `👤 Spawn: ${state?.spawned ? '🟢 Ha' : '🔴 Yo‘q'}`,
                        `🧠 Autonomous: ${state?.autonomousMode ? '🟢 ON' : '🔴 OFF'}`,
                        '',
                        `📨 Telegram chats: ${this.chatIds.size}`,
                        `🔌 Minecraft module: ${Boolean(minecraft)}`
                    ].join('\n')
                );
            }
        );

        /*
         * Barcha oddiy Telegram xabarlari
         */

        this.bot.on(
            'message',
            async message => {

                try {

                    if (
                        !message ||
                        !message.chat
                    ) {
                        return;
                    }

                    if (
                        message.from &&
                        message.from.is_bot
                    ) {
                        return;
                    }

                    const text =
                        message.text ||
                        message.caption ||
                        '';

                    if (!text.trim()) {
                        return;
                    }

                    /*
                     * /start /help /status kabi
                     * commandlarni yuqoridagi handlerlar bajaradi.
                     */

                    if (
                        text.startsWith('/')
                    ) {
                        return;
                    }

                    const chatId =
                        String(
                            message.chat.id
                        );

                    this.chatIds.add(
                        chatId
                    );

                    /*
                     * Permission
                     */

                    if (
                        !this.isAllowedUser(
                            message.from
                        )
                    ) {

                        await this.safeSend(
                            chatId,
                            '⛔ Sizga AI Agentni boshqarish ruxsati berilmagan.'
                        );

                        return;
                    }

                    /*
                     * COMMAND EXECUTOR
                     */

                    const executor =
                        context.get(
                            'command-executor'
                        );

                    if (
                        executor &&
                        typeof executor.handleExternal ===
                        'function'
                    ) {

                        const result =
                            await executor.handleExternal({

                                command:
                                    text.trim(),

                                source:
                                    'telegram',

                                channel:
                                    'telegram',

                                user:
                                    {
                                        id:
                                            message.from?.id,

                                        username:
                                            message.from?.username,

                                        name:
                                            [
                                                message.from?.first_name,
                                                message.from?.last_name
                                            ]
                                            .filter(Boolean)
                                            .join(' ')
                                    },

                                requestId:
                                    `tg-${Date.now()}-${message.message_id}`

                            });

                        const response =
                            executor.formatResponse
                                ? executor.formatResponse(result)
                                : null;

                        if (
                            response &&
                            response.text
                        ) {

                            await this.safeSend(
                                chatId,
                                response.text
                            );

                        } else if (
                            result &&
                            result.success
                        ) {

                            await this.safeSend(
                                chatId,
                                '✅ Buyruq bajarish uchun qabul qilindi.'
                            );

                        } else {

                            await this.safeSend(
                                chatId,
                                `❌ ${result?.error || 'Buyruq bajarilmadi.'}`
                            );
                        }

                        return;
                    }

                    /*
                     * Executor topilmasa router fallback.
                     */

                    const router =
                        context.get(
                            'command-router'
                        );

                    if (
                        router &&
                        typeof router.handle ===
                        'function'
                    ) {

                        const result =
                            await router.handle(
                                text.trim(),
                                'telegram',
                                {
                                    id:
                                        message.from?.id,

                                    username:
                                        message.from?.username
                                }
                            );

                        await this.safeSend(
                            chatId,
                            result?.success
                                ? '✅ Buyruq qabul qilindi.'
                                : `❌ ${result?.error || 'Buyruq bajarilmadi.'}`
                        );

                        return;
                    }

                    await this.safeSend(
                        chatId,
                        '❌ Command Executor topilmadi.'
                    );

                } catch (error) {

                    logger.error(
                        `Telegram command xatosi: ${error.message}`
                    );

                    await this.safeSend(
                        message.chat.id,
                        `❌ Xatolik: ${error.message}`
                    );
                }
            }
        );
    }

    isAllowedUser(user) {

        /*
         * Agar allowedUsers bo‘sh bo‘lsa,
         * hozircha barcha Telegram foydalanuvchilariga
         * ruxsat beriladi.
         */

        if (
            this.allowedUsers.size === 0
        ) {
            return true;
        }

        const values = [

            user?.id,

            user?.username,

            user?.first_name

        ]
        .filter(Boolean)
        .map(String);

        return values.some(
            value =>
                this.allowedUsers.has(value)
        );
    }

    async send(message) {

        if (!this.bot) {

            return {
                success: false,
                error:
                    'Telegram bot ishlamayapti.'
            };
        }

        const targets =
            message.chatId
                ? [String(message.chatId)]
                : [...this.chatIds];

        if (
            targets.length === 0
        ) {

            return {
                success: false,
                error:
                    'Telegram chat ID topilmadi.'
            };
        }

        const results = [];

        for (
            const chatId of targets
        ) {

            results.push(
                await this.safeSend(
                    chatId,
                    String(
                        message.text ||
                        message.message ||
                        ''
                    )
                )
            );
        }

        return {
            success: true,
            results
        };
    }

    async notify(text) {

        return this.send({
            text
        });
    }

    async safeSend(chatId, text) {

        if (!this.bot) {

            return {
                success: false
            };
        }

        try {

            const chunks =
                this.splitMessage(
                    String(text || '')
                );

            const results = [];

            for (
                const chunk of chunks
            ) {

                const result =
                    await this.bot.sendMessage(
                        chatId,
                        chunk,
                        {
                            disable_web_page_preview:
                                true
                        }
                    );

                results.push(
                    result
                );
            }

            return {
                success: true,
                results
            };

        } catch (error) {

            logger.warn(
                `Telegram xabar yuborilmadi: ${error.message}`
            );

            return {
                success: false,
                error:
                    error.message
            };
        }
    }

    splitMessage(text) {

        const limit = 3900;

        if (
            text.length <= limit
        ) {
            return [text];
        }

        const chunks = [];

        for (
            let i = 0;
            i < text.length;
            i += limit
        ) {

            chunks.push(
                text.slice(
                    i,
                    i + limit
                )
            );
        }

        return chunks;
    }

    getStatus() {

        return {

            running:
                this.running,

            connected:
                Boolean(this.bot),

            chats:
                this.chatIds.size,

            allowedUsers:
                this.allowedUsers.size
        };
    }
}

const telegramGateway =
    new TelegramGateway();

module.exports =
    telegramGateway;

module.exports.TelegramGateway =
    TelegramGateway;
