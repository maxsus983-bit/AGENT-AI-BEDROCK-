'use strict';

const context = require('../core/agent-context');
const logger = require('../core/logger');

class NotificationManager {

    constructor(options = {}) {

        this.name =
            'notification-manager';

        this.running = false;

        this.gateway = null;

        this.queue = [];

        this.history = [];

        this.maxHistory =
            Number(
                options.maxHistory || 10000
            );

        this.maxQueue =
            Number(
                options.maxQueue || 5000
            );

        this.defaultPriority =
            Number(
                options.defaultPriority || 3
            );

        this.defaultMode =
            options.mode ||
            'important';

        this.subscriptions = new Map();

        this.filters = {

            enabled:
                options.filters?.enabled !== false,

            players:
                options.filters?.players ||
                null,

            eventTypes:
                options.filters?.eventTypes ||
                null,

            minimumPriority:
                Number(
                    options.filters?.minimumPriority ||
                    1
                )
        };

        this.stats = {

            received: 0,

            queued: 0,

            sent: 0,

            dropped: 0,

            failed: 0
        };

        context.register(
            'notification-manager',
            this
        );
    }

    start() {

        if (
            this.running
        ) {

            return {
                success: true,
                alreadyRunning: true
            };
        }

        this.running = true;

        this.gateway =
            context.get(
                'message-gateway'
            );

        this.attachEventBus();

        logger.info(
            'Notification Manager ishga tushdi.'
        );

        return {
            success: true
        };
    }

    stop() {

        this.running = false;

        return {
            success: true
        };
    }

    attachEventBus() {

        const bus =
            context.eventBus;

        if (
            !bus ||
            typeof bus.on !==
            'function'
        ) {

            return;
        }

        /*
         * Minecraft kuzatuv eventlari.
         */

        const events = [

            'chat:message',

            'chat',

            'player:joined',

            'player:left',

            'player:move',

            'player:action',

            'player:damage',

            'player:death',

            'combat:start',

            'combat:hit',

            'combat:end',

            'block:placed',

            'block:broken',

            'entity:spawned',

            'entity:removed',

            'entity:detected',

            'world:change',

            'observer:event',

            'observation',

            'bot:action',

            'bot:status',

            'task:start',

            'task:progress',

            'task:complete',

            'task:failed',

            'command:executed'
        ];

        for (
            const event of
            events
        ) {

            bus.on(
                event,
                data => {

                    this.handleEvent(
                        event,
                        data
                    );
                }
            );
        }
    }

    handleEvent(
        event,
        data
    ) {

        if (
            !this.running
        ) {

            this.start();
        }

        this.stats.received++;

        const notification =
            this.createNotification(
                event,
                data
            );

        if (
            !this.shouldNotify(
                notification
            )
        ) {

            return {
                success: true,
                skipped: true
            };
        }

        return this.enqueue(
            notification
        );
    }

    createNotification(
        event,
        data = {}
    ) {

        const normalized =
            this.normalizeEvent(
                event,
                data
            );

        const priority =
            this.calculatePriority(
                normalized
            );

        const text =
            this.buildText(
                normalized
            );

        return {

            id:
                this.generateId(),

            event:
                normalized.event,

            category:
                normalized.category,

            priority,

            text,

            timestamp:
                Date.now(),

            player:
                normalized.player,

            position:
                normalized.position,

            data:
                normalized.data
        };
    }

    normalizeEvent(
        event,
        data
    ) {

        const player =
            data.player ||
            data.playerName ||
            data.username ||
            data.sender ||
            null;

        const position =
            data.position ||
            data.location ||
            data.pos ||
            null;

        let category =
            'system';

        if (
            String(event)
                .includes(
                    'chat'
                )
        ) {

            category =
                'chat';

        } else if (
            String(event)
                .includes(
                    'combat'
                ) ||
            String(event)
                .includes(
                    'damage'
                )
        ) {

            category =
                'combat';

        } else if (
            String(event)
                .includes(
                    'block'
                )
        ) {

            category =
                'building';

        } else if (
            String(event)
                .includes(
                    'player'
                )
        ) {

            category =
                'player';

        } else if (
            String(event)
                .includes(
                    'entity'
                )
        ) {

            category =
                'entity';

        } else if (
            String(event)
                .includes(
                    'task'
                )
        ) {

            category =
                'task';

        } else if (
            String(event)
                .includes(
                    'bot'
                )
        ) {

            category =
                'bot';
        }

        return {

            event:
                String(
                    event ||
                    'unknown'
                ),

            category,

            player,

            position,

            data:
                data || {}
        };
    }

