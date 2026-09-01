'use strict';

const context = require('../core/agent-context');
const logger = require('../core/logger');

class MovementEngine {

    constructor() {

        this.running = false;

        this.moving = false;

        this.currentTask = null;

        this.currentTarget = null;

        this.followTarget = null;

        this.autonomous = false;

        this.stopRequested = false;

        this.taskId = 0;

        this.history = [];

        this.maxHistory = 1000;

        this.defaultSpeed = 1;

        this.maxDistance = 100000;
    }

    start() {

        if (this.running) {
            return;
        }

        this.running = true;

        this.stopRequested = false;

        logger.info(
            'Movement Engine ishga tushdi.'
        );

        context.eventBus.emitSafe(
            'movement:started',
            {}
        );
    }

    async execute(action) {

        if (!this.running) {
            this.start();
        }

        const type =
            String(
                action?.type ||
                action?.action ||
                action?.direction ||
                ''
            )
                .trim()
                .toLowerCase();

        switch (type) {

            case 'move':
                return this.direction(
                    action
                );

            case 'forward':
                return this.direction({
                    ...action,
                    direction:
                        'forward'
                });

            case 'back':
                return this.direction({
                    ...action,
                    direction:
                        'back'
                });

            case 'left':
                return this.direction({
                    ...action,
                    direction:
                        'left'
                });

            case 'right':
                return this.direction({
                    ...action,
                    direction:
                        'right'
                });

            case 'goto':
                return this.goto(
                    action.x ??
                    action.args?.x,

                    action.y ??
                    action.args?.y,

                    action.z ??
                    action.args?.z
                );

            case 'follow':
                return this.follow(
                    action.target ||
                    action.player ||
                    action.args?.target
                );

            case 'stop':
                return this.stop();

            default:
                return {
                    success: false,
                    error:
                        `Noma'lum movement: ${type}`
                };
        }
    }

    async direction(action) {

        const direction =
            String(
                action?.direction ||
                action?.args?.direction ||
                'forward'
            )
                .toLowerCase();

        const duration =
            this.safeNumber(
                action?.duration ||
                action?.args?.duration ||
                1000,
                100,
                30000
            );

        const speed =
            this.safeNumber(
                action?.speed ||
                action?.args?.speed ||
                this.defaultSpeed,
                0.1,
                10
            );

        this.stopRequested = false;

        this.currentTask = {
            type:
                'direction',

            direction,

            duration,

            speed,

            started:
                Date.now()
        };

        this.moving = true;

        context.state.setTask(
            this.currentTask
        );

        context.eventBus.emitSafe(
            'movement:direction',
            this.currentTask
        );

        logger.info(
            `Harakat: ${direction}`
        );

        /*
        Pastdagi adapter haqiqiy Bedrock
        movementni amalga oshiradi.
        */

        const adapter =
            this.getAdapter();

        if (!adapter) {

            return this.simulatedMovement(
                this.currentTask
            );
        }

        try {

            const result =
                await adapter.moveDirection(
                    direction,
                    duration,
                    speed
                );

            this.finishTask();

            return {

                success:
                    result?.success !== false,

                direction,

                duration,

                speed,

                result:
                    result || null
            };

        } catch (error) {

            this.finishTask();

            return {

                success: false,

                direction,

                error:
                    error.message
            };
        }
    }

