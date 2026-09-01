'use strict';

const http = require('http');
const context = require('./core/agent-context');

const PORT = Number(
process.env.COMMAND_API_PORT || 3000
);

const HOST =
process.env.COMMAND_API_HOST || '0.0.0.0';

let server = null;

function jsonResponse(res, statusCode, data) {
const body = JSON.stringify(data);

res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
});

res.end(body);

}

function readBody(req) {
return new Promise((resolve, reject) => {

    let body = '';

    req.on('data', chunk => {

        body += chunk.toString();

        // Juda katta requestni qabul qilmaymiz.
        if (body.length > 10000) {
            reject(
                new Error('Request juda katta.')
            );

            req.destroy();
        }
    });

    req.on('end', () => {
        resolve(body);
    });

    req.on('error', reject);
});

}

async function handleCommand(req, res) {

try {

    const raw =
        await readBody(req);

    let payload = {};

    if (raw.trim()) {

        try {

            payload =
                JSON.parse(raw);

        } catch (_) {

            return jsonResponse(
                res,
                400,
                {
                    success: false,
                    error:
                        'JSON noto‘g‘ri.'
                }
            );
        }
    }

    const command =
        payload.command ||
        payload.text ||
        payload.message;

    if (
        typeof command !== 'string' ||
        !command.trim()
    ) {

        return jsonResponse(
            res,
            400,
            {
                success: false,
                error:
                    'command maydoni kerak.'
            }
        );
    }

    /*
     * Command Executor mavjud bo‘lsa,
     * undan foydalanamiz.
     */

    const executor =
        context.get(
            'command-executor'
        );

    if (
        executor &&
        typeof executor.handleExternal ===
        'function'
    ) {

        const result =
            await executor.handleExternal({

                command:
                    command.trim(),

                source:
                    'http',

                channel:
                    'command-api',

                user:
                    payload.user ||
                    'external',

                requestId:
                    payload.requestId ||
                    null
            });

        return jsonResponse(
            res,
            200,
            result
        );
    }

    /*
     * Executor bo‘lmasa,
     * command-router fallback.
     */

    const router =
        context.get(
            'command-router'
        );

    if (
        router &&
        typeof router.handle ===
        'function'
    ) {

        const result =
            await router.handle(
                command.trim(),
                'http',
                payload.user ||
                'external'
            );

        return jsonResponse(
            res,
            200,
            result
        );
    }

    return jsonResponse(
        res,
        503,
        {
            success: false,
            error:
                'Command Executor yoki Command Router hali ishga tushmagan.'
        }
    );

} catch (error) {

    return jsonResponse(
        res,
        500,
        {
            success: false,
            error:
                error.message
        }
    );
}

}

function handleHealth(req, res) {

const executor =
    context.get(
        'command-executor'
    );

const router =
    context.get(
        'command-router'
    );

jsonResponse(
    res,
    200,
    {
        success: true,

        service:
            'AKV Command API',

        running:
            true,

        executor:
            Boolean(executor),

        router:
            Boolean(router),

        minecraft:
            context.state
                ? {
                    connected:
                        context.state.connected,

                    spawned:
                        context.state.spawned
                }
                : null,

        timestamp:
            new Date().toISOString()
    }
);

}

function start() {

if (server) {
    return server;
}

server =
    http.createServer(
        async (req, res) => {

            /*
             * CORS
             */

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
                'Content-Type'
            );

            if (
                req.method ===
                'OPTIONS'
            ) {

                res.writeHead(
                    204
                );

                return res.end();
            }

            /*
             * Health
             */

            if (
                req.method === 'GET' &&
                req.url === '/health'
            ) {

                return handleHealth(
                    req,
                    res
                );
            }

            /*
             * Command endpoint
             */

            if (
                req.method === 'POST' &&
                req.url === '/command'
            ) {

                return handleCommand(
                    req,
                    res
                );
            }

            /*
             * API haqida ma'lumot
             */

            if (
                req.method === 'GET' &&
                req.url === '/'
            ) {

                return jsonResponse(
                    res,
                    200,
                    {
                        success: true,

                        service:
                            'AKV Command API',

                        endpoints: {
                            health:
                                'GET /health',

                            command:
                                'POST /command'
                        },

                        example: {
                            command:
                                'oldinga yur'
                        }
                    }
                );
            }

            return jsonResponse(
                res,
                404,
                {
                    success: false,
                    error:
                        'Endpoint topilmadi.'
                }
            );
        }
    );

server.listen(
    PORT,
    HOST,
    () => {

        console.log(
            `[COMMAND API] Ishga tushdi: ${HOST}:${PORT}`
        );

        console.log(
            `[COMMAND API] Buyruq endpoint: POST /command`
        );

        console.log(
            `[COMMAND API] Health endpoint: GET /health`
        );
    }
);

server.on(
    'error',
    error => {

        console.error(
            '[COMMAND API] Server xatosi:',
            error.message
        );
    }
);

return server;

}

function stop() {

if (!server) {
    return;
}

server.close();

server = null;

}

module.exports = {

start,

stop

};
