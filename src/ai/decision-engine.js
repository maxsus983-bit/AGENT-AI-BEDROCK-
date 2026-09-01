'use strict';

const context = require('../core/agent-context');
const logger = require('../core/logger');

class DecisionEngine {

    constructor(options = {}) {

        this.name = 'decision-engine';

        this.running = false;

        this.autonomous = false;

        this.interval =
            Number(
                options.interval || 3000
            );

        this.timer = null;

        this.lastDecision = null;

        this.history = [];

        this.maxHistory =
            Number(
                options.maxHistory || 10000
            );

        this.busy = false;

        context.register(
            'decision-engine',
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
            'Decision Engine ishga tushdi.'
        );

        return {
            success: true
        };
    }

    stop() {

        this.running = false;

        this.disableAutonomous();

        return {
            success: true
        };
    }

    enableAutonomous() {

        this.autonomous = true;

        if (!this.timer) {

            this.timer =
                setInterval(
                    () => {
                        this.tick()
                            .catch(error => {
                                logger.warn(
                                    `AI decision xatosi: ${error.message}`
                                );
                            });
                    },
                    this.interval
                );
        }

        return {
            success: true,
            autonomous: true
        };
    }

    disableAutonomous() {

        this.autonomous = false;

        if (this.timer) {

            clearInterval(
                this.timer
            );

            this.timer = null;
        }

        return {
            success: true,
            autonomous: false
        };
    }

    setAutonomous(
        enabled
    ) {

        return enabled
            ? this.enableAutonomous()
            : this.disableAutonomous();
    }

    async tick() {

        if (
            !this.running ||
            !this.autonomous ||
            this.busy
        ) {
            return;
        }

        this.busy = true;

        try {

            const observation =
                await this.collectObservation();

            const decision =
                await this.think(
                    observation
                );

            if (
                decision &&
                decision.action
            ) {

                await this.executeDecision(
                    decision
                );
            }

        } finally {

            this.busy = false;
        }
    }

    async collectObservation() {

        const scanner =
            context.get(
                'world-scanner'
            );

        const tracker =
            context.get(
                'player-tracker'
            );

        const state =
            context.get(
                'state'
            );

        const observation = {

            timestamp:
                Date.now(),

            state:
                this.safeCall(
                    state,
                    'get'
                ),

            world:
                await this.safeAsyncCall(
                    scanner,
                    [
                        'scan',
                        'observe',
                        'getSnapshot'
                    ]
                ),

            players:
                await this.safeAsyncCall(
                    tracker,
                    [
                        'getPlayers',
                        'getSnapshot',
                        'observe'
                    ]
                )
        };

        return observation;
    }

    async think(
        observation
    ) {

        const brain =
            context.get(
                'ai-brain'
            ) ||
            context.get(
                'brain'
            );

        if (!brain) {

            return {
                action: null,
                reason:
                    'AI Brain topilmadi.'
            };
        }

        const prompt = {

            type:
                'autonomous_decision',

            observation,

            rules: [

                'Avval xavfsizlikni bahola.',

                'Yaqin dushman bo‘lsa jang yoki chekinishni tanla.',

                'Ochlik, health va xavfni hisobga ol.',

                'Atrofdagi resurs va bloklarni hisobga ol.',

                'Playerlar harakatini hisobga ol.',

                'Keraksiz harakat qilma.',

                'Bir vaqtning o‘zida bitta aniq action tanla.',

                'Action bajarilgandan keyin natijani tekshir.',

                'Imkon bo‘lsa uzoq muddatli maqsadni davom ettir.'
            ]
        };

        let result = null;

        if (
            typeof brain.decide ===
            'function'
        ) {

            result =
                await brain.decide(
                    prompt
                );

        } else if (
            typeof brain.think ===
            'function'
        ) {

            result =
                await brain.think(
                    prompt
                );

        } else if (
            typeof brain.process ===
            'function'
        ) {

            result =
                await brain.process(
                    prompt
                );
        }

        const decision =
            this.normalizeDecision(
                result
            );

        this.lastDecision =
            decision;

        this.saveHistory(
            decision
        );

        return decision;
    }

    normalizeDecision(
        result
    ) {

        if (!result) {

            return {
                action: null,
                reason:
                    'AI javob bermadi.'
            };
        }

        if (
            typeof result ===
            'string'
        ) {

            return {
                action:
                    result,
                reason:
                    'AI qarori'
            };
        }

        return {

            action:
                result.action ||
                result.type ||
                result.command ||
                null,

            target:
                result.target ||
                null,

            parameters:
                result.parameters ||
                result.params ||
                result.args ||
                {},

            reason:
                result.reason ||
                result.explanation ||
                '',

            confidence:
                Number(
                    result.confidence || 0
                )
        };
    }

