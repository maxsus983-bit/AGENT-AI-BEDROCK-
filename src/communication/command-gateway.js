'use strict';

/*
===============================================================
 COMMAND GATEWAY
===============================================================

Vazifasi:

  Telegram / GitHub / Web / API kabi tashqi manbalardan
  keladigan buyruqlarni qabul qiladi.

  Misollar:

    "oldinga yur"
    "10 blok oldinga yur"
    "uy qur"
    "meni kuzat"
    "PLAYER_NAME ni kuzat"
    "jang qil"
    "chatga salom yoz"
    "shu yerda tur"
    "atrofni ayt"
    "nima bo'lyapti?"
    "avto o'yna"
    "o'zing qaror qil"
    "to'xta"

  Keyin buyruqni:

      Permission Manager
              ↓
      Command Gateway
              ↓
      Command Router
              ↓
      AI Brain
              ↓
      Action Engine
              ↓
      Minecraft

  tizimi orqali yuboradi.

===============================================================
*/

const crypto = require('crypto');

const context =
    require('../core/agent-context');

const logger =
    require('../core/logger');

class CommandGateway {

    constructor(options = {}) {

        this.name =
            'command-gateway';

        this.running =
            false;

        this.queue = [];

        this.processing =
            false;

        this.maxQueue =
            Number(
                options.maxQueue || 5000
            );

        this.history = [];

        this.maxHistory =
            Number(
                options.maxHistory || 20000
            );

        this.defaultTimeout =
            Number(
                options.timeout || 120000
            );

        this.stats = {

            received: 0,

            accepted: 0,

            rejected: 0,

            executed: 0,

            failed: 0,

            cancelled: 0
        };

        this.pending =
            new Map();

        this.aliases = {

            'oldinga yur':
                'move forward',

            'orqaga yur':
                'move backward',

            'chapga yur':
                'move left',

            'ongga yur':
                'move right',

            'o‘ngga yur':
                'move right',

            'toxta':
                'stop',

            'to‘xta':
                'stop',

            'toxtat':
                'stop',

            'to‘xtat':
                'stop',

            'jang qil':
                'combat',

            'urush':
                'combat',

            'kuzat':
                'observe',

            'meni kuzat':
                'follow',

            'atrofni ayt':
                'observe surroundings',

            'nima bolyapti':
                'status',

            'nima bo‘lyapti':
                'status',

            'avto oyin':
                'autonomous mode',

            'avto oyna':
                'autonomous mode',

            'ozing harakat qil':
                'autonomous mode',

            'o‘zing harakat qil':
                'autonomous mode'
        };

        context.register(
            'command-gateway',
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

        this.running =
            true;

        logger.info(
            'Command Gateway ishga tushdi.'
        );

        this.processLoop();

        return {

            success: true
        };
    }

    stop() {

        this.running =
            false;

        return {

            success: true
        };
    }

    /*
    ===========================================================
    TASHQARIDAN BUYRUQ QABUL QILISH
    ===========================================================
    */

    async receive(
        request = {}
    ) {

        this.stats.received++;

        const normalized =
            this.normalizeRequest(
                request
            );

        if (
            !normalized.text
        ) {

            this.stats.rejected++;

            return {

                success: false,

                accepted: false,

                error:
                    'Buyruq bo‘sh.'
            };
        }

        /*
         * Permission Manager mavjud bo‘lsa,
         * avval ruxsatni tekshiramiz.
         */

        const permission =
            context.get(
                'permission-manager'
            );

        if (
            permission &&
            typeof permission.check ===
            'function'
        ) {

            const result =
                await permission.check(
                    {
                        user:
                            normalized.user,

                        channel:
                            normalized.channel,

                        source:
                            normalized.source,

                        command:
                            normalized.text,

                        requestId:
                            normalized.id
                    }
                );

            if (
                result &&
                result.allowed === false
            ) {

                this.stats.rejected++;

                this.record(
                    normalized,
                    {
                        status:
                            'rejected',

                        reason:
                            result.reason
                    }
                );

                return {

                    success: false,

                    accepted: false,

                    requestId:
                        normalized.id,

                    error:
                        result.reason ||
                        'Ruxsat berilmadi.'
                };
            }
        }

        const parsed =
            this.parseCommand(
                normalized.text
            );

        normalized.command =
            parsed;

        /*
         * Maxsus commandlar
         */

        if (
            parsed.type ===
            'cancel'
        ) {

            return this.cancel(
                parsed.target
            );
        }

        if (
            parsed.type ===
            'status'
        ) {

            return this.statusCommand(
                normalized
            );
        }

        if (
            parsed.type ===
            'help'
        ) {

            return {

                success: true,

                accepted: true,

                requestId:
                    normalized.id,

                result:
                    this.getHelp()
            };
        }

        if (
            this.queue.length >=
            this.maxQueue
        ) {

            this.stats.rejected++;

            return {

                success: false,

                accepted: false,

                requestId:
                    normalized.id,

                error:
                    'Buyruqlar navbati to‘lib qoldi.'
            };
        }

        this.queue.push(
            normalized
        );

        this.stats.accepted++;

        this.record(
            normalized,
            {
                status:
                    'queued'
            }
        );

        this.emit(
            'command:received',
            normalized
        );

        return {

            success: true,

            accepted: true,

            queued: true,

            requestId:
                normalized.id,

            command:
                parsed
        };
    }

    /*
    ===========================================================
    REQUEST NORMALIZATION
    ===========================================================
    */

    normalizeRequest(
        request
    ) {

        let text =
            request.text ||
            request.command ||
            request.message ||
            request.content ||
            '';

        text =
            String(
                text
            )
            .trim();

        const source =
            String(
                request.source ||
                request.channel ||
                'unknown'
            )
            .trim()
            .toLowerCase();

        return {

            id:
                request.requestId ||
                this.generateId(),

            text,

            source,

            channel:
                request.channel ||
                source,

            user:
                request.user ||
                {
                    id:
                        request.userId ||
                        null,

                    username:
                        request.username ||
                        null,

                    name:
                        request.name ||
                        null
                },

            timestamp:
                Date.now(),

            metadata:
                request.metadata ||
                {},

            reply:
                request.reply ||
                null
        };
    }

    /*
    ===========================================================
    COMMAND PARSER
    ===========================================================
    */

    parseCommand(
        input
    ) {

        const original =
            String(
                input || ''
            )
            .trim();

        const lower =
            original
                .toLowerCase();

        const alias =
            this.aliases[lower];

        const text =
            alias ||
            original;

        /*
         * STOP
         */

        if (
            this.matches(
                lower,
                [
                    'stop',
                    'toxta',
                    'to‘xta',
                    'toxtat',
                    'to‘xtat',
                    'to‘xtagin'
                ]
            )
        ) {

            return {

                type:
                    'stop',

                raw:
                    original,

                args: []
            };
        }

        /*
         * CANCEL
         */

        if (
            lower.startsWith(
                'cancel'
            ) ||
            lower.startsWith(
                'bekor qil'
            ) ||
            lower.startsWith(
                'toxtat buyruq'
            )
        ) {

            return {

                type:
                    'cancel',

                raw:
                    original,

                target:
                    this.extractId(
                        original
                    )
            };
        }

        /*
         * STATUS
         */

        if (
            [
                'status',
                'holat',
                'nima bolyapti',
                'nima bo‘lyapti',
                'nima bo‘lmoqda',
                'qani',
                'nima qilyapsan'
            ].includes(
                lower
            )
        ) {

            return {

                type:
                    'status',

                raw:
                    original,

                args: []
            };
        }

        /*
         * HELP
         */

        if (
            [
                'help',
                'yordam',
                'buyruqlar'
            ].includes(
                lower
            )
        ) {

            return {

                type:
                    'help',

                raw:
                    original,

                args: []
            };
        }

        /*
         * MOVE
         */

        if (
            this.containsAny(
                lower,
                [
                    'yur',
                    'bor',
                    'move',
                    'go',
                    'qadam'
                ]
            )
        ) {

            return {

                type:
                    'move',

                raw:
                    original,

                direction:
                    this.detectDirection(
                        lower
                    ),

                distance:
                    this.extractDistance(
                        lower
                    ),

                target:
                    this.extractCoordinates(
                        lower
                    ),

                args:
                    this.extractWords(
                        original
                    )
            };
        }

        /*
         * FOLLOW
         */

        if (
            this.containsAny(
                lower,
                [
                    'ergash',
                    'follow',
                    'meni kuzat',
                    'yonimga kel'
                ]
            )
        ) {

            return {

                type:
                    'follow',

                raw:
                    original,

                target:
                    this.extractPlayerName(
                        original
                    )
            };
        }

        /*
         * OBSERVE
         */

        if (
            this.containsAny(
                lower,
                [
                    'kuzat',
                    'observe',
                    'qarab tur',
                    'tekshir',
                    'atrofni',
                    'playerlarni'
                ]
            )
        ) {

            return {

                type:
                    'observe',

                raw:
                    original,

                target:
                    this.extractPlayerName(
                        original
                    ),

                duration:
                    this.extractDuration(
                        lower
                    ),

                mode:
                    this.detectObserveMode(
                        lower
                    )
            };
        }

        /*
         * COMBAT
         */

        if (
            this.containsAny(
                lower,
                [
                    'jang',
                    'urush',
                    'fight',
                    'attack',
                    'hujum',
                    'ur'
                ]
            )
        ) {

            return {

                type:
                    'combat',

                raw:
                    original,

                target:
                    this.extractPlayerName(
                        original
                    ),

                mode:
                    this.detectCombatMode(
                        lower
                    )
            };
        }

        /*
         * BUILD
         */

        if (
            this.containsAny(
                lower,
                [
                    'qur',
                    'build',
                    'yasab ber',
                    'yasagin',
                    'joylashtir'
                ]
            )
        ) {

            return {

                type:
                    'build',

                raw:
                    original,

                target:
                    this.extractBuildTarget(
                        original
                    ),

                material:
                    this.extractMaterial(
                        lower
                    ),

                coordinates:
                    this.extractCoordinates(
                        lower
                    ),

                args:
                    this.extractWords(
                        original
                    )
            };
        }

        /*
         * CHAT
         */

        if (
            this.containsAny(
                lower,
                [
                    'chatga yoz',
                    'chatga',
                    'yoz',
                    'say',
                    'xabar ber'
                ]
            )
        ) {

            return {

                type:
                    'chat',

                raw:
                    original,

                message:
                    this.extractChatMessage(
                        original
                    )
            };
        }

        /*
         * AUTONOMOUS MODE
         */

        if (
            this.containsAny(
                lower,
                [
                    'avto oyin',
                    'avto oyna',
                    'avtomatik',
                    'mustaqil harakat',
                    'o‘zing harakat qil',
                    'ozing harakat qil',
                    'o‘zing qaror qil',
                    'ozing qaror qil'
                ]
            )
        ) {

            return {

                type:
                    'autonomous',

                raw:
                    original,

                enabled:
                    !this.containsAny(
                        lower,
                        [
                            'toxta',
                            'o‘chir',
                            'o‘chirish',
                            'stop'
                        ]
                    )
            };
        }

        /*
         * STAY
         */

        if (
            this.containsAny(
                lower,
                [
                    'shu yerda tur',
                    'tur',
                    'joyingda tur',
                    'stay'
                ]
            )
        ) {

            return {

                type:
                    'stay',

                raw:
                    original
            };
        }

        /*
         * RETURN
         */

        if (
            this.containsAny(
                lower,
                [
                    'qayt',
                    'orqaga qayt',
                    'uyga qayt',
                    'return'
                ]
            )
        ) {

            return {

                type:
                    'return',

                raw:
                    original
            };
        }

        /*
         * LOOK
         */

        if (
            this.containsAny(
                lower,
                [
                    'qaragin',
                    'qarab',
                    'look',
                    'nima bor'
                ]
            )
        ) {

            return {

                type:
                    'look',

                raw:
                    original,

                target:
                    this.extractPlayerName(
                        original
                    )
            };
        }

        /*
         * RANDOM / AI DECISION
         */

        if (
            this.containsAny(
                lower,
                [
                    'o‘zing hal qil',
                    'ozing hal qil',
                    'o‘zing tanla',
                    'ozing tanla',
                    'nima qilishni o‘zing bil',
                    'qarorni o‘zing qil'
                ]
            )
        ) {

            return {

                type:
                    'ai_decision',

                raw:
                    original
            };
        }

        /*
         * NOMA'LUM BUYRUQ
         *
         * Bu yerda buyruqni rad etmaymiz.
         *
         * AI Brain'ga beramiz.
         *
         * Shuning uchun:
         *
         * "shu joyga katta qasr qurib ber"
         *
         * kabi murakkab tabiiy til buyruqlari
         * AI tomonidan tushunilishi mumkin.
         */

        return {

            type:
                'ai',

            raw:
                original,

            args:
                this.extractWords(
                    original
                )
        };
    }

    /*
    ===========================================================
    PROCESS QUEUE
    ===========================================================
    */

    async processLoop() {

        if (
            this.processing
        ) {

            return;
        }

        this.processing =
            true;

        while (
            this.running
        ) {

            const request =
                this.queue.shift();

            if (!request) {

                await this.sleep(
                    100
                );

                continue;
            }

            try {

                await this.execute(
                    request
                );

            } catch (error) {

                this.stats.failed++;

                logger.error(
                    `Command execution xatosi: ${error.message}`
                );

                this.emit(
                    'command:failed',
                    {
                        request,
                        error
                    }
                );
            }
        }

        this.processing =
            false;
    }

    /*
    ===========================================================
    EXECUTE
    ===========================================================
    */

    async execute(
        request
    ) {

        const id =
            request.id;

        this.pending.set(
            id,
            {
                request,
                startedAt:
                    Date.now(),
                cancelled:
                    false
            }
        );

        this.emit(
            'command:start',
            request
        );

        try {

            const result =
                await this.route(
                    request
                );

            if (
                this.pending.get(id)
                    ?.cancelled
            ) {

                this.stats.cancelled++;

                return {

                    success: false,

                    cancelled: true,

                    requestId:
                        id
                };
            }

            this.stats.executed++;

            this.record(
                request,
                {
                    status:
                        'completed',

                    result
                }
            );

            this.emit(
                'command:executed',
                {
                    request,
                    result
                }
            );

            return {

                success: true,

                requestId:
                    id,

                result
            };

        } catch (error) {

            this.stats.failed++;

            this.record(
                request,
                {
                    status:
                        'failed',

                    error:
                        error.message
                }
            );

            this.emit(
                'command:failed',
                {
                    request,
                    error
                }
            );

            throw error;

        } finally {

            this.pending.delete(
                id
            );
        }
    }

    /*
    ===========================================================
    ROUTER BILAN ISHLASH
    ===========================================================
    */

    async route(
        request
    ) {

        const command =
            request.command;

        /*
         * Avval maxsus router.
         */

        const router =
            context.get(
                'command-router'
            );

        if (
            router &&
            typeof router.route ===
            'function'
        ) {

            return router.route(
                {
                    ...request,

                    parsed:
                        command
                }
            );
        }

        if (
            router &&
            typeof router.execute ===
            'function'
        ) {

            return router.execute(
                {
                    ...request,

                    parsed:
                        command
                }
            );
        }

        /*
         * Router mavjud bo'lmasa,
         * tegishli engine'larni to'g'ridan-to'g'ri
         * topishga harakat qilamiz.
         */

        switch (
            command.type
        ) {

            case 'move':

                return this.callEngine(
                    'movement-engine',
                    [
                        'execute',
                        'move',
                        'go'
                    ],
                    command
                );

            case 'combat':

                return this.callEngine(
                    'combat-engine',
                    [
                        'execute',
                        'fight',
                        'attack'
                    ],
                    command
                );

            case 'build':

                return this.callEngine(
                    'build-engine',
                    [
                        'execute',
                        'build'
                    ],
                    command
                );

            case 'observe':

                return this.callEngine(
                    'player-tracker',
                    [
                        'observe',
                        'track',
                        'watch'
                    ],
                    command
                );

            case 'follow':

                return this.callEngine(
                    'movement-engine',
                    [
                        'follow',
                        'execute'
                    ],
                    command
                );

            case 'chat':

                return this.sendChat(
                    command.message
                );

            case 'stop':

                return this.stopAgent();

            case 'stay':

                return this.callEngine(
                    'movement-engine',
                    [
                        'stay',
                        'stop'
                    ],
                    command
                );

            case 'return':

                return this.callEngine(
                    'movement-engine',
                    [
                        'returnHome',
                        'return',
                        'execute'
                    ],
                    command
                );

            case 'look':

                return this.callEngine(
                    'world-scanner',
                    [
                        'look',
                        'scan',
                        'observe'
                    ],
                    command
                );

            case 'autonomous':

                return this.setAutonomous(
                    command.enabled
                );

            case 'ai':

            case 'ai_decision':

                return this.askAI(
                    request
                );

            default:

                return this.askAI(
                    request
                );
        }
    }

    /*
    ===========================================================
    ENGINE CALLER
    ===========================================================
    */

    async callEngine(
        serviceName,
        methods,
        payload
    ) {

        const service =
            context.get(
                serviceName
            );

        if (!service) {

            throw new Error(
                `${serviceName} topilmadi.`
            );
        }

        for (
            const method of methods
        ) {

            if (
                typeof service[method] ===
                'function'
            ) {

                return service[method](
                    payload
                );
            }
        }

        throw new Error(
            `${serviceName} ichida mos method topilmadi.`
        );
    }

    /*
    ===========================================================
    AI BRAIN
    ===========================================================
    */

    async askAI(
        request
    ) {

        const brain =
            context.get(
                'ai-brain'
            ) ||
            context.get(
                'brain'
            );

        if (!brain) {

            throw new Error(
                'AI Brain topilmadi.'
            );
        }

        const payload = {

            text:
                request.text,

            command:
                request.command,

            user:
                request.user,

            source:
                request.source,

            timestamp:
                request.timestamp,

            metadata:
                request.metadata
        };

        if (
            typeof brain.process ===
            'function'
        ) {

            return brain.process(
                payload
            );
        }

        if (
            typeof brain.think ===
            'function'
        ) {

            return brain.think(
                payload
            );
        }

        if (
            typeof brain.decide ===
            'function'
        ) {

            return brain.decide(
                payload
            );
        }

        throw new Error(
            'AI Brain uchun process/think/decide method topilmadi.'
        );
    }

    /*
    ===========================================================
    CHAT
    ===========================================================
    */

    async sendChat(
        message
    ) {

        const gateway =
            context.get(
                'message-gateway'
            );

        if (!gateway) {

            throw new Error(
                'Message Gateway topilmadi.'
            );
        }

        if (
            typeof gateway.sendChat ===
            'function'
        ) {

            return gateway.sendChat(
                String(message)
            );
        }

        if (
            typeof gateway.send ===
            'function'
        ) {

            return gateway.send(
                'minecraft',
                String(message),
                {
                    type:
                        'minecraft-chat'
                }
            );
        }

        const client =
            context.get(
                'minecraft-client'
            ) ||
            context.get(
                'client'
            );

        if (
            client &&
            typeof client.chat ===
            'function'
        ) {

            await client.chat(
                String(message)
            );

            return {
                success: true
            };
        }

        throw new Error(
            'Minecraft chat gateway topilmadi.'
        );
    }

    /*
    ===========================================================
    STOP AGENT
    ===========================================================
    */

    async stopAgent() {

        const movement =
            context.get(
                'movement-engine'
            );

        if (
            movement
        ) {

            if (
                typeof movement.stop ===
                'function'
            ) {

                await movement.stop();
            }
        }

        const action =
            context.get(
                'action-engine'
            );

        if (
            action &&
            typeof action.stop ===
            'function'
        ) {

            await action.stop();
        }

        this.emit(
            'agent:stop',
            {
                source:
                    'command-gateway'
            }
        );

        return {

            success: true,

            message:
                'Bot harakatlari to‘xtatildi.'
        };
    }

    /*
    ===========================================================
    AUTONOMOUS MODE
    ===========================================================
    */

    async setAutonomous(
        enabled
    ) {

        const brain =
            context.get(
                'ai-brain'
            ) ||
            context.get(
                'brain'
            );

        if (brain) {

            if (
                typeof brain.setAutonomousMode ===
                'function'
            ) {

                return brain
                    .setAutonomousMode(
                        Boolean(enabled)
                    );
            }

            if (
                typeof brain.setMode ===
                'function'
            ) {

                return brain.setMode(
                    enabled
                        ? 'autonomous'
                        : 'manual'
                );
            }
        }

        context.set(
            'autonomous-mode',
            Boolean(enabled)
        );

        this.emit(
            'agent:autonomous',
            {
                enabled:
                    Boolean(enabled)
            }
        );

        return {

            success: true,

            autonomous:
                Boolean(enabled)
        };
    }

    /*
    ===========================================================
    STATUS
    ===========================================================
    */

    statusCommand(
        request
    ) {

        const state =
            context.get(
                'state'
            );

        let snapshot =
            null;

        if (
            state &&
            typeof state.get ===
            'function'
        ) {

            snapshot =
                state.get();
        }

        return {

            success: true,

            requestId:
                request.id,

            gateway:
                this.status(),

            state:
                snapshot
        };
    }

    status() {

        return {

            running:
                this.running,

            processing:
                this.processing,

            queue:
                this.queue.length,

            pending:
                this.pending.size,

            history:
                this.history.length,

            stats:
                {
                    ...this.stats
                }
        };
    }

    /*
    ===========================================================
    CANCEL
    ===========================================================
    */

    cancel(
        id
    ) {

        if (!id) {

            return {

                success: false,

                error:
                    'Bekor qilish uchun request ID kerak.'
            };
        }

        const pending =
            this.pending.get(
                id
            );

        if (pending) {

            pending.cancelled =
                true;

            this.emit(
                'command:cancelled',
                {
                    requestId:
                        id
                }
            );

            return {

                success: true,

                cancelled: true,

                requestId:
                    id
            };
        }

        const index =
            this.queue.findIndex(
                item =>
                    item.id === id
            );

        if (
            index >= 0
        ) {

            this.queue.splice(
                index,
                1
            );

            this.stats.cancelled++;

            return {

                success: true,

                cancelled: true,

                requestId:
                    id
            };
        }

        return {

            success: false,

            cancelled: false,

            error:
                'Buyruq topilmadi.'
        };
    }

    /*
    ===========================================================
    HISTORY
    ===========================================================
    */

    record(
        request,
        result
    ) {

        const entry = {

            id:
                this.generateId(),

            requestId:
                request?.id ||
                null,

            command:
                request?.text ||
                null,

            source:
                request?.source ||
                null,

            channel:
                request?.channel ||
                null,

            user:
                request?.user ||
                null,

            timestamp:
                Date.now(),

            result:
                result ||
                null
        };

        this.history.push(
            entry
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

    /*
    ===========================================================
    EVENT BUS
    ===========================================================
    */

    emit(
        event,
        data
    ) {

        if (
            context.eventBus &&
            typeof context.eventBus.emit ===
            'function'
        ) {

            context.eventBus.emit(
                event,
                data
            );
        }
    }

    /*
    ===========================================================
    PARSING HELPERS
    ===========================================================
    */

    matches(
        text,
        values
    ) {

        return values.includes(
            text
        );
    }

    containsAny(
        text,
        values
    ) {

        return values.some(
            value =>
                text.includes(
                    value
                )
        );
    }

    extractDistance(
        text
    ) {

        const match =
            text.match(
                /(\d+(?:\.\d+)?)\s*(?:blok|block|qadam|metr|m)?/i
            );

        if (!match) {

            return 1;
        }

        const value =
            Number(
                match[1]
            );

        return Number.isFinite(
            value
        )
            ? value
            : 1;
    }

    detectDirection(
        text
    ) {

        if (
            this.containsAny(
                text,
                [
                    'oldinga',
                    'forward',
                    'front'
                ]
            )
        ) {

            return 'forward';
        }

        if (
            this.containsAny(
                text,
                [
                    'orqaga',
                    'backward',
                    'back'
                ]
            )
        ) {

            return 'backward';
        }

        if (
            this.containsAny(
                text,
                [
                    'chapga',
                    'left'
                ]
            )
        ) {

            return 'left';
        }

        if (
            this.containsAny(
                text,
                [
                    'ongga',
                    'o‘ngga',
                    'right'
                ]
            )
        ) {

            return 'right';
        }

        if (
            this.containsAny(
                text,
                [
                    'tepaga',
                    'yuqoriga',
                    'up'
                ]
            )
        ) {

            return 'up';
        }

        if (
            this.containsAny(
                text,
                [
                    'pastga',
                    'down'
                ]
            )
        ) {

            return 'down';
        }

        return 'forward';
    }

    extractCoordinates(
        text
    ) {

        /*
         * Misollar:
         *
         * 100 64 -200
         * x100 y64 z-200
         * X:100 Y:64 Z:-200
         */

        const xyz =
            text.match(
                /x\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)+y\s*[:=]?\s*(-?\d+(?:\.\d+)?)\s*(?:,|\s)+z\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i
            );

        if (xyz) {

            return {

                x:
                    Number(xyz[1]),

                y:
                    Number(xyz[2]),

                z:
                    Number(xyz[3])
            };
        }

        return null;
    }

    extractPlayerName(
        text
    ) {

        const patterns = [

            /player\s+([A-Za-z0-9_]+)/i,

            /o'yinchi\s+([A-Za-z0-9_]+)/i,

            /o‘yinchi\s+([A-Za-z0-9_]+)/i,

            /([A-Za-z0-9_]+)\s+ni\s+kuzat/i,

            /([A-Za-z0-9_]+)\s+ni\s+ur/i,

            /([A-Za-z0-9_]+)\s+bilan\s+jang/i,

            /([A-Za-z0-9_]+)\s+bilan\s+urush/i
        ];

        for (
            const pattern of patterns
        ) {

            const match =
                text.match(
                    pattern
                );

            if (match) {

                return match[1];
            }
        }

        return null;
    }

    extractDuration(
        text
    ) {

        const match =
            text.match(
                /(\d+)\s*(soniya|sekund|s|daqiqa|minut|m|soat|h)/i
            );

        if (!match) {

            return null;
        }

        const value =
            Number(
                match[1]
            );

        const unit =
            match[2]
                .toLowerCase();

        if (
            unit.startsWith('son') ||
            unit === 's'
        ) {

            return value * 1000;
        }

        if (
            unit.startsWith('daq') ||
            unit.startsWith('min') ||
            unit === 'm'
        ) {

            return value * 60 * 1000;
        }

        if (
            unit.startsWith('soat') ||
            unit === 'h'
        ) {

            return value * 60 * 60 * 1000;
        }

        return null;
    }

    detectObserveMode(
        text
    ) {

        if (
            this.containsAny(
                text,
                [
                    'yashirin',
                    'maxfiy',
                    'secret',
                    'silent'
                ]
            )
        ) {

            return 'silent';
        }

        if (
            this.containsAny(
                text,
                [
                    'oddiy',
                    'normal'
                ]
            )
        ) {

            return 'normal';
        }

        return 'normal';
    }

    detectCombatMode(
        text
    ) {

        if (
            this.containsAny(
                text,
                [
                    'himoya',
                    'defend'
                ]
            )
        ) {

            return 'defensive';
        }

        if (
            this.containsAny(
                text,
                [
                    'agressiv',
                    'aggressive',
                    'kuchli'
                ]
            )
        ) {

            return 'aggressive';
        }

        return 'normal';
    }

    extractBuildTarget(
        text
    ) {

        const lower =
            text.toLowerCase();

        if (
            lower.includes(
                'uy'
            )
        ) {

            return 'house';
        }

        if (
            lower.includes(
                'qasr'
            )
        ) {

            return 'castle';
        }

        if (
            lower.includes(
                'devor'
            )
        ) {

            return 'wall';
        }

        if (
            lower.includes(
                'ko‘prik'
            ) ||
            lower.includes(
                'koprik'
            )
        ) {

            return 'bridge';
        }

        if (
            lower.includes(
                'ferma'
            )
        ) {

            return 'farm';
        }

        return null;
    }

    extractMaterial(
        text
    ) {

        const materials = [

            'stone',
            'wood',
            'oak',
            'cobblestone',
            'brick',
            'glass',
            'dirt',
            'sand',
            'quartz',
            'iron',
            'gold',
            'diamond'
        ];

        for (
            const material of materials
        ) {

            if (
                text.includes(
                    material
                )
            ) {

                return material;
            }
        }

        if (
            text.includes(
                'tosh'
            )
        ) {

            return 'stone';
        }

        if (
            text.includes(
                'yogoch'
            ) ||
            text.includes(
                'yog‘och'
            )
        ) {

            return 'wood';
        }

        return null;
    }

    extractChatMessage(
        text
    ) {

        const patterns = [

            /chatga\s+yoz\s+(.+)/i,

            /chatga\s+(.+)/i,

            /say\s+(.+)/i,

            /xabar\s+ber\s+(.+)/i,

            /yoz\s+(.+)/i
        ];

        for (
            const pattern of patterns
        ) {

            const match =
                text.match(
                    pattern
                );

            if (match) {

                return match[1].trim();
            }
        }

        return text;
    }

    extractWords(
        text
    ) {

        return String(
            text
        )
        .trim()
        .split(
            /\s+/
        )
        .filter(Boolean);
    }

    extractId(
        text
    ) {

        const match =
            text.match(
                /(?:cancel|bekor qil|buyruq)\s+([A-Za-z0-9_-]+)/i
            );

        return match
            ? match[1]
            : null;
    }

    generateId() {

        return (
            'cmd_' +
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

    getHelp() {

        return {

            title:
                'Minecraft AI Agent buyruqlari',

            examples: [

                'oldinga 10 blok yur',

                'orqaga yur',

                'chapga yur',

                'o‘ngga yur',

                'shu yerda tur',

                'PLAYER ni kuzat',

                'yashirincha kuzat PLAYER',

                'atrofni kuzat',

                'jang qil',

                'PLAYER bilan jang qil',

                'uy qur',

                'toshdan uy qur',

                'X:100 Y:64 Z:-200 joyga bor',

                'chatga Salom hammaga',

                'nima bo‘lyapti?',

                'avto o‘yna',

                'o‘zing harakat qil',

                'to‘xta'
            ]
        };
    }

    sleep(
        milliseconds
    ) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    milliseconds
                )
        );
    }
}

const commandGateway =
    new CommandGateway();

module.exports =
    commandGateway;

module.exports.CommandGateway =
    CommandGateway;
