'use strict';

const context = require('../core/agent-context');
const logger = require('../core/logger');

class Pathfinder {

    constructor() {

        this.running = false;

        this.active = false;

        this.currentTarget = null;

        this.followTarget = null;

        this.currentPath = [];

        this.pathIndex = 0;

        this.recalculateInterval = 500;

        this.followDistance = 3;

        this.arrivalDistance = 1.5;

        this.maxIterations = 5000;

        this.stopRequested = false;

        this.history = [];

        this.maxHistory = 500;
    }

    start() {

        if (this.running) {
            return;
        }

        this.running = true;

        logger.info(
            'Pathfinder ishga tushdi.'
        );
    }

    async goto(target, options = {}) {

        this.start();

        if (
            !target ||
            !this.validPosition(target)
        ) {

            return {

                success: false,

                error:
                    'Pathfinder: noto‘g‘ri target.'
            };
        }

        this.stopRequested = false;

        this.active = true;

        this.currentTarget = {
            x:
                Number(target.x),

            y:
                Number(target.y),

            z:
                Number(target.z)
        };

        this.pathIndex = 0;

        context.eventBus.emitSafe(
            'pathfinding:started',
            {
                target:
                    this.currentTarget
            }
        );

        try {

            const path =
                await this.calculatePath(
                    this.getPosition(),
                    this.currentTarget,
                    options
                );

            if (
                this.stopRequested
            ) {

                return {

                    success: false,

                    stopped: true
                };
            }

            if (
                !path ||
                !path.length
            ) {

                return {

                    success: false,

                    error:
                        'Maqsadgacha yo‘l topilmadi.'
                };
            }

            this.currentPath =
                path;

            context.eventBus.emitSafe(
                'pathfinding:path_found',
                {
                    target:
                        this.currentTarget,

                    pathLength:
                        path.length
                }
            );

            const result =
                await this.followPath(
                    path
                );

            this.history.push({

                type:
                    'goto',

                target:
                    this.currentTarget,

                pathLength:
                    path.length,

                result,

                timestamp:
                    Date.now()
            });

            if (
                this.history.length >
                this.maxHistory
            ) {

                this.history.shift();
            }

            return result;

        } finally {

            this.active = false;

            this.currentTarget = null;

            this.currentPath = [];

            this.pathIndex = 0;

            context.eventBus.emitSafe(
                'pathfinding:finished',
                {}
            );
        }
    }

    async follow(
        playerName,
        options = {}
    ) {

        this.start();

        this.stopRequested = false;

        this.active = true;

        this.followTarget =
            String(playerName);

        context.eventBus.emitSafe(
            'pathfinding:follow_started',
            {
                player:
                    this.followTarget
            }
        );

        try {

            while (
                !this.stopRequested
            ) {

                if (
                    typeof options.stopSignal ===
                    'function' &&
                    options.stopSignal()
                ) {

                    break;
                }

                const player =
                    this.findPlayer(
                        this.followTarget
                    );

                if (!player) {

                    await this.sleep(
                        this.recalculateInterval
                    );

                    continue;
                }

                const position =
                    this.extractPlayerPosition(
                        player
                    );

                if (
                    !position
                ) {

                    await this.sleep(
                        this.recalculateInterval
                    );

                    continue;
                }

                const distance =
                    this.distance(
                        this.getPosition(),
                        position
                    );

                if (
                    distance <=
                    this.followDistance
                ) {

                    await this.sleep(
                        this.recalculateInterval
                    );

                    continue;
                }

                const result =
                    await this.goto(
                        position,
                        {
                            follow: true
                        }
                    );

                if (
                    !result.success &&
                    !result.stopped
                ) {

                    await this.sleep(
                        this.recalculateInterval
                    );
                }
            }

            return {

                success: true,

                stopped:
                    this.stopRequested,

                target:
                    this.followTarget
            };

        } finally {

            this.active = false;

            this.followTarget = null;

            context.eventBus.emitSafe(
                'pathfinding:follow_finished',
                {}
            );
        }
    }