    calculatePriority(
        event
    ) {

        const name =
            event.event.toLowerCase();

        /*
         * 5 = juda muhim
         * 4 = muhim
         * 3 = oddiy
         * 2 = past
         * 1 = juda past
         */

        if (
            name.includes(
                'death'
            ) ||
            name.includes(
                'failed'
            )
        ) {

            return 5;
        }

        if (
            name.includes(
                'combat'
            ) ||
            name.includes(
                'damage'
            ) ||
            name.includes(
                'joined'
            ) ||
            name.includes(
                'left'
            ) ||
            name.includes(
                'command'
            )
        ) {

            return 4;
        }

        if (
            name.includes(
                'chat'
            ) ||
            name.includes(
                'task'
            ) ||
            name.includes(
                'block'
            )
        ) {

            return 3;
        }

        if (
            name.includes(
                'move'
            )
        ) {

            return 1;
        }

        return this.defaultPriority;
    }

    shouldNotify(
        notification
    ) {

        if (
            !this.filters.enabled
        ) {

            return false;
        }

        if (
            notification.priority <
            this.filters.minimumPriority
        ) {

            return false;
        }

        if (
            Array.isArray(
                this.filters.eventTypes
            ) &&
            this.filters.eventTypes.length
        ) {

            if (
                !this.filters.eventTypes.includes(
                    notification.event
                )
            ) {

                return false;
            }
        }

        if (
            Array.isArray(
                this.filters.players
            ) &&
            this.filters.players.length &&
            notification.player
        ) {

            if (
                !this.filters.players.includes(
                    notification.player
                )
            ) {

                return false;
            }
        }

        return true;
    }

    enqueue(
        notification
    ) {

        if (
            this.queue.length >=
            this.maxQueue
        ) {

            /*
             * Past prioritydagi xabarlarni
             * birinchi tashlaymiz.
             */

            const lowIndex =
                this.queue.findIndex(
                    item =>
                        item.priority <=
                        2
                );

            if (
                lowIndex >= 0
            ) {

                this.queue.splice(
                    lowIndex,
                    1
                );

            } else {

                this.stats.dropped++;

                return {

                    success: false,

                    dropped: true,

                    reason:
                        'Notification queue to‘ldi.'
                };
            }
        }

        this.queue.push(
            notification
        );

        this.queue.sort(
            (a, b) => {

                if (
                    b.priority !==
                    a.priority
                ) {

                    return (
                        b.priority -
                        a.priority
                    );
                }

                return (
                    a.timestamp -
                    b.timestamp
                );
            }
        );

        this.stats.queued++;

        this.emit(
            'notification:queued',
            notification
        );

        /*
         * Yuqori priority xabarlar
         * darhol yuboriladi.
         */

        if (
            notification.priority >=
            4
        ) {

            this.flush();
        }

        return {
            success: true,
            queued: true
        };
    }

    async flush() {

        if (
            !this.queue.length
        ) {

            return {
                success: true,
                sent: 0
            };
        }

        const batch =
            this.queue.splice(
                0,
                this.queue.length
            );

        let sent = 0;

        for (
            const notification of
            batch
        ) {

            try {

                const result =
                    await this.send(
                        notification
                    );

                if (
                    result.success
                ) {

                    sent++;

                    this.stats.sent++;

                    this.history.push(
                        notification
                    );

                } else {

                    this.stats.failed++;
                }

            } catch (error) {

                this.stats.failed++;

                logger.warn(
                    `Notification yuborish xatosi: ${error.message}`
                );
            }
        }

        this.trimHistory();

        return {

            success: true,

            sent
        };
    }

