'use strict';

const config = require('../config');
const logger = require('./logger');
const eventBus = require('./event-bus');
const state = require('./state');

class AgentContext {

    constructor() {

        this.config = config;
        this.logger = logger;
        this.eventBus = eventBus;
        this.state = state;

        this.modules = new Map();

        this.startedAt = Date.now();

        this.running = false;
    }

    register(name, module) {

        if (!name || !module) {
            throw new Error(
                'Module name yoki module berilmagan.'
            );
        }

        this.modules.set(
            name,
            module
        );

        this.logger.info(
            `Module registered: ${name}`
        );

        this.eventBus.emitSafe(
            'system:module_registered',
            {
                name
            }
        );

        return module;
    }

    get(name) {

        return this.modules.get(
            name
        ) || null;
    }

    has(name) {

        return this.modules.has(
            name
        );
    }

    remove(name) {

        return this.modules.delete(
            name
        );
    }

    listModules() {

        return Array.from(
            this.modules.keys()
        );
    }

    start() {

        this.running = true;

        this.eventBus.emitSafe(
            'system:started',
            {
                timestamp:
                    Date.now()
            }
        );

        this.logger.success(
            'AKV Agent Context ishga tushdi.'
        );
    }

    stop() {

        this.running = false;

        this.eventBus.emitSafe(
            'system:stopped',
            {
                timestamp:
                    Date.now()
            }
        );

        this.logger.info(
            'AKV Agent Context to‘xtatildi.'
        );
    }

    uptime() {

        return (
            Date.now() -
            this.startedAt
        );
    }

    snapshot() {

        return {

            running:
                this.running,

            uptime:
                this.uptime(),

            modules:
                this.listModules(),

            state:
                this.state.snapshot(),

            events:
                this.eventBus.health()
        };
    }
}

const context =
    new AgentContext();

module.exports =
    context;

module.exports.AgentContext =
    AgentContext;