    async calculatePath(
        start,
        target,
        options = {}
    ) {

        const direct =
            this.tryDirectPath(
                start,
                target
            );

        if (direct) {
            return direct;
        }

        const world =
            this.getWorld();

        /*
        World scanner mavjud bo‘lsa,
        haqiqiy bloklarni tekshiramiz.
        */

        if (
            world &&
            typeof world.isWalkable ===
                'function'
        ) {

            return this.aStar(
                start,
                target,
                world,
                options
            );
        }

        /*
        Scanner hali ulanmagan bo‘lsa,
        taxminiy grid yo‘li.
        Keyingi Bedrock world adapter
        haqiqiy blok ma'lumotlarini beradi.
        */

        return this.gridPath(
            start,
            target
        );
    }

    tryDirectPath(
        start,
        target
    ) {

        const distance =
            this.distance(
                start,
                target
            );

        if (
            distance < 1
        ) {

            return [
                target
            ];
        }

        const steps =
            Math.ceil(
                distance
            );

        if (
            steps > 100
        ) {

            return null;
        }

        const path = [];

        for (
            let i = 1;
            i <= steps;
            i++
        ) {

            const ratio =
                i / steps;

            path.push({

                x:
                    start.x +
                    (
                        target.x -
                        start.x
                    ) *
                    ratio,

                y:
                    start.y +
                    (
                        target.y -
                        start.y
                    ) *
                    ratio,

                z:
                    start.z +
                    (
                        target.z -
                        start.z
                    ) *
                    ratio
            });
        }

        return path;
    }

    gridPath(
        start,
        target
    ) {

        const path = [];

        let x =
            Math.round(
                start.x
            );

        let y =
            Math.round(
                start.y
            );

        let z =
            Math.round(
                start.z
            );

        const tx =
            Math.round(
                target.x
            );

        const ty =
            Math.round(
                target.y
            );

        const tz =
            Math.round(
                target.z
            );

        let iterations = 0;

        while (
            (
                x !== tx ||
                y !== ty ||
                z !== tz
            ) &&
            iterations <
            this.maxIterations
        ) {

            iterations++;

            if (
                x !== tx
            ) {

                x +=
                    Math.sign(
                        tx - x
                    );

            } else if (
                z !== tz
            ) {

                z +=
                    Math.sign(
                        tz - z
                    );

            } else if (
                y !== ty
            ) {

                y +=
                    Math.sign(
                        ty - y
                    );
            }

            path.push({

                x,
                y,
                z
            });
        }

        if (
            x !== tx ||
            y !== ty ||
            z !== tz
        ) {

            return null;
        }

        return path;
    }

    async aStar(
        start,
        target,
        world,
        options = {}
    ) {

        const startNode =
            this.node(
                start
            );

        const targetNode =
            this.node(
                target
            );

        const open = new Map();

        const closed = new Set();

        const cameFrom = new Map();

        const gScore = new Map();

        const fScore = new Map();

        const startKey =
            this.key(
                startNode
            );

        open.set(
            startKey,
            startNode
        );

        gScore.set(
            startKey,
            0
        );

        fScore.set(
            startKey,
            this.heuristic(
                startNode,
                targetNode
            )
        );

        let iterations = 0;

        while (
            open.size &&
            iterations <
            this.maxIterations
        ) {

            if (
                this.stopRequested
            ) {

                return null;
            }

            iterations++;

            const current =
                this.lowestF(
                    open,
                    fScore
                );

            const currentKey =
                this.key(
                    current
                );

            if (
                this.key(
                    current
                ) ===
                this.key(
                    targetNode
                )
            ) {

                return this.reconstructPath(
                    cameFrom,
                    current
                );
            }

            open.delete(
                currentKey
            );

            closed.add(
                currentKey
            );

            const neighbors =
                await this.getNeighbors(
                    current,
                    world
                );

            for (
                const neighbor of neighbors
            ) {

                const neighborKey =
                    this.key(
                        neighbor
                    );

                if (
                    closed.has(
                        neighborKey
                    )
                ) {
                    continue;
                }

                const movementCost =
                    this.movementCost(
                        current,
                        neighbor
                    );

                const currentG =
                    gScore.get(
                        currentKey
                    ) ??
                    Infinity;

                const tentative =
                    currentG +
                    movementCost;

                const previous =
                    gScore.get(
                        neighborKey
                    ) ??
                    Infinity;

                if (
                    tentative <
                    previous
                ) {

                    cameFrom.set(
                        neighborKey,
                        current
                    );

                    gScore.set(
                        neighborKey,
                        tentative
                    );

                    fScore.set(
                        neighborKey,
                        tentative +
                        this.heuristic(
                            neighbor,
                            targetNode
                        )
                    );

                    open.set(
                        neighborKey,
                        neighbor
                    );
                }
            }
        }

        return null;
    }