    async send(
        notification
    ) {

        if (
            !this.gateway
        ) {

            this.gateway =
                context.get(
                    'message-gateway'
                );
        }

        if (
            !this.gateway
        ) {

            /*
             * Gateway ulanmagan bo‘lsa,
             * event sifatida chiqaramiz.
             */

            this.emit(
                'notification',
                notification
            );

            return {

                success: true,

                queued:
                    true
            };
        }

        /*
         * Standart kanal:
         * tashqi gateway qaysi kanallarni bilsa,
         * o‘sha kanallarga yuboriladi.
         */

        const channels =
            this.getTargetChannels();

        if (
            !channels.length
        ) {

            this.emit(
                'notification',
                notification
            );

            return {

                success: true,

                queued:
                    true
            };
        }

        const results = [];

        for (
            const channel of
            channels
        ) {

            const result =
                await this.gateway.send(
                    channel,
                    notification.text,
                    {

                        type:
                            notification.category,

                        event:
                            notification.event,

                        priority:
                            notification.priority,

                        notificationId:
                            notification.id,

                        timestamp:
                            notification.timestamp
                    }
                );

            results.push({

                channel,

                result
            });
        }

        this.emit(
            'notification:sent',
            {

                notification,

                results
            }
        );

        return {

            success:
                results.every(
                    item =>
                        item.result?.success !== false
                ),

            results
        };
    }

    getTargetChannels() {

        /*
         * Keyinchalik config orqali:
         *
         * telegram
         * github
         * web
         *
         * kabi kanallar belgilanadi.
         */

        const configured =
            context.get(
                'notification-channels'
            );

        if (
            Array.isArray(
                configured
            )
        ) {

            return configured;
        }

        /*
         * Gatewaydagi barcha kanallar.
         */

        if (
            this.gateway &&
            typeof this.gateway.getChannels ===
            'function'
        ) {

            return this.gateway
                .getChannels()
                .filter(
                    item =>
                        item.enabled
                )
                .map(
                    item =>
                        item.name
                );
        }

        return [];
    }