    async goto(
        x,
        y,
        z
    ) {

        const target = {

            x:
                Number(x),

            y:
                Number(y),

            z:
                Number(z)
        };

        if (
            !Number.isFinite(target.x) ||
            !Number.isFinite(target.y) ||
            !Number.isFinite(target.z)
        ) {

            return {

                success: false,

                error:
                    'goto uchun koordinatalar noto‘g‘ri.'
            };
        }

        const distance =
            this.distanceTo(
                target
            );

        if (
            distance >
            this.maxDistance
        ) {

            return {

                success: false,

                error:
                    'Maqsad juda uzoq.'
            };
        }

        this.stopRequested = false;

        this.currentTarget =
            target;

        this.currentTask = {

            type:
                'goto',

            target,

            distance,

            started:
                Date.now()
        };

        this.moving = true;

        context.state.setTask(
            this.currentTask
        );

        context.eventBus.emitSafe(
            'movement:goto_started',
            {
                target,
                distance
            }
        );

        logger.info(
            `Bot koordinataga bormoqda: ` +
            `${target.x} ${target.y} ${target.z}`
        );

        const pathfinder =
            context.get(
                'pathfinder'
            );

        if (
            pathfinder &&
            typeof pathfinder.goto ===
                'function'
        ) {

            try {

                const result =
                    await pathfinder.goto(
                        target
                    );

                this.finishTask();

                return {

                    success:
                        result?.success !== false,

                    target,

                    distance,

                    result:
                        result || null
                };

            } catch (error) {

                this.finishTask();

                return {

                    success: false,

                    target,

                    error:
                        error.message
                };
            }
        }

        const adapter =
            this.getAdapter();

        if (
            adapter &&
            typeof adapter.goto ===
                'function'
        ) {

            try {

                const result =
                    await adapter.goto(
                        target
                    );

                this.finishTask();

                return {

                    success:
                        result?.success !== false,

                    target,

                    distance,

                    result:
                        result || null
                };

            } catch (error) {

                this.finishTask();

                return {

                    success: false,

                    target,

                    error:
                        error.message
                };
            }
        }

        /*
        Pathfinding ulanmaguncha
        maqsad state'da saqlanadi.
        */

        return {

            success: false,

            pending: true,

            target,

            distance,

            error:
                'Pathfinder hali ulanmagan.'
        };
    }

    async follow(target) {

        if (
            !target
        ) {

            return {

                success: false,

                error:
                    'Kuzatiladigan player ko‘rsatilmagan.'
            };
        }

        this.followTarget =
            String(target);

        this.stopRequested = false;

        this.currentTask = {

            type:
                'follow',

            target:
                this.followTarget,

            started:
                Date.now()
        };

        this.moving = true;

        context.state.setTask(
            this.currentTask
        );

        context.eventBus.emitSafe(
            'movement:follow_started',
            {
                target:
                    this.followTarget
            }
        );

        logger.info(
            `Player kuzatish boshlandi: ${this.followTarget}`
        );

        const pathfinder =
            context.get(
                'pathfinder'
            );

        if (
            pathfinder &&
            typeof pathfinder.follow ===
                'function'
        ) {

            try {

                return await pathfinder.follow(
                    this.followTarget,
                    {
                        stopSignal:
                            () =>
                                this.stopRequested
                    }
                );

            } finally {

                this.finishTask();
            }
        }

        const adapter =
            this.getAdapter();

        if (
            adapter &&
            typeof adapter.follow ===
                'function'
        ) {

            try {

                return await adapter.follow(
                    this.followTarget,
                    {
                        stopSignal:
                            () =>
                                this.stopRequested
                    }
                );

            } finally {

                this.finishTask();
            }
        }

        return {

            success: false,

            pending: true,

            target:
                this.followTarget,

            error:
                'Follow Pathfinding Engine hali ulanmagan.'
        };
    }

    enableAutonomous() {

        this.autonomous = true;

        context.state.autonomous = true;

        context.eventBus.emitSafe(
            'movement:autonomous_enabled',
            {}
        );

        logger.info(
            'Autonomous movement yoqildi.'
        );

        return true;
    }

    disableAutonomous() {

        this.autonomous = false;

        context.state.autonomous = false;

        this.stop();

        context.eventBus.emitSafe(
            'movement:autonomous_disabled',
            {}
        );

        return true;
    }

