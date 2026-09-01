'use strict';

const http = require('http');
const crypto = require('crypto');

const context = require('./core/agent-context');
const logger = require('./core/logger');

class CommandAPI {

    constructor() {

        this.server = null;
        this.running = false;

        this.host =
            context.config?.server?.host ||
            process.env.HTTP_HOST ||
            '0.0.0.0';

        this.port =
            Number(
                context.config?.server?.port ||
                process.env.HTTP_PORT ||
                3000
            );

        /*
         * API kaliti.
         *
         * .env ichida:
         *
         * COMMAND_API_KEY=your-secret-key
         *
         * Agar berilmagan bo‘lsa, vaqtinchalik
         * random key yaratiladi.
         */

        this.apiKey =
            process.env.COMMAND_API_KEY ||
            crypto.randomBytes(24).toString('hex');

        this.maxBodySize = 64 * 1024;

        context.register(
            'command-api',
            this
        );
    }

    start() {

        if (this.running) {

            logger.warn(
                'Command API allaqachon ishlayapti.'
            );

            return {
                success: true,
                alreadyRunning: true,
                port: this.port
            };
        }

        this.server =
            http.createServer(
                async (req, res) => {

                    try {

                        await this.handleRequest(
                            req,
                            res
                        );

                    } catch (error) {

                        logger.error(
                            'Command API request error.',
                            {
                                error:
                                    error.message
                            }
                        );

                        this.sendJson(
                            res,
                            500,
                            {
                                success: false,
                                error:
                                    'Internal server error.'
                            }
                        );
                    }
                }
            );

        this.server.on(
            'error',
            error => {

                logger.error(
                    'Command API server error.',
                    {
                        error:
                            error.message
                    }
                );

                this.running = false;
            }
        );

        this.server.listen(
            this.port,
            this.host,
            () => {

                this.running = true;

                logger.success(
                    `Command API ishga tushdi: ${this.host}:${this.port}`
                );

                logger.info(
                    `Command API endpoint: POST /command`
                );

                logger.info(
                    `Command API status: GET /status`
                );
            }
        );

        return {
            success: true,
            host: this.host,
            port: this.port
        };
    }

    async stop() {

        if (!this.server) {

            this.running = false;

            return {
                success: true
            };
        }

        return new Promise(
            resolve => {

                this.server.close(
                    () => {

                        this.server = null;
                        this.running = false;

                        logger.info(
                            'Command API to‘xtatildi.'
                        );

                        resolve({
                            success: true
                        });
                    }
                );
            }
        );
    }