    buildText(
        event
    ) {

        const data =
            event.data ||
            {};

        const player =
            event.player
                ? String(
                    event.player
                )
                : null;

        const position =
            this.formatPosition(
                event.position
            );

        switch (
            event.event
        ) {

            case 'chat:message':

            case 'chat':

                return (
                    `💬 ${player || 'Player'}: ` +
                    `${data.message || data.text || ''}`
                );

            case 'player:joined':

                return (
                    `🟢 ${player || 'Player'} serverga kirdi.` +
                    (position
                        ? ` Joylashuvi: ${position}`
                        : '')
                );

            case 'player:left':

                return (
                    `🔴 ${player || 'Player'} serverdan chiqdi.`
                );

            case 'player:move':

                return (
                    `🚶 ${player || 'Player'} harakatlandi` +
                    (position
                        ? ` → ${position}`
                        : '.')
                );

            case 'player:damage':

            case 'combat:hit':

                return (
                    `⚔️ ${player || 'Player'} zarba berdi/oldi.` +
                    this.describeCombat(
                        data
                    )
                );

            case 'combat:start':

                return (
                    `⚔️ JANG BOSHLANDI: ` +
                    `${this.describeParticipants(
                        data
                    )}`
                );

            case 'combat:end':

                return (
                    `🏁 Jang tugadi.` +
                    this.describeCombat(
                        data
                    )
                );

            case 'player:death':

                return (
                    `💀 ${player || 'Player'} halok bo‘ldi.`
                );

            case 'block:placed':

                return (
                    `🧱 ${player || 'Player'} ` +
                    `${data.block ||
                     data.blockType ||
                     'block'} qo‘ydi` +
                    (position
                        ? ` ${position}`
                        : '')
                );

            case 'block:broken':

                return (
                    `⛏️ ${player || 'Player'} ` +
                    `${data.block ||
                     data.blockType ||
                     'block'} buzdi` +
                    (position
                        ? ` ${position}`
                        : '')
                );

            case 'entity:spawned':

                return (
                    `🐾 Entity paydo bo‘ldi: ` +
                    `${data.entity ||
                     data.type ||
                     'noma’lum'}` +
                    (position
                        ? ` ${position}`
                        : '')
                );

            case 'entity:removed':

                return (
                    `🐾 Entity yo‘qoldi: ` +
                    `${data.entity ||
                     data.type ||
                     'noma’lum'}`
                );

            case 'entity:detected':

                return (
                    `👁️ Entity aniqlandi: ` +
                    `${data.entity ||
                     data.type ||
                     'noma’lum'}` +
                    (position
                        ? ` ${position}`
                        : '')
                );

            case 'task:start':

                return (
                    `🎯 Vazifa boshlandi: ` +
                    `${data.task ||
                     data.name ||
                     'noma’lum'}`
                );

            case 'task:progress':

                return (
                    `🔄 Vazifa davom etmoqda: ` +
                    `${data.task ||
                     data.name ||
                     'noma’lum'}` +
                    (
                        data.progress !==
                        undefined
                            ? ` (${data.progress}%)`
                            : ''
                    )
                );

            case 'task:complete':

                return (
                    `✅ Vazifa tugadi: ` +
                    `${data.task ||
                     data.name ||
                     'noma’lum'}`
                );

            case 'task:failed':

                return (
                    `❌ Vazifa bajarilmadi: ` +
                    `${data.task ||
                     data.name ||
                     'noma’lum'}` +
                    (
                        data.error
                            ? ` — ${data.error}`
                            : ''
                    )
                );

            case 'bot:action':

                return (
                    `🤖 Bot: ` +
                    `${data.action ||
                     data.description ||
                     'harakat bajaryapti'}` +
                    (position
                        ? ` | ${position}`
                        : '')
                );

            case 'bot:status':

                return (
                    `🤖 Bot holati: ` +
                    `${data.status ||
                     data.state ||
                     'noma’lum'}`
                );

            case 'command:executed':

                return (
                    `📨 Buyruq bajarildi: ` +
                    `${data.command ||
                     'noma’lum'}`
                );

            default:

                return (
                    `ℹ️ ${event.event}: ` +
                    `${this.summarize(
                        data
                    )}`
                );
        }
    }

    describeParticipants(
        data
    ) {

        const attacker =
            data.attacker ||
            data.source ||
            null;

        const target =
            data.target ||
            data.victim ||
            null;

        if (
            attacker &&
            target
        ) {

            return (
                `${attacker} ⚔️ ${target}`
            );
        }

        return '';
    }

    describeCombat(
        data
    ) {

        const attacker =
            data.attacker ||
            null;

        const target =
            data.target ||
            data.victim ||
            null;

        const damage =
            data.damage;

        let text = '';

        if (
            attacker &&
            target
        ) {

            text +=
                ` ${attacker} → ${target}`;
        }

        if (
            damage !==
            undefined
        ) {

            text +=
                ` | damage: ${damage}`;
        }

        return text;
    }

    formatPosition(
        position
    ) {

        if (!position) {
            return '';
        }

        const x =
            Number(
                position.x
            );

        const y =
            Number(
                position.y
            );

        const z =
            Number(
                position.z
            );

        if (
            Number.isFinite(x) &&
            Number.isFinite(y) &&
            Number.isFinite(z)
        ) {

            return (
                `X:${Math.round(x)} ` +
                `Y:${Math.round(y)} ` +
                `Z:${Math.round(z)}`
            );
        }

        return '';
    }

    summarize(
        data
    ) {

        try {

            const text =
                JSON.stringify(
                    data
                );

            if (
                text.length <= 500
            ) {

                return text;
            }

            return (
                text.slice(
                    0,
                    497
                ) +
                '...'
            );

        } catch (_) {

            return String(
                data
            );
        }
    }

    subscribe(
        name,
        callback,
        options = {}
    ) {

        if (
            typeof callback !==
            'function'
        ) {

            throw new Error(
                'Notification callback function bo‘lishi kerak.'
            );
        }

        const id =
            name ||
            this.generateId();

        this.subscriptions.set(
            id,
            {

                callback,

                minimumPriority:
                    Number(
                        options.minimumPriority ||
                        1
                    ),

                events:
                    options.events ||
                    null
            }
        );

        return id;
    }