    async autonomousStep() {

        if (!this.autonomous) {

            return {

                success: false,

                reason:
                    'Autonomous movement o‘chiq.'
            };
        }

        if (
            this.moving
        ) {

            return {

                success: true,

                busy: true,

                task:
                    this.currentTask
            };
        }

        const brain =
            context.get(
                'brain'
            );

        if (!brain) {

            return {

                success: false,

                error:
                    'AI Brain topilmadi.'
            };
        }

        const decision =
            await brain.autonomousThink();

        if (
            !decision?.success
        ) {

            return decision;
        }

        return decision;
    }

    async stop() {

        this.stopRequested = true;

        const adapter =
            this.getAdapter();

        if (
            adapter &&
            typeof adapter.stop ===
                'function'
        ) {

            try {

                await adapter.stop();

            } catch (error) {

                logger.warn(
                    `Movement stop adapter error: ${error.message}`
                );
            }
        }

        const pathfinder =
            context.get(
                'pathfinder'
            );

        if (
            pathfinder &&
            typeof pathfinder.stop ===
                'function'
        ) {

            try {

                await pathfinder.stop();

            } catch (_) {}
        }

        this.finishTask();

        context.eventBus.emitSafe(
            'movement:stopped',
            {}
        );

        return {

            success: true,

            stopped: true
        };
    }

    finishTask() {

        if (
            this.currentTask
        ) {

            this.history.push({

                ...this.currentTask,

                finished:
                    Date.now(),

                duration:
                    Date.now() -
                    this.currentTask.started
            });

            if (
                this.history.length >
                this.maxHistory
            ) {

                this.history.shift();
            }
        }

        this.moving = false;

        this.currentTask = null;

        this.currentTarget = null;

        context.state.clearTask();
    }

    getAdapter() {

        return (
            context.get(
                'movement-adapter'
            ) ||
            context.get(
                'minecraft-movement'
            ) ||
            null
        );
    }

    getPosition() {

        const position =
            context.state.position ||
            context.state.botPosition ||
            {};

        return {

            x:
                Number(position.x) || 0,

            y:
                Number(position.y) || 0,

            z:
                Number(position.z) || 0
        };
    }

    distanceTo(target) {

        const current =
            this.getPosition();

        const dx =
            current.x -
            target.x;

        const dy =
            current.y -
            target.y;

        const dz =
            current.z -
            target.z;

        return Math.sqrt(
            dx * dx +
            dy * dy +
            dz * dz
        );
    }

    safeNumber(
        value,
        min,
        max
    ) {

        const number =
            Number(value);

        if (
            !Number.isFinite(number)
        ) {

            return min;
        }

        return Math.min(
            Math.max(
                number,
                min
            ),
            max
        );
    }

    async simulatedMovement(
        task
    ) {

        /*
        Bu vaqtinchalik fallback.
        Haqiqiy harakat keyingi
        Bedrock adapterga o'tadi.
        */

        const started =
            Date.now();

        while (
            Date.now() -
            started <
            task.duration
        ) {

            if (
                this.stopRequested
            ) {

                this.finishTask();

                return {

                    success: true,

                    stopped: true,

                    direction:
                        task.direction
                };
            }

            await this.sleep(
                50
            );
        }

        this.finishTask();

        return {

            success: true,

            simulated: true,

            direction:
                task.direction,

            duration:
                task.duration
        };
    }

    sleep(ms) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    ms
                )
        );
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

    status() {

        return {

            running:
                this.running,

            moving:
                this.moving,

            autonomous:
                this.autonomous,

            currentTask:
                this.currentTask,

            currentTarget:
                this.currentTarget,

            followTarget:
                this.followTarget,

            position:
                this.getPosition(),

            history:
                this.history.length
        };
    }

    stopEngine() {

        this.stop();

        this.running = false;

        this.autonomous = false;

        context.state.autonomous = false;

        logger.info(
            'Movement Engine to‘xtatildi.'
        );
    }
}

const movement =
    new MovementEngine();

module.exports =
    movement;

module.exports.MovementEngine =
    MovementEngine;
