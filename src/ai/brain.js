'use strict';

const openrouter = require('./openrouter');
const {
    buildSystemPrompt,
    buildDecisionPrompt
} = require('./prompt');

const logger = require('../core/logger');
const context = require('../core/agent-context');

/*
===============================================================
 AKV AI BRAIN
===============================================================

Vazifasi:

  OBSERVE
      ↓
  UNDERSTAND
      ↓
  PLAN
      ↓
  DECIDE
      ↓
  ACTION ENGINE
      ↓
  VERIFY

Bu modul Minecraft packetlarini bevosita boshqarmaydi.
U AI qarorini ishlab chiqaradi.

Actionlarni keyingi action-engine bajaradi.
===============================================================
*/

class AIBrain {

    constructor() {

        this.enabled = true;

        this.thinking = false;

        this.lastDecision = null;

        this.lastDecisionAt = 0;

        this.decisionCount = 0;

        this.failureCount = 0;

        this.maxDecisionHistory = 100;

        this.decisionHistory = [];

        this.systemPrompt =
            buildSystemPrompt();
    }

    /* ========================================================
       WORLD SNAPSHOT
    ======================================================== */

    getWorldState() {

        const state =
            context.state;

        if (!state) {

            return {};
        }

        return state.snapshot();
    }

    /* ========================================================
       THINK
    ======================================================== */

    async think(command = null) {

        if (!this.enabled) {

            return {
                success: false,
                reason: 'AI Brain disabled.'
            };
        }

        if (this.thinking) {

            return {
                success: false,
                reason: 'AI hozir boshqa qaror ustida ishlayapti.'
            };
        }

        this.thinking = true;

        const startedAt =
            Date.now();

        try {

            const worldState =
                this.getWorldState();

            const userPrompt =
                buildDecisionPrompt(
                    worldState,
                    command
                );

            logger.ai(
                'AI decision boshlanmoqda.',
                {
                    command
                }
            );

            const raw =
                await openrouter.chat(
                    [
                        {
                            role: 'system',
                            content:
                                this.systemPrompt
                        },

                        {
                            role: 'user',
                            content:
                                userPrompt
                        }
                    ]
                );

            const decision =
                this.parseDecision(
                    raw
                );

            this.lastDecision =
                decision;

            this.lastDecisionAt =
                Date.now();

            this.decisionCount++;

            this.addHistory(
                decision
            );

            context.state.setDecision(
                decision
            );

            context.eventBus.emitSafe(
                'ai:decision',
                {
                    decision,
                    duration:
                        Date.now() -
                        startedAt
                }
            );

            logger.ai(
                'AI decision tayyor.',
                {
                    intent:
                        decision.intent,

                    goal:
                        decision.goal
                }
            );

            return {

                success: true,

                decision,

                duration:
                    Date.now() -
                    startedAt
            };

        } catch (error) {

            this.failureCount++;

            context.state.statistics.errors++;

            logger.error(
                'AI Brain xatosi.',
                {
                    error:
                        error.message
                }
            );

            context.eventBus.emitSafe(
                'ai:error',
                {
                    error:
                        error.message
                }
            );

            return {

                success: false,

                error:
                    error.message
            };

        } finally {

            this.thinking = false;
        }
    }

    /* ========================================================
       PARSE AI OUTPUT
    ======================================================== */

    parseDecision(raw) {

        if (
            typeof raw !== 'string'
        ) {

            return this.safeDecision(
                'unknown',
                'No valid AI response',
                'AI javobi noto‘g‘ri formatda.'
            );
        }

        let text =
            raw.trim();

        /*
        ```json ... ``` formatini tozalash
        */

        if (
            text.startsWith(
                '```'
            )
        ) {

            text =
                text
                    .replace(
                        /^```(?:json)?/i,
                        ''
                    )
                    .replace(
                        /```$/i,
                        ''
                    )
                    .trim();
        }

        /*
        Avval to‘liq JSON parse.
        */

        try {

            const parsed =
                JSON.parse(
                    text
                );

            return this.normalizeDecision(
                parsed
            );

        } catch (_) {
            /*
            Ba'zi modellar JSON oldidan
            qo‘shimcha matn berishi mumkin.
            JSON qismini qidiramiz.
            */
        }

        const first =
            text.indexOf('{');

        const last =
            text.lastIndexOf('}');

        if (
            first !== -1 &&
            last > first
        ) {

            const jsonText =
                text.slice(
                    first,
                    last + 1
                );

            try {

                const parsed =
                    JSON.parse(
                        jsonText
                    );

                return this.normalizeDecision(
                    parsed
                );

            } catch (_) {
                // Continue.
            }
        }

        /*
        JSON bo‘lmasa ham AI javobini
        yo‘qotmaymiz.
        */

        return {

            intent:
                'conversation',

            goal:
                'AI response',

            reason:
                'Model JSON format bermadi.',

            priority:
                'normal',

            actions: [],

            report:
                text.slice(
                    0,
                    4000
                ),

            memory: [],

            raw:
                text
        };
    }

    /* ========================================================
       NORMALIZE DECISION
    ======================================================== */