    unsubscribe(
        id
    ) {

        return this.subscriptions.delete(
            id
        );
    }

    notifySubscribers(
        notification
    ) {

        for (
            const [
                id,
                subscription
            ] of
            this.subscriptions
        ) {

            if (
                notification.priority <
                subscription.minimumPriority
            ) {

                continue;
            }

            if (
                Array.isArray(
                    subscription.events
                ) &&
                subscription.events.length &&
                !subscription.events.includes(
                    notification.event
                )
            ) {

                continue;
            }

            try {

                subscription.callback(
                    notification
                );

            } catch (error) {

                logger.warn(
                    `Notification subscriber ${id} xatosi: ${error.message}`
                );
            }
        }
    }

    trimHistory() {

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

    getQueue(
        limit = 100
    ) {

        return this.queue
            .slice(
                0,
                Math.max(
                    1,
                    Number(limit) || 100
                )
            );
    }

    setFilter(
        name,
        value
    ) {

        if (
            !Object.prototype.hasOwnProperty.call(
                this.filters,
                name
            )
        ) {

            return {

                success: false,

                error:
                    `Filter topilmadi: ${name}`
            };
        }

        this.filters[name] =
            value;

        return {
            success: true
        };
    }

    setMode(
        mode
    ) {

        const allowed = [

            'all',

            'important',

            'critical',

            'chat',

            'combat',

            'tasks'
        ];

        if (
            !allowed.includes(
                mode
            )
        ) {

            return {

                success: false,

                error:
                    `Noto‘g‘ri notification mode: ${mode}`
            };
        }

        this.defaultMode =
            mode;

        switch (
            mode
        ) {

            case 'all':

                this.filters.minimumPriority =
                    1;

                break;

            case 'important':

                this.filters.minimumPriority =
                    3;

                break;

            case 'critical':

                this.filters.minimumPriority =
                    5;

                break;

            case 'chat':

                this.filters.minimumPriority =
                    3;

                this.filters.eventTypes =
                    [
                        'chat:message',
                        'chat'
                    ];

                break;

            case 'combat':

                this.filters.minimumPriority =
                    4;

                this.filters.eventTypes =
                    [
                        'combat:start',
                        'combat:hit',
                        'combat:end',
                        'player:damage',
                        'player:death'
                    ];

                break;

            case 'tasks':

                this.filters.minimumPriority =
                    3;

                this.filters.eventTypes =
                    [
                        'task:start',
                        'task:progress',
                        'task:complete',
                        'task:failed'
                    ];

                break;
        }

        return {
            success: true,
            mode
        };
    }

    async sendCustom(
        message,
        options = {}
    ) {

        const notification = {

            id:
                this.generateId(),

            event:
                options.event ||
                'custom',

            category:
                options.category ||
                'system',

            priority:
                Number(
                    options.priority ||
                    3
                ),

            text:
                String(
                    message
                ),

            timestamp:
                Date.now(),

            player:
                options.player ||
                null,

            position:
                options.position ||
                null,

            data:
                options.data ||
                {}
        };

        this.history.push(
            notification
        );

        this.trimHistory();

        return this.send(
            notification
        );
    }

    status() {

        return {

            running:
                this.running,

            queue:
                this.queue.length,

            history:
                this.history.length,

            channels:
                this.gateway &&
                typeof this.gateway.getChannels ===
                'function'
                    ? this.gateway.getChannels()
                    : [],

            filters:
                {
                    ...this.filters
                },

            mode:
                this.defaultMode,

            stats:
                {
                    ...this.stats
                }
        };
    }

    generateId() {

        return (
            'notify_' +
            Date.now()
                .toString(36) +
            '_' +
            Math.random()
                .toString(36)
                .slice(2, 10)
        );
    }
}

const notificationManager =
    new NotificationManager();

module.exports =
    notificationManager;

module.exports.NotificationManager =
    NotificationManager;