    async handleRequest(
        req,
        res
    ) {

        this.setCorsHeaders(
            res
        );

        /*
         * OPTIONS — CORS preflight
         */

        if (
            req.method ===
            'OPTIONS'
        ) {

            res.writeHead(
                204
            );

            res.end();

            return;
        }

        const url =
            new URL(
                req.url,
                `http://${req.headers.host || 'localhost'}`
            );

        /*
         * --------------------------------------------------
         * GET /
         * --------------------------------------------------
         */

        if (
            req.method === 'GET' &&
            url.pathname === '/'
        ) {

            this.sendJson(
                res,
                200,
                {
                    success: true,
                    name: 'AKV Minecraft AI Command API',
                    version: '1.0.0',
                    endpoints: {
                        status:
                            'GET /status',

                        command:
                            'POST /command'
                    }
                }
            );

            return;
        }

        /*
         * --------------------------------------------------
         * GET /status
         * --------------------------------------------------
         */

        if (
            req.method === 'GET' &&
            url.pathname === '/status'
        ) {

            const minecraft =
                context.get(
                    'minecraft'
                );

            const executor =
                context.get(
                    'command-executor'
                );

            const router =
                context.get(
                    'command-router'
                );

            this.sendJson(
                res,
                200,
                {
                    success: true,

                    api: {
                        running:
                            this.running,

                        host:
                            this.host,

                        port:
                            this.port
                    },

                    minecraft: {
                        connected:
                            Boolean(
                                context.state?.connected
                            ),

                        spawned:
                            Boolean(
                                context.state?.spawned
                            ),

                        authenticated:
                            Boolean(
                                context.state?.authenticated
                            )
                    },

                    modules: {
                        minecraft:
                            Boolean(minecraft),

                        commandExecutor:
                            Boolean(executor),

                        commandRouter:
                            Boolean(router)
                    },

                    state: {
                        position:
                            context.state?.position ||
                            null,

                        health:
                            context.state?.health ||
                            null,

                        hunger:
                            context.state?.hunger ||
                            null,

                        currentTask:
                            context.state?.currentTask ||
                            null,

                        autonomousMode:
                            Boolean(
                                context.state?.autonomousMode
                            )
                    }
                }
            );

            return;
        }

        /*
         * --------------------------------------------------
         * POST /command
         * --------------------------------------------------
         */

        if (
            req.method === 'POST' &&
            url.pathname === '/command'
        ) {

            /*
             * API authentication
             */

            if (
                !this.authorize(req)
            ) {

                this.sendJson(
                    res,
                    401,
                    {
                        success: false,
                        error:
                            'Unauthorized.'
                    }
                );

                return;
            }

            const body =
                await this.readBody(
                    req
                );

            let payload;

            try {

                payload =
                    JSON.parse(body);

            } catch (_) {

                this.sendJson(
                    res,
                    400,
                    {
                        success: false,
                        error:
                            'Request JSON formatida bo‘lishi kerak.'
                    }
                );

                return;
            }

            const command =
                payload.command ||
                payload.text ||
                payload.message ||
                payload.prompt;

            if (
                typeof command !==
                'string' ||
                !command.trim()
            ) {

                this.sendJson(
                    res,
                    400,
                    {
                        success: false,
                        error:
                            'command maydoni kerak.'
                    }
                );

                return;
            }

            if (
                command.length >
                4000
            ) {

                this.sendJson(
                    res,
                    400,
                    {
                        success: false,
                        error:
                            'Buyruq juda uzun. Maksimum 4000 belgi.'
                    }
                );

                return;
            }

            const executor =
                context.get(
                    'command-executor'
                );

            /*
             * Agar executor hali contextga
             * ro‘yxatdan o‘tmagan bo‘lsa,
             * command-router fallback.
             */

            if (!executor) {

                const router =
                    context.get(
                        'command-router'
                    );

                if (!router) {

                    this.sendJson(
                        res,
                        503,
                        {
                            success: false,
                            error:
                                'Command Executor va Command Router topilmadi.'
                        }
                    );

                    return;
                }

                const result =
                    await router.handle(
                        command.trim(),
                        'api',
                        payload.user ||
                        null
                    );

                this.sendJson(
                    res,
                    200,
                    {
                        success:
                            result?.success !== false,

                        result
                    }
                );

                return;
            }

            /*
             * Asosiy execution
             */

            const result =
                await executor.handleExternal({

                    command:
                        command.trim(),

                    source:
                        'api',

                    channel:
                        'http-api',

                    user:
                        payload.user ||
                        payload.username ||
                        payload.userId ||
                        null,

                    requestId:
                        payload.requestId ||
                        null,

                    raw:
                        payload
                });

            const formatted =
                typeof executor.formatResponse ===
                'function'
                    ? executor.formatResponse(result)
                    : {
                        text:
                            result?.success === false
                                ? `❌ ${result.error || 'Buyruq bajarilmadi.'}`
                                : '✅ Buyruq bajarildi.',
                        success:
                            result?.success !== false
                    };

            logger.info(
                `External command received: ${command.trim()}`,
                {
                    source: 'api',
                    user:
                        payload.user ||
                        payload.username ||
                        null
                }
            );

            this.sendJson(
                res,
                result?.success === false
                    ? 400
                    : 200,
                {
                    success:
                        result?.success !== false,

                    message:
                        formatted.text,

                    requestId:
                        result?.requestId ||
                        null,

                    result
                }
            );

            return;
        }

        /*
         * --------------------------------------------------
         * 404
         * --------------------------------------------------
         */

        this.sendJson(
            res,
            404,
            {
                success: false,
                error:
                    'Endpoint topilmadi.'
            }
        );
    }

    authorize(req) {

        const receivedKey =
            req.headers['x-api-key'];

        if (
            !receivedKey
        ) {

            return false;
        }

        return this.safeCompare(
            String(receivedKey),
            String(this.apiKey)
        );
    }

    safeCompare(
        a,
        b
    ) {

        const first =
            Buffer.from(
                a,
                'utf8'
            );

        const second =
            Buffer.from(
                b,
                'utf8'
            );

        if (
            first.length !==
            second.length
        ) {

            return false;
        }

        return crypto.timingSafeEqual(
            first,
            second
        );
    }

    readBody(req) {

        return new Promise(
            (resolve, reject) => {

                let body = '';

                let size = 0;

                req.setEncoding(
                    'utf8'
                );

                req.on(
                    'data',
                    chunk => {

                        size +=
                            Buffer.byteLength(
                                chunk,
                                'utf8'
                            );

                        if (
                            size >
                            this.maxBodySize
                        ) {

                            reject(
                                new Error(
                                    'Request body juda katta.'
                                )
                            );

                            req.destroy();

                            return;
                        }

                        body += chunk;
                    }
                );

                req.on(
                    'end',
                    () => {

                        resolve(
                            body
                        );
                    }
                );

                req.on(
                    'error',
                    error => {

                        reject(
                            error
                        );
                    }
                );
            }
        );
    }

    setCorsHeaders(
        res
    ) {

        res.setHeader(
            'Access-Control-Allow-Origin',
            '*'
        );

        res.setHeader(
            'Access-Control-Allow-Methods',
            'GET, POST, OPTIONS'
        );

        res.setHeader(
            'Access-Control-Allow-Headers',
            'Content-Type, X-API-Key'
        );

        res.setHeader(
            'Content-Type',
            'application/json; charset=utf-8'
        );
    }

    sendJson(
        res,
        status,
        data
    ) {

        try {

            res.writeHead(
                status
            );

            res.end(
                JSON.stringify(
                    data,
                    null,
                    2
                )
            );

        } catch (error) {

            logger.error(
                'Command API response error.',
                {
                    error:
                        error.message
                }
            );
        }
    }

    status() {

        return {

            running:
                this.running,

            host:
                this.host,

            port:
                this.port,

            endpoint:
                '/command'
        };
    }
}

const commandAPI =
    new CommandAPI();

module.exports =
    commandAPI;

module.exports.CommandAPI =
    CommandAPI;
