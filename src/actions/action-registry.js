'use strict';

const context = require('../core/agent-context');
const logger = require('../core/logger');

class ActionRegistry {

    constructor() {
        this.actions = new Map();
        this.aliases = new Map();
        this.running = false;

        context.register('action-registry', this);
    }

    start() {
        if (this.running) return;

        this.running = true;

        this.registerDefaults();

        logger.info(
            'Action Registry ishga tushdi.'
        );
    }

    stop() {
        this.running = false;
    }

    register(name, handler, options = {}) {

        if (!name || typeof handler !== 'function') {
            throw new Error(
                'Action nomi va handler majburiy.'
            );
        }

        const normalized =
            this.normalize(name);

        this.actions.set(
            normalized,
            {
                name: normalized,
                handler,
                description:
                    options.description || '',
                category:
                    options.category || 'general',
                dangerous:
                    Boolean(options.dangerous),
                aliases:
                    options.aliases || []
            }
        );

        for (
            const alias of
            options.aliases || []
        ) {
            this.aliases.set(
                this.normalize(alias),
                normalized
            );
        }

        return true;
    }

    unregister(name) {

        const normalized =
            this.normalize(name);

        const action =
            this.actions.get(
                normalized
            );

        if (!action) {
            return false;
        }

        this.actions.delete(
            normalized
        );

        for (
            const alias of
            action.aliases
        ) {
            this.aliases.delete(
                this.normalize(alias)
            );
        }

        return true;
    }

    resolve(name) {

        const normalized =
            this.normalize(name);

        if (
            this.actions.has(
                normalized
            )
        ) {
            return this.actions.get(
                normalized
            );
        }

        const target =
            this.aliases.get(
                normalized
            );

        if (!target) {
            return null;
        }

        return this.actions.get(
            target
        ) || null;
    }

    async execute(
        name,
        payload = {},
        metadata = {}
    ) {

        const action =
            this.resolve(name);

        if (!action) {

            return {
                success: false,
                error:
                    `Noma'lum action: ${name}`
            };
        }

        const started =
            Date.now();

        const request = {

            action:
                action.name,

            payload,

            metadata,

            timestamp:
                started
        };

        context.eventBus.emitSafe(
            'action:started',
            request
        );

        try {

            const result =
                await action.handler(
                    payload,
                    request
                );

            const response = {

                success:
                    result?.success !== false,

                action:
                    action.name,

                result:
                    result ?? null,

                duration:
                    Date.now() - started
            };

            context.eventBus.emitSafe(
                'action:completed',
                response
            );

            return response;

        } catch (error) {

            logger.error(
                `Action "${action.name}" xatosi: ${error.message}`
            );

            const response = {

                success: false,

                action:
                    action.name,

                error:
                    error.message,

                duration:
                    Date.now() - started
            };

            context.eventBus.emitSafe(
                'action:failed',
                response
            );

            return response;
        }
    }

    async executeObject(
        command = {},
        metadata = {}
    ) {

        if (!command) {
            return {
                success: false,
                error: 'Bo‘sh command.'
            };
        }

        const action =
            command.action ||
            command.type ||
            command.command ||
            command.name;

        if (!action) {
            return {
                success: false,
                error:
                    'Command ichida action topilmadi.'
            };
        }

        const payload = {
            ...command
        };

        delete payload.action;
        delete payload.type;
        delete payload.command;
        delete payload.name;

        return this.execute(
            action,
            payload,
            metadata
        );
    }

