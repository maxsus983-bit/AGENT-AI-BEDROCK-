'use strict';

const context = require('../core/agent-context');
const logger = require('../core/logger');

class ActionEngine {

    constructor() {

        this.running = false;

        this.actions = new Map();

        this.history = [];

        this.maxHistory = 2000;

        this.registerBuiltInActions();
    }

    start() {

        this.running = true;

        logger.info(
            'Action Engine ishga tushdi.'
        );

        context.eventBus.emitSafe(
            'action:engine_started',
            {}
        );
    }

    stop() {

        this.running = false;

        context.eventBus.emitSafe(
            'action:engine_stopped',
            {}
        );
    }

    register(
        name,
        handler,
        options = {}
    ) {

        if (
            typeof name !== 'string' ||
            !name.trim()
        ) {
            throw new Error(
                'Action nomi noto‘g‘ri.'
            );
        }

        if (
            typeof handler !== 'function'
        ) {
            throw new Error(
                `Action handler noto‘g‘ri: ${name}`
            );
        }

        this.actions.set(
            name.toLowerCase(),
            {
                name:
                    name.toLowerCase(),

                handler,

                description:
                    options.description || '',

                dangerous:
                    Boolean(
                        options.dangerous
                    )
            }
        );
    }

    registerBuiltInActions() {

        /*
        AI tomonidan ishlatiladigan action nomlari.
        Hozir asosiy dispatcher tayyorlanadi.
        Real Minecraft implementatsiyalari keyingi
        modullarda ulanadi.
        */

        this.register(
            'chat',
            async action =>
                this.chat(
                    action
                ),
            {
                description:
                    'Minecraft chatiga yozish'
            }
        );

        this.register(
            'say',
            async action =>
                this.chat(
                    action
                ),
            {
                description:
                    'Minecraft chatiga xabar yuborish'
            }
        );

        this.register(
            'move',
            async action =>
                this.move(
                    action
                ),
            {
                description:
                    'Minecraft ichida harakat qilish'
            }
        );

        this.register(
            'goto',
            async action =>
                this.goto(
                    action
                ),
            {
                description:
                    'Berilgan koordinataga borish'
            }
        );

        this.register(
            'follow',
            async action =>
                this.follow(
                    action
                ),
            {
                description:
                    'Player yoki entityni kuzatib borish'
            }
        );

        this.register(
            'observe',
            async action =>
                this.observe(
                    action
                ),
            {
                description:
                    'Hudud yoki playerni kuzatish'
            }
        );

        this.register(
            'attack',
            async action =>
                this.attack(
                    action
                ),
            {
                description:
                    'Dushmanga hujum qilish',
                dangerous: true
            }
        );

        this.register(
            'build',
            async action =>
                this.build(
                    action
                ),
            {
                description:
                    'Qurilish vazifasini boshlash'
            }
        );

        this.register(
            'stop',
            async action =>
                this.stopAction(
                    action
                ),
            {
                description:
                    'Joriy harakatni to‘xtatish'
            }
        );

        this.register(
            'wait',
            async action =>
                this.wait(
                    action
                ),
            {
                description:
                    'Kutish'
            }
        );
    }