    async getNeighbors(
        node,
        world
    ) {

        const directions = [

            [1, 0, 0],

            [-1, 0, 0],

            [0, 0, 1],

            [0, 0, -1],

            [1, 1, 0],

            [-1, 1, 0],

            [0, 1, 1],

            [0, 1, -1],

            [0, -1, 0]
        ];

        const result = [];

        for (
            const direction of directions
        ) {

            const candidate = {

                x:
                    node.x +
                    direction[0],

                y:
                    node.y +
                    direction[1],

                z:
                    node.z +
                    direction[2]
            };

            if (
                await this.canStand(
                    candidate,
                    world
                )
            ) {

                result.push(
                    candidate
                );
            }
        }

        return result;
    }

    async canStand(
        position,
        world
    ) {

        if (
            !world ||
            typeof world.isWalkable !==
                'function'
        ) {

            return true;
        }

        try {

            return Boolean(
                await world.isWalkable(
                    position
                )
            );

        } catch (_) {

            return false;
        }
    }

    reconstructPath(
        cameFrom,
        current
    ) {

        const path = [
            current
        ];

        let currentKey =
            this.key(
                current
            );

        while (
            cameFrom.has(
                currentKey
            )
        ) {

            const previous =
                cameFrom.get(
                    currentKey
                );

            path.unshift(
                previous
            );

            currentKey =
                this.key(
                    previous
                );
        }

        return path;
    }

    async followPath(
        path
    ) {

        const movement =
            context.get(
                'movement'
            ) ||
            context.get(
                'movement-engine'
            );

        const adapter =
            context.get(
                'movement-adapter'
            );

        if (
            movement &&
            typeof movement.getPosition ===
                'function'
        ) {

            for (
                let i = 0;
                i < path.length;
                i++
            ) {

                if (
                    this.stopRequested
                ) {

                    return {

                        success: false,

                        stopped: true,

                        reached:
                            false
                    };
                }

                this.pathIndex =
                    i;

                const waypoint =
                    path[i];

                const current =
                    movement.getPosition();

                const distance =
                    this.distance(
                        current,
                        waypoint
                    );

                if (
                    distance <=
                    this.arrivalDistance
                ) {

                    continue;
                }

                if (
                    adapter &&
                    typeof adapter.moveTo ===
                        'function'
                ) {

                    const result =
                        await adapter.moveTo(
                            waypoint
                        );

                    if (
                        result?.success ===
                        false
                    ) {

                        return {

                            success: false,

                            reached: false,

                            failedAt:
                                waypoint,

                            reason:
                                result.error ||
                                'Movement adapter failed.'
                        };
                    }

                } else {

                    const direction =
                        this.directionTo(
                            current,
                            waypoint
                        );

                    if (
                        movement.direction
                    ) {

                        await movement.direction({

                            direction,

                            duration:
                                300,

                            speed:
                                1
                        });
                    } else {

                        return {

                            success: false,

                            reached: false,

                            error:
                                'Movement adapter topilmadi.'
                        };
                    }
                }

                await this.sleep(
                    50
                );
            }
        }

        return {

            success: true,

            reached: true,

            pathLength:
                path.length
        };
    }