    async executeDecision(
        decision
    ) {

        if (
            !decision.action
        ) {
            return {
                success: false,
                error:
                    'Action mavjud emas.'
            };
        }

        const gateway =
            context.get(
                'command-gateway'
            );

        if (
            gateway &&
            typeof gateway.receive ===
            'function'
        ) {

            const command =
                this.actionToCommand(
                    decision
                );

            const result =
                await gateway.receive(
                    {
                        text:
                            command,

                        source:
                            'decision-engine',

                        channel:
                            'ai',

                        user:
                            {
                                id:
                                    'autonomous-ai',

                                username:
                                    'ai-agent',

                                name:
                                    'AI Agent'
                            },

                        metadata:
                            {
                                autonomous:
                                    true,

                                decision
                            }
                    }
                );

            return result;
        }

        return this.executeDirect(
            decision
        );
    }

    actionToCommand(
        decision
    ) {

        const action =
            String(
                decision.action
            )
            .trim()
            .toLowerCase();

        const params =
            decision.parameters ||
            {};

        if (
            action.includes(
                'move'
            ) ||
            action.includes(
                'yur'
            )
        ) {

            const direction =
                params.direction ||
                decision.target ||
                'forward';

            const distance =
                params.distance ||
                1;

            return `${direction} ${distance} blok yur`;
        }

        if (
            action.includes(
                'combat'
            ) ||
            action.includes(
                'fight'
            ) ||
            action.includes(
                'attack'
            ) ||
            action.includes(
                'jang'
            )
        ) {

            if (
                decision.target
            ) {

                return `${decision.target} bilan jang qil`;
            }

            return 'jang qil';
        }

        if (
            action.includes(
                'observe'
            ) ||
            action.includes(
                'kuzat'
            )
        ) {

            if (
                decision.target
            ) {

                return `${decision.target} ni kuzat`;
            }

            return 'atrofni kuzat';
        }

        if (
            action.includes(
                'build'
            ) ||
            action.includes(
                'qur'
            )
        ) {

            return (
                params.description ||
                decision.target ||
                'foydali kichik bino qur'
            );
        }

        if (
            action.includes(
                'chat'
            ) ||
            action.includes(
                'say'
            )
        ) {

            return (
                `chatga ${
                    params.message ||
                    decision.reason ||
                    'AI Agent ishlayapti.'
                }`
            );
        }

        if (
            action.includes(
                'stop'
            ) ||
            action.includes(
                'toxta'
            )
        ) {

            return 'to‘xta';
        }

        return String(
            decision.action
        );
    }

    async executeDirect(
        decision
    ) {

        const action =
            String(
                decision.action
            )
            .toLowerCase();

        if (
            action.includes(
                'move'
            )
        ) {

            const movement =
                context.get(
                    'movement-engine'
                );

            if (
                movement &&
                typeof movement.execute ===
                'function'
            ) {

                return movement.execute(
                    decision
                );
            }
        }

        if (
            action.includes(
                'combat'
            )
        ) {

            const combat =
                context.get(
                    'combat-engine'
                );

            if (
                combat &&
                typeof combat.execute ===
                'function'
            ) {

                return combat.execute(
                    decision
                );
            }
        }

        if (
            action.includes(
                'build'
            )
        ) {

            const build =
                context.get(
                    'build-engine'
                );

            if (
                build &&
                typeof build.execute ===
                'function'
            ) {

                return build.execute(
                    decision
                );
            }
        }

        return {
            success: false,
            error:
                `Action bajaruvchi topilmadi: ${decision.action}`
        };
    }

    safeCall(
        service,
        method
    ) {

        if (
            service &&
            typeof service[method] ===
            'function'
        ) {

            try {
                return service[method]();
            } catch {
                return null;
            }
        }

        return null;
    }

    async safeAsyncCall(
        service,
        methods
    ) {

        if (!service) {
            return null;
        }

        for (
            const method of methods
        ) {

            if (
                typeof service[method] ===
                'function'
            ) {

                try {

                    return await service[
                        method
                    ]();

                } catch {
                    return null;
                }
            }
        }

        return null;
    }

    saveHistory(
        decision
    ) {

        this.history.push(
            {
                timestamp:
                    Date.now(),

                decision
            }
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

    getStatus() {

        return {

            running:
                this.running,

            autonomous:
                this.autonomous,

            busy:
                this.busy,

            interval:
                this.interval,

            lastDecision:
                this.lastDecision,

            history:
                this.history.length
        };
    }
}

const decisionEngine =
    new DecisionEngine();

module.exports =
    decisionEngine;

module.exports.DecisionEngine =
    DecisionEngine;