    async execute(action) {

        if (!action) {

            return {
                success: false,
                error:
                    'Action berilmagan.'
            };
        }

        const normalized =
            this.normalizeAction(
                action
            );

        const handler =
            this.actions.get(
                normalized.type
            );

        if (!handler) {

            logger.warn(
                `Noma'lum action: ${normalized.type}`
            );

            return {

                success: false,

                error:
                    `Noma'lum action: ${normalized.type}`,

                action:
                    normalized
            };
        }

        const startedAt =
            Date.now();

        context.state.actionStarted();

        context.eventBus.emitSafe(
            'action:started',
            {
                action:
                    normalized
            }
        );

        try {

            logger.info(
                `Action bajarilmoqda: ${normalized.type}`
            );

            const result =
                await handler.handler(
                    normalized
                );

            const response = {

                success:
                    result?.success !== false,

                type:
                    normalized.type,

                action:
                    normalized,

                result:
                    result || null,

                duration:
                    Date.now() -
                    startedAt
            };

            this.addHistory(
                response
            );

            context.eventBus.emitSafe(
                'action:completed',
                response
            );

            return response;

        } catch (error) {

            const response = {

                success: false,

                type:
                    normalized.type,

                action:
                    normalized,

                error:
                    error.message,

                duration:
                    Date.now() -
                    startedAt
            };

            this.addHistory(
                response
            );

            context.eventBus.emitSafe(
                'action:failed',
                response
            );

            logger.error(
                `Action xatosi: ${normalized.type}`,
                {
                    error:
                        error.message
                }
            );

            return response;

        } finally {

            context.state.actionFinished();
        }
    }

    normalizeAction(action) {

        if (
            typeof action === 'string'
        ) {

            return {
                type:
                    action.toLowerCase(),

                args: {}
            };
        }

        const type =
            String(
                action.type ||
                action.action ||
                action.name ||
                ''
            )
                .trim()
                .toLowerCase();

        return {

            ...action,

            type,

            args:
                action.args &&
                typeof action.args ===
                    'object'
                    ? action.args
                    : {}
        };
    }

    async executeMany(
        actions
    ) {

        if (
            !Array.isArray(actions)
        ) {

            return [];
        }

        const results = [];

        for (
            const action of actions
        ) {

            const result =
                await this.execute(
                    action
                );

            results.push(
                result
            );

            /*
            Agar action jiddiy xato bilan tugasa,
            qolgan actionlarni avtomatik davom ettirmaymiz.
            */

            if (
                result.success === false &&
                action.stopOnFailure !== false
            ) {

                break;
            }
        }

        return results;
    }

    async chat(action) {

        const client =
            context.get(
                'minecraft-client'
            );

        if (!client) {

            return {

                success: false,

                error:
                    'Minecraft Client ulanmagan.'
            };
        }

        const message =
            action.message ||
            action.text ||
            action.args?.message ||
            action.args?.text;

        if (
            typeof message !== 'string' ||
            !message.trim()
        ) {

            return {

                success: false,

                error:
                    'Chat xabari berilmagan.'
            };
        }

        const sent =
            client.sendChat(
                message
                    .trim()
                    .slice(0, 512)
            );

        return {

            success:
                Boolean(sent),

            message:
                message.trim()
        };
    }

    async move(action) {

        const movement =
            context.get(
                'movement'
            );

        if (!movement) {

            return {

                success: false,

                error:
                    'Movement Engine hali ulanmagan.'
            };
        }

        if (
            typeof movement.execute !==
            'function'
        ) {

            return {

                success: false,

                error:
                    'Movement Engine noto‘g‘ri.'
            };
        }

        return movement.execute(
            action
        );
    }

    async goto(action) {

        const movement =
            context.get(
                'movement'
            );

        if (!movement) {

            return {

                success: false,

                error:
                    'Movement Engine hali ulanmagan.'
            };
        }

        if (
            typeof movement.goto !==
            'function'
        ) {

            return {

                success: false,

                error:
                    'goto funksiyasi mavjud emas.'
            };
        }

        const x =
            action.x ??
            action.args?.x;

        const y =
            action.y ??
            action.args?.y;

        const z =
            action.z ??
            action.args?.z;

        return movement.goto(
            x,
            y,
            z
        );
    }

    async follow(action) {

        const movement =
            context.get(
                'movement'
            );

        if (!movement) {

            return {

                success: false,

                error:
                    'Movement Engine hali ulanmagan.'
            };
        }

        if (
            typeof movement.follow !==
            'function'
        ) {

            return {

                success: false,

                error:
                    'Follow funksiyasi mavjud emas.'
            };
        }

        const target =
            action.target ||
            action.player ||
            action.args?.target ||
            action.args?.player;

        return movement.follow(
            target
        );
    }