    directionTo(
        from,
        to
    ) {

        const dx =
            to.x -
            from.x;

        const dz =
            to.z -
            from.z;

        if (
            Math.abs(dx) >
            Math.abs(dz)
        ) {

            return dx >= 0
                ? 'right'
                : 'left';
        }

        return dz >= 0
            ? 'forward'
            : 'back';
    }

    findPlayer(
        name
    ) {

        const worldObserver =
            context.get(
                'world-observer'
            ) ||
            context.get(
                'observer'
            );

        if (
            worldObserver &&
            typeof worldObserver.getPlayer ===
                'function'
        ) {

            return worldObserver.getPlayer(
                name
            );
        }

        const memory =
            context.get(
                'memory'
            );

        if (
            memory &&
            typeof memory.getPlayer ===
                'function'
        ) {

            return memory.getPlayer(
                name
            );
        }

        return null;
    }

    extractPlayerPosition(
        player
    ) {

        return (
            player?.position ||
            player?.pos ||
            player?.coordinates ||
            null
        );
    }

    getWorld() {

        return (
            context.get(
                'world'
            ) ||
            context.get(
                'world-scanner'
            ) ||
            context.get(
                'world-observer'
            ) ||
            null
        );
    }

    getPosition() {

        const state =
            context.state;

        return {

            x:
                Number(
                    state.position?.x
                ) || 0,

            y:
                Number(
                    state.position?.y
                ) || 0,

            z:
                Number(
                    state.position?.z
                ) || 0
        };
    }

    node(position) {

        return {

            x:
                Math.round(
                    Number(position.x)
                ),

            y:
                Math.round(
                    Number(position.y)
                ),

            z:
                Math.round(
                    Number(position.z)
                )
        };
    }

    key(node) {

        return (
            `${node.x},` +
            `${node.y},` +
            `${node.z}`
        );
    }

    heuristic(
        a,
        b
    ) {

        return (
            Math.abs(
                a.x - b.x
            ) +

            Math.abs(
                a.y - b.y
            ) +

            Math.abs(
                a.z - b.z
            )
        );
    }

    movementCost(
        a,
        b
    ) {

        const dy =
            Math.abs(
                a.y - b.y
            );

        return dy > 0
            ? 1.4
            : 1;
    }

    lowestF(
        open,
        fScore
    ) {

        let best = null;

        let bestScore =
            Infinity;

        for (
            const [key, node]
            of open
        ) {

            const score =
                fScore.get(
                    key
                ) ??
                Infinity;

            if (
                score <
                bestScore
            ) {

                bestScore =
                    score;

                best =
                    node;
            }
        }

        return best;
    }

    distance(
        a,
        b
    ) {

        const dx =
            a.x - b.x;

        const dy =
            a.y - b.y;

        const dz =
            a.z - b.z;

        return Math.sqrt(
            dx * dx +
            dy * dy +
            dz * dz
        );
    }

    validPosition(
        position
    ) {

        return (
            Number.isFinite(
                Number(position.x)
            ) &&

            Number.isFinite(
                Number(position.y)
            ) &&

            Number.isFinite(
                Number(position.z)
            )
        );
    }

    stop() {

        this.stopRequested = true;

        this.active = false;

        this.currentTarget = null;

        this.currentPath = [];

        this.pathIndex = 0;

        this.followTarget = null;

        context.eventBus.emitSafe(
            'pathfinding:stopped',
            {}
        );

        logger.info(
            'Pathfinder to‘xtatildi.'
        );

        return {

            success: true,

            stopped: true
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

    status() {

        return {

            running:
                this.running,

            active:
                this.active,

            currentTarget:
                this.currentTarget,

            followTarget:
                this.followTarget,

            pathLength:
                this.currentPath.length,

            pathIndex:
                this.pathIndex,

            stopped:
                this.stopRequested
        };
    }
}

const pathfinder =
    new Pathfinder();

module.exports =
    pathfinder;

module.exports.Pathfinder =
    Pathfinder;
