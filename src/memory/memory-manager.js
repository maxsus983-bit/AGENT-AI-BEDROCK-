'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const config = require('../config');
const context = require('../core/agent-context');
const logger = require('../core/logger');

class MemoryManager {

    constructor() {

        this.db = null;

        this.initialized = false;

        this.databasePath =
            path.resolve(
                config.memory.database
            );

        this.maxRecentMessages =
            config.memory.maxRecentMessages ||
            1000;
    }

    /* ========================================================
       INIT
    ======================================================== */

    initialize() {

        if (this.initialized) {
            return;
        }

        const directory =
            path.dirname(
                this.databasePath
            );

        fs.mkdirSync(
            directory,
            {
                recursive: true
            }
        );

        this.db =
            new Database(
                this.databasePath
            );

        this.db.pragma(
            'journal_mode = WAL'
        );

        this.db.pragma(
            'synchronous = NORMAL'
        );

        this.db.pragma(
            'foreign_keys = ON'
        );

        this.createTables();

        this.prepareStatements();

        this.initialized = true;

        logger.success(
            'Memory Manager ishga tushdi.'
        );

        context.eventBus.emitSafe(
            'memory:initialized',
            {
                database:
                    this.databasePath
            }
        );
    }

    /* ========================================================
       TABLES
    ======================================================== */