    normalizeDecision(
        decision
    ) {

        if (
            !decision ||
            typeof decision !== 'object'
        ) {

            return this.safeDecision(
                'unknown',
                'Unknown',
                'Decision object emas.'
            );
        }

        const allowedPriorities = new Set([
            'low',
            'normal',
            'high',
            'critical'
        ]);

        const priority =
            allowedPriorities.has(
                decision.priority
            )
                ? decision.priority
                : 'normal';

        let actions =
            Array.isArray(
                decision.actions
            )
                ? decision.actions
                : [];

        /*
        Xavfsizlik uchun actionlar faqat
        oddiy object sifatida qabul qilinadi.
        */

        actions =
            actions
                .filter(
                    action =>
                        action &&
                        typeof action ===
                            'object'
                )
                .slice(
                    0,
                    50
                );

        let memory =
            Array.isArray(
                decision.memory
            )
                ? decision.memory
                : [];

        memory =
            memory.slice(
                0,
                50
            );

        return {

            intent:
                String(
                    decision.intent ||
                    'unknown'
                ),

            goal:
                String(
                    decision.goal ||
                    ''
                ),

            reason:
                String(
                    decision.reason ||
                    ''
                ),

            priority,

            actions,

            report:
                String(
                    decision.report ||
                    ''
                ),

            memory,

            raw:
                decision.raw || null
        };
    }

    /* ========================================================
       SAFE DECISION
    ======================================================== */

    safeDecision(
        intent,
        goal,
        reason
    ) {

        return {

            intent,

            goal,

            reason,

            priority:
                'normal',

            actions: [],

            report:
                reason,

            memory: []
        };
    }

    /* ========================================================
       EXECUTE DECISION
    ======================================================== */

    async executeDecision(
        decision
    ) {

        if (
            !decision ||
            !Array.isArray(
                decision.actions
            )
        ) {

            return {
                success: false,
                reason:
                    'Invalid decision.'
            };
        }

        const actionEngine =
            context.get(
                'action-engine'
            );

        if (!actionEngine) {

            logger.warn(
                'Action Engine hali ulanmagan.'
            );

            context.eventBus.emitSafe(
                'ai:action_engine_missing',
                {
                    decision
                }
            );

            return {

                success: false,

                reason:
                    'Action Engine mavjud emas.',

                decision
            };
        }

        const results = [];

        for (
            const action
            of decision.actions
        ) {

            try {

                const result =
                    await actionEngine.execute(
                        action
                    );

                results.push(
                    result
                );

                /*
                Har bir actiondan keyin
                dunyo holatini qayta tekshirish
                keyingi modulga qoldiriladi.
                */

            } catch (error) {

                results.push({

                    success: false,

                    error:
                        error.message,

                    action
                });

                logger.error(
                    'AI action execution error.',
                    {
                        error:
                            error.message,

                        action
                    }
                );
            }
        }

        context.eventBus.emitSafe(
            'ai:decision_executed',
            {
                decision,
                results
            }
        );

        return {

            success:
                results.every(
                    result =>
                        result &&
                        result.success !== false
                ),

            results
        };
    }

    /* ========================================================
       COMMAND
    ======================================================== */

    async handleCommand(
        command,
        source = 'remote'
    ) {

        if (
            !command ||
            typeof command !== 'string'
        ) {

            return {

                success: false,

                reason:
                    'Buyruq bo‘sh.'
            };
        }

        const clean =
            command
                .trim()
                .slice(
                    0,
                    4000
                );

        context.state.setCommand(
            clean,
            source
        );

        context.eventBus.emitSafe(
            'ai:command_received',
            {
                command:
                    clean,

                source
            }
        );

        const thinking =
            await this.think(
                clean
            );

        if (!thinking.success) {
            return thinking;
        }

        const execution =
            await this.executeDecision(
                thinking.decision
            );

        return {

            success:
                execution.success,

            command:
                clean,

            decision:
                thinking.decision,

            execution
        };
    }

    /* ========================================================
       AUTONOMOUS THINK
    ======================================================== */

    async autonomousThink() {

        if (
            !context.state.autonomous
        ) {

            return {

                success: false,

                reason:
                    'Autonomous mode o‘chiq.'
            };
        }

        return this.think(
            null
        );
    }

    /* ========================================================
       HISTORY
    ======================================================== */

    addHistory(
        decision
    ) {

        this.decisionHistory.push({

            timestamp:
                Date.now(),

            decision
        });

        if (
            this.decisionHistory.length >
            this.maxDecisionHistory
        ) {

            this.decisionHistory.splice(
                0,
                this.decisionHistory.length -
                    this.maxDecisionHistory
            );
        }
    }

    getHistory(
        limit = 20
    ) {

        return this.decisionHistory.slice(
            -Math.max(
                1,
                Number(limit) || 20
            )
        );
    }

    /* ========================================================
       ENABLE / DISABLE
    ======================================================== */

    enable() {

        this.enabled = true;

        return true;
    }

    disable() {

        this.enabled = false;

        return true;
    }

    /* ========================================================
       STATUS
    ======================================================== */

    status() {

        return {

            enabled:
                this.enabled,

            thinking:
                this.thinking,

            decisions:
                this.decisionCount,

            failures:
                this.failureCount,

            lastDecisionAt:
                this.lastDecisionAt,

            lastDecision:
                this.lastDecision
        };
    }
}

/* ============================================================
   SINGLE INSTANCE
=============================================================== */

const brain =
    new AIBrain();

module.exports =
    brain;

module.exports.AIBrain =
    AIBrain;