    async observe(action) {

        const observer =
            context.get(
                'world-observer'
            );

        if (!observer) {

            return {

                success: false,

                error:
                    'World Observer ulanmagan.'
            };
        }

        if (
            typeof observer.observe !==
            'function'
        ) {

            /*
            Observer boshqa nom bilan ishlashi mumkin.
            State orqali kuzatuv holatini belgilaymiz.
            */

            context.state.startObservation(
                action.target ||
                action.player ||
                null,

                Boolean(
                    action.hidden ||
                    action.args?.hidden
                )
            );

            return {

                success: true,

                observing: true,

                target:
                    action.target ||
                    action.player ||
                    null
            };
        }

        return observer.observe(
            action
        );
    }

    async attack(action) {

        const combat =
            context.get(
                'combat'
            );

        if (!combat) {

            return {

                success: false,

                error:
                    'Combat Engine hali ulanmagan.'
            };
        }

        if (
            typeof combat.attack !==
            'function'
        ) {

            return {

                success: false,

                error:
                    'Combat Engine attack funksiyasiga ega emas.'
            };
        }

        const target =
            action.target ||
            action.player ||
            action.entity ||
            action.args?.target ||
            action.args?.player ||
            action.args?.entity;

        if (!target) {

            return {

                success: false,

                error:
                    'Jang nishoni aniqlanmagan.'
            };
        }

        context.state.startCombat(
            target
        );

        try {

            return await combat.attack(
                target,
                action
            );

        } finally {

            context.state.stopCombat();
        }
    }

    async build(action) {

        const builder =
            context.get(
                'builder'
            );

        if (!builder) {

            return {

                success: false,

                error:
                    'Build Engine hali ulanmagan.'
            };
        }

        if (
            typeof builder.build !==
            'function'
        ) {

            return {

                success: false,

                error:
                    'Build Engine build funksiyasiga ega emas.'
            };
        }

        return builder.build(
            action
        );
    }

    async stopAction(action) {

        const movement =
            context.get(
                'movement'
            );

        const combat =
            context.get(
                'combat'
            );

        let stopped = false;

        if (
            movement &&
            typeof movement.stop ===
                'function'
        ) {

            try {

                await movement.stop();

                stopped = true;

            } catch (_) {}
        }

        if (
            combat &&
            typeof combat.stop ===
                'function'
        ) {

            try {

                await combat.stop();

                stopped = true;

            } catch (_) {}
        }

        context.state.clearTask();

        context.state.stopCombat();

        return {

            success: true,

            stopped
        };
    }

    async wait(action) {

        const seconds =
            Number(
                action.seconds ||
                action.duration ||
                action.args?.seconds ||
                action.args?.duration ||
                1
            );

        const safeSeconds =
            Math.min(
                Math.max(
                    seconds,
                    0
                ),
                300
            );

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    safeSeconds * 1000
                )
        );

        return {

            success: true,

            waited:
                safeSeconds
        };
    }

    addHistory(result) {

        this.history.push({

            timestamp:
                Date.now(),

            result
        });

        if (
            this.history.length >
            this.maxHistory
        ) {

            this.history.shift();
        }
    }

    getHistory(
        limit = 50
    ) {

        return this.history.slice(
            -Math.max(
                1,
                Number(limit) || 50
            )
        );
    }

    getAvailableActions() {

        return Array.from(
            this.actions.values()
        )
            .map(
                action => ({
                    name:
                        action.name,

                    description:
                        action.description,

                    dangerous:
                        action.dangerous
                })
            );
    }

    status() {

        return {

            running:
                this.running,

            availableActions:
                this.getAvailableActions(),

            historySize:
                this.history.length
        };
    }
}

const actionEngine =
    new ActionEngine();

module.exports =
    actionEngine;

module.exports.ActionEngine =
    ActionEngine;