    registerDefaults() {

        this.register(
            'move',
            async payload => {

                const movement =
                    this.get(
                        'movement-engine'
                    ) ||
                    this.get(
                        'movement'
                    );

                if (!movement) {
                    return {
                        success: false,
                        error:
                            'Movement Engine topilmadi.'
                    };
                }

                if (
                    typeof movement.execute ===
                    'function'
                ) {
                    return movement.execute(
                        payload
                    );
                }

                return {
                    success: false,
                    error:
                        'Movement Engine execute() ga ega emas.'
                };
            },
            {
                category: 'movement',
                aliases: [
                    'yur',
                    'bor',
                    'go',
                    'walk',
                    'move_to'
                ]
            }
        );

        this.register(
            'fight',
            async payload => {

                const combat =
                    this.get(
                        'combat-engine'
                    ) ||
                    this.get(
                        'combat'
                    );

                if (!combat) {
                    return {
                        success: false,
                        error:
                            'Combat Engine topilmadi.'
                    };
                }

                return combat.execute(
                    {
                        ...payload,
                        type: 'fight'
                    }
                );
            },
            {
                category: 'combat',
                dangerous: true,
                aliases: [
                    'jang',
                    'attack',
                    'ur',
                    'hujum'
                ]
            }
        );

        this.register(
            'auto_fight',
            async payload => {

                const combat =
                    this.get(
                        'combat-engine'
                    ) ||
                    this.get(
                        'combat'
                    );

                if (!combat) {
                    return {
                        success: false,
                        error:
                            'Combat Engine topilmadi.'
                    };
                }

                return combat.execute(
                    {
                        ...payload,
                        type:
                            'auto_fight'
                    }
                );
            },
            {
                category: 'combat',
                dangerous: true,
                aliases: [
                    'avto_jang',
                    'auto fight',
                    'avtomatik jang'
                ]
            }
        );

        this.register(
            'build',
            async payload => {

                const builder =
                    this.get(
                        'build-engine'
                    ) ||
                    this.get(
                        'builder'
                    );

                if (!builder) {
                    return {
                        success: false,
                        error:
                            'Build Engine topilmadi.'
                    };
                }

                if (
                    typeof builder.execute ===
                    'function'
                ) {
                    return builder.execute(
                        payload
                    );
                }

                return {
                    success: false,
                    error:
                        'Build Engine execute() ga ega emas.'
                };
            },
            {
                category: 'building',
                aliases: [
                    'qur',
                    'build_structure',
                    'construct'
                ]
            }
        );

        this.register(
            'watch',
            async payload => {

                const observer =
                    this.get(
                        'player-tracker'
                    );

                if (!observer) {
                    return {
                        success: false,
                        error:
                            'Player Tracker topilmadi.'
                    };
                }

                return observer.execute(
                    {
                        ...payload,
                        type: 'watch'
                    }
                );
            },
            {
                category: 'observation',
                aliases: [
                    'kuzat',
                    'playerni_kuzat',
                    'watch_player'
                ]
            }
        );

        this.register(
            'watch_hidden',
            async payload => {

                const observer =
                    this.get(
                        'player-tracker'
                    );

                if (!observer) {
                    return {
                        success: false,
                        error:
                            'Player Tracker topilmadi.'
                    };
                }

                return observer.execute(
                    {
                        ...payload,
                        type:
                            'watch_hidden'
                    }
                );
            },
            {
                category: 'observation',
                aliases: [
                    'yashirin_kuzat',
                    'hidden_watch'
                ]
            }
        );

        this.register(
            'watch_all',
            async payload => {

                const observer =
                    this.get(
                        'player-tracker'
                    );

                if (!observer) {
                    return {
                        success: false,
                        error:
                            'Player Tracker topilmadi.'
                    };
                }

                return observer.execute(
                    {
                        ...payload,
                        type:
                            'watch_all'
                    }
                );
            },
            {
                category: 'observation',
                aliases: [
                    'hammani_kuzat',
                    'all_players'
                ]
            }
        );

        this.register(
            'chat',
            async payload => {

                const client =
                    this.get(
                        'minecraft-client'
                    ) ||
                    this.get(
                        'client'
                    );

                if (!client) {
                    return {
                        success: false,
                        error:
                            'Minecraft Client topilmadi.'
                    };
                }

                if (
                    typeof client.chat ===
                    'function'
                ) {

                    return client.chat(
                        payload.message ||
                        payload.text ||
                        ''
                    );
                }

                return {
                    success: false,
                    error:
                        'Minecraft Client chat() ga ega emas.'
                };
            },
            {
                category: 'communication',
                aliases: [
                    'yoz',
                    'chatga_yoz',
                    'say',
                    'message'
                ]
            }
        );

        this.register(
            'stop',
            async payload => {

                const movement =
                    this.get(
                        'movement-engine'
                    );

                if (
                    movement &&
                    typeof movement.stop ===
                    'function'
                ) {
                    await movement.stop();
                }

                const combat =
                    this.get(
                        'combat-engine'
                    );

                if (
                    combat &&
                    typeof combat.stopCombat ===
                    'function'
                ) {
                    await combat.stopCombat();
                }

                return {
                    success: true,
                    message:
                        'Joriy harakatlar to‘xtatildi.'
                };
            },
            {
                category: 'control',
                aliases: [
                    'toxta',
                    'to‘xta',
                    'cancel',
                    'bekor_qil'
                ]
            }
        );

        this.register(
            'status',
            async () => {

                const modules = {};

                const names = [

                    'movement-engine',
                    'combat-engine',
                    'build-engine',
                    'player-tracker',
                    'world-observer',
                    'minecraft-client',
                    'memory',
                    'ai-brain'
                ];

                for (
                    const name of names
                ) {

                    const module =
                        this.get(
                            name
                        );

                    if (!module) {
                        modules[name] =
                            null;
                        continue;
                    }

                    if (
                        typeof module.status ===
                        'function'
                    ) {

                        modules[name] =
                            module.status();

                    } else {

                        modules[name] =
                            'available';
                    }
                }

                return {

                    success: true,

                    modules
                };
            },
            {
                category: 'system',
                aliases: [
                    'holat',
                    'status',
                    'tekshir'
                ]
            }
        );
    }

    get(name) {

        return context.get(
            name
        );
    }

    list() {

        return Array.from(
            this.actions.values()
        ).map(
            action => ({

                name:
                    action.name,

                description:
                    action.description,

                category:
                    action.category,

                dangerous:
                    action.dangerous,

                aliases:
                    action.aliases
            })
        );
    }

    categories() {

        const result = {};

        for (
            const action of
            this.actions.values()
        ) {

            if (
                !result[action.category]
            ) {
                result[action.category] =
                    [];
            }

            result[action.category].push(
                action.name
            );
        }

        return result;
    }

    normalize(value) {

        return String(
            value || ''
        )
            .trim()
            .toLowerCase()
            .replace(
                /[‘’']/g,
                ''
            )
            .replace(
                /\s+/g,
                '_'
            );
    }

    status() {

        return {

            running:
                this.running,

            actions:
                this.actions.size,

            aliases:
                this.aliases.size,

            categories:
                this.categories()
        };
    }
}

const registry =
    new ActionRegistry();

module.exports =
    registry;

module.exports.ActionRegistry =
    ActionRegistry;