    createTables() {

        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                key TEXT,
                content TEXT NOT NULL,
                source TEXT,
                importance INTEGER DEFAULT 5,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_memories_type
            ON memories(type);

            CREATE INDEX IF NOT EXISTS idx_memories_key
            ON memories(key);

            CREATE INDEX IF NOT EXISTS idx_memories_created
            ON memories(created_at);

            CREATE TABLE IF NOT EXISTS chats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                sender TEXT,
                message TEXT NOT NULL,
                source TEXT,
                timestamp INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_chats_sender
            ON chats(sender);

            CREATE INDEX IF NOT EXISTS idx_chats_timestamp
            ON chats(timestamp);

            CREATE TABLE IF NOT EXISTS observations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT,
                subject TEXT,
                content TEXT NOT NULL,
                x REAL,
                y REAL,
                z REAL,
                dimension TEXT,
                timestamp INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_observations_category
            ON observations(category);

            CREATE INDEX IF NOT EXISTS idx_observations_subject
            ON observations(subject);

            CREATE INDEX IF NOT EXISTS idx_observations_timestamp
            ON observations(timestamp);

            CREATE TABLE IF NOT EXISTS commands (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                command TEXT NOT NULL,
                source TEXT,
                user TEXT,
                status TEXT,
                result TEXT,
                timestamp INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_commands_timestamp
            ON commands(timestamp);

            CREATE TABLE IF NOT EXISTS decisions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                intent TEXT,
                goal TEXT,
                reason TEXT,
                priority TEXT,
                decision TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_decisions_timestamp
            ON decisions(timestamp);

            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                content TEXT NOT NULL,
                timestamp INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_events_type
            ON events(event_type);

            CREATE INDEX IF NOT EXISTS idx_events_timestamp
            ON events(timestamp);

            CREATE TABLE IF NOT EXISTS players (
                name TEXT PRIMARY KEY,
                data TEXT NOT NULL,
                first_seen INTEGER NOT NULL,
                last_seen INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS locations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                x REAL,
                y REAL,
                z REAL,
                dimension TEXT,
                description TEXT,
                created_at INTEGER NOT NULL
            );
        `);
    }

    /* ========================================================
       PREPARED STATEMENTS
    ======================================================== */

    prepareStatements() {

        this.statements = {

            memoryInsert:
                this.db.prepare(`
                    INSERT INTO memories
                    (
                        type,
                        key,
                        content,
                        source,
                        importance,
                        created_at,
                        updated_at
                    )
                    VALUES
                    (
                        @type,
                        @key,
                        @content,
                        @source,
                        @importance,
                        @created_at,
                        @updated_at
                    )
                `),

            chatInsert:
                this.db.prepare(`
                    INSERT INTO chats
                    (
                        sender,
                        message,
                        source,
                        timestamp
                    )
                    VALUES
                    (
                        @sender,
                        @message,
                        @source,
                        @timestamp
                    )
                `),

            observationInsert:
                this.db.prepare(`
                    INSERT INTO observations
                    (
                        category,
                        subject,
                        content,
                        x,
                        y,
                        z,
                        dimension,
                        timestamp
                    )
                    VALUES
                    (
                        @category,
                        @subject,
                        @content,
                        @x,
                        @y,
                        @z,
                        @dimension,
                        @timestamp
                    )
                `),

            commandInsert:
                this.db.prepare(`
                    INSERT INTO commands
                    (
                        command,
                        source,
                        user,
                        status,
                        result,
                        timestamp
                    )
                    VALUES
                    (
                        @command,
                        @source,
                        @user,
                        @status,
                        @result,
                        @timestamp
                    )
                `),

            decisionInsert:
                this.db.prepare(`
                    INSERT INTO decisions
                    (
                        intent,
                        goal,
                        reason,
                        priority,
                        decision,
                        timestamp
                    )
                    VALUES
                    (
                        @intent,
                        @goal,
                        @reason,
                        @priority,
                        @decision,
                        @timestamp
                    )
                `),

            eventInsert:
                this.db.prepare(`
                    INSERT INTO events
                    (
                        event_type,
                        content,
                        timestamp
                    )
                    VALUES
                    (
                        @event_type,
                        @content,
                        @timestamp
                    )
                `),

            playerUpsert:
                this.db.prepare(`
                    INSERT INTO players
                    (
                        name,
                        data,
                        first_seen,
                        last_seen
                    )
                    VALUES
                    (
                        @name,
                        @data,
                        @first_seen,
                        @last_seen
                    )
                    ON CONFLICT(name)
                    DO UPDATE SET
                        data = excluded.data,
                        last_seen = excluded.last_seen
                `)
        };
    }

    /* ========================================================
       GENERIC MEMORY
    ======================================================== */

    remember(
        type,
        content,
        options = {}
    ) {

        this.ensure();

        const now =
            Date.now();

        const result =
            this.statements.memoryInsert.run({

                type:
                    String(type || 'general'),

                key:
                    options.key ||
                    null,

                content:
                    this.serialize(content),

                source:
                    options.source ||
                    'agent',

                importance:
                    Number(
                        options.importance || 5
                    ),

                created_at:
                    now,

                updated_at:
                    now
            });

        context.eventBus.emitSafe(
            'memory:saved',
            {
                id:
                    result.lastInsertRowid,

                type
            }
        );

        return result.lastInsertRowid;
    }

    /* ========================================================
       CHAT MEMORY
    ======================================================== */

    saveChat(
        sender,
        message,
        source = 'minecraft'
    ) {

        this.ensure();

        const timestamp =
            Date.now();

        const result =
            this.statements.chatInsert.run({

                sender:
                    String(
                        sender || 'unknown'
                    ),

                message:
                    String(
                        message || ''
                    ),

                source:
                    String(source),

                timestamp
            });

        return result.lastInsertRowid;
    }

    getRecentChats(
        limit = 100
    ) {

        this.ensure();

        return this.db.prepare(`
            SELECT *
            FROM chats
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(
            Math.max(
                1,
                Number(limit) || 100
            )
        ).reverse();
    }

    searchChats(
        text,
        limit = 50
    ) {

        this.ensure();

        return this.db.prepare(`
            SELECT *
            FROM chats
            WHERE message LIKE ?
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(
            `%${String(text)}%`,
            Math.max(
                1,
                Number(limit) || 50
            )
        );
    }

    /* ========================================================
       OBSERVATION MEMORY
    ======================================================== */

    saveObservation(
        category,
        content,
        options = {}
    ) {

        this.ensure();

        const position =
            options.position || {};

        const result =
            this.statements.observationInsert.run({

                category:
                    category || 'general',

                subject:
                    options.subject || null,

                content:
                    this.serialize(content),

                x:
                    position.x ?? null,

                y:
                    position.y ?? null,

                z:
                    position.z ?? null,

                dimension:
                    options.dimension ||
                    null,

                timestamp:
                    Date.now()
            });

        context.state.statistics.observations++;

        return result.lastInsertRowid;
    }

    getRecentObservations(
        limit = 100
    ) {

        this.ensure();

        return this.db.prepare(`
            SELECT *
            FROM observations
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(
            Math.max(
                1,
                Number(limit) || 100
            )
        ).reverse();
    }

    searchObservations(
        text,
        limit = 100
    ) {

        this.ensure();

        const q =
            `%${String(text)}%`;

        return this.db.prepare(`
            SELECT *
            FROM observations
            WHERE content LIKE ?
               OR subject LIKE ?
               OR category LIKE ?
            ORDER BY timestamp DESC
            LIMIT ?
        `).all(
            q,
            q,
            q,
            Math.max(
                1,
                Number(limit) || 100
            )
        );
    }

    /* ========================================================
       COMMAND MEMORY
    ======================================================== */

    saveCommand(
        command,
        options = {}
    ) {

        this.ensure();

        const result =
            this.statements.commandInsert.run({

                command:
                    String(command),

                source:
                    options.source ||
                    'remote',

                user:
                    options.user ||
                    null,

                status:
                    options.status ||
                    'received',

                result:
                    this.serialize(
                        options.result ||
                        null
                    ),

                timestamp:
                    Date.now()
            });

        return result.lastInsertRowid;
    }

    /* ========================================================
       DECISION MEMORY
    ======================================================== */

    saveDecision(
        decision
    ) {

        this.ensure();

        const result =
            this.statements.decisionInsert.run({

                intent:
                    decision?.intent ||
                    null,

                goal:
                    decision?.goal ||
                    null,

                reason:
                    decision?.reason ||
                    null,

                priority:
                    decision?.priority ||
                    'normal',

                decision:
                    this.serialize(
                        decision
                    ),

                timestamp:
                    Date.now()
            });

        return result.lastInsertRowid;
    }

    /* ========================================================
       EVENT MEMORY
    ======================================================== */

    saveEvent(
        type,
        content
    ) {

        this.ensure();

        const result =
            this.statements.eventInsert.run({

                event_type:
                    String(type),

                content:
                    this.serialize(
                        content
                    ),

                timestamp:
                    Date.now()
            });

        return result.lastInsertRowid;
    }

    /* ========================================================
       PLAYER MEMORY
    ======================================================== */

    savePlayer(
        name,
        data = {}
    ) {

        this.ensure();

        const now =
            Date.now();

        const old =
            this.getPlayer(
                name
            );

        this.statements.playerUpsert.run({

            name:
                String(name),

            data:
                this.serialize(
                    data
                ),

            first_seen:
                old?.first_seen ||
                now,

            last_seen:
                now
        });
    }

    getPlayer(
        name
    ) {

        this.ensure();

        return this.db.prepare(`
            SELECT *
            FROM players
            WHERE name = ?
        `).get(
            String(name)
        ) || null;
    }

    getPlayers() {

        this.ensure();

        return this.db.prepare(`
            SELECT *
            FROM players
            ORDER BY last_seen DESC
        `).all();
    }

    /* ========================================================
       LOCATION MEMORY
    ======================================================== */

    saveLocation(
        name,
        position,
        description = ''
    ) {

        this.ensure();

        const result =
            this.db.prepare(`
                INSERT INTO locations
                (
                    name,
                    x,
                    y,
                    z,
                    dimension,
                    description,
                    created_at
                )
                VALUES
                (
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?,
                    ?
                )
            `).run(

                name || null,

                position?.x ?? null,

                position?.y ?? null,

                position?.z ?? null,

                position?.dimension ||
                    context.state.dimension,

                description,

                Date.now()
            );

        return result.lastInsertRowid;
    }

    searchLocations(
        text,
        limit = 50
    ) {

        this.ensure();

        return this.db.prepare(`
            SELECT *
            FROM locations
            WHERE name LIKE ?
               OR description LIKE ?
            ORDER BY created_at DESC
            LIMIT ?
        `).all(
            `%${String(text)}%`,
            `%${String(text)}%`,
            Math.max(
                1,
                Number(limit) || 50
            )
        );
    }

    /* ========================================================
       UNIVERSAL SEARCH
    ======================================================== */

    search(
        query,
        limit = 100
    ) {

        this.ensure();

        const q =
            String(query);

        const max =
            Math.max(
                1,
                Number(limit) || 100
            );

        const memories =
            this.db.prepare(`
                SELECT
                    'memory' AS source,
                    id,
                    type,
                    content,
                    importance,
                    created_at AS timestamp
                FROM memories
                WHERE content LIKE ?
                   OR key LIKE ?
                ORDER BY importance DESC, created_at DESC
                LIMIT ?
            `).all(
                `%${q}%`,
                `%${q}%`,
                max
            );

        const chats =
            this.db.prepare(`
                SELECT
                    'chat' AS source,
                    id,
                    sender AS type,
                    message AS content,
                    5 AS importance,
                    timestamp
                FROM chats
                WHERE message LIKE ?
                   OR sender LIKE ?
                ORDER BY timestamp DESC
                LIMIT ?
            `).all(
                `%${q}%`,
                `%${q}%`,
                max
            );

        const observations =
            this.db.prepare(`
                SELECT
                    'observation' AS source,
                    id,
                    category AS type,
                    content,
                    5 AS importance,
                    timestamp
                FROM observations
                WHERE content LIKE ?
                   OR subject LIKE ?
                   OR category LIKE ?
                ORDER BY timestamp DESC
                LIMIT ?
            `).all(
                `%${q}%`,
                `%${q}%`,
                `%${q}%`,
                max
            );

        return [
            ...memories,
            ...chats,
            ...observations
        ]
            .sort(
                (a, b) =>
                    b.timestamp -
                    a.timestamp
            )
            .slice(
                0,
                max
            );
    }

    /* ========================================================
       AI CONTEXT
    ======================================================== */

    getAIContext(
        query = ''
    ) {

        const contextData = {

            recentChats:
                this.getRecentChats(50),

            recentObservations:
                this.getRecentObservations(50),

            players:
                this.getPlayers(),

            relevantMemory:
                query
                    ? this.search(
                        query,
                        50
                    )
                    : []
        };

        return contextData;
    }

    /* ========================================================
       DELETE / FORGET
    ======================================================== */

    forget(
        id
    ) {

        this.ensure();

        return this.db.prepare(`
            DELETE FROM memories
            WHERE id = ?
        `).run(
            Number(id)
        ).changes;
    }

    /* ========================================================
       STATISTICS
    ======================================================== */

    statistics() {

        this.ensure();

        const tables = [
            'memories',
            'chats',
            'observations',
            'commands',
            'decisions',
            'events',
            'players',
            'locations'
        ];

        const result = {};

        for (
            const table of tables
        ) {

            result[table] =
                this.db.prepare(
                    `SELECT COUNT(*) AS count FROM ${table}`
                ).get().count;
        }

        return result;
    }

    /* ========================================================
       SERIALIZE
    ======================================================== */

    serialize(value) {

        if (
            typeof value === 'string'
        ) {

            return value;
        }

        try {

            return JSON.stringify(
                value
            );

        } catch (_) {

            return String(value);
        }
    }

    /* ========================================================
       ENSURE
    ======================================================== */

    ensure() {

        if (!this.initialized) {

            this.initialize();
        }
    }

    /* ========================================================
       CLOSE
    ======================================================== */

    close() {

        if (this.db) {

            this.db.close();

            this.db = null;
        }

        this.initialized = false;
    }

    status() {

        this.ensure();

        return {

            initialized:
                this.initialized,

            database:
                this.databasePath,

            statistics:
                this.statistics()
        };
    }
}

const memory =
    new MemoryManager();

module.exports =
    memory;

module.exports.MemoryManager =
    MemoryManager;
