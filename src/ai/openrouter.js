'use strict';

const https = require('https');
const config = require('../config');
const logger = require('../core/logger');

class OpenRouter {

    constructor() {
        this.apiKey = config.openrouter.apiKey;
        this.baseURL = config.openrouter.baseURL;
        this.timeout = config.openrouter.timeout;
        this.maxRetries = config.openrouter.maxRetries;
    }

    async chat(messages, options = {}) {

        if (!this.apiKey) {
            throw new Error(
                'OPENROUTER_API_KEY topilmadi.'
            );
        }

        const body = JSON.stringify({
            model:
                options.model ||
                config.ai.model,

            messages,

            temperature:
                options.temperature ??
                config.ai.temperature,

            max_tokens:
                options.maxTokens ||
                config.ai.maxTokens
        });

        let lastError = null;

        for (
            let attempt = 1;
            attempt <= this.maxRetries;
            attempt++
        ) {

            try {

                const result =
                    await this.request(
                        body
                    );

                const answer =
                    result
                        ?.choices?.[0]
                        ?.message
                        ?.content;

                if (!answer) {
                    throw new Error(
                        'AI javobi bo‘sh.'
                    );
                }

                logger.ai(
                    'OpenRouter javobi olindi.',
                    {
                        model:
                            options.model ||
                            config.ai.model
                    }
                );

                return answer;

            } catch (error) {

                lastError = error;

                logger.warn(
                    `OpenRouter urinish #${attempt} muvaffaqiyatsiz.`,
                    {
                        error:
                            error.message
                    }
                );

                if (
                    attempt <
                    this.maxRetries
                ) {

                    await this.sleep(
                        1000 * attempt
                    );
                }
            }
        }

        throw lastError;
    }

    request(body) {

        return new Promise(
            (resolve, reject) => {

                const url =
                    new URL(
                        `${this.baseURL}/chat/completions`
                    );

                const request =
                    https.request(
                        {
                            hostname:
                                url.hostname,

                            port:
                                443,

                            path:
                                url.pathname,

                            method:
                                'POST',

                            timeout:
                                this.timeout,

                            headers: {
                                'Content-Type':
                                    'application/json',

                                'Authorization':
                                    `Bearer ${this.apiKey}`,

                                'HTTP-Referer':
                                    'https://github.com/',

                                'X-Title':
                                    'AKV Minecraft AI'
                            }
                        },
                        response => {

                            let data = '';

                            response.on(
                                'data',
                                chunk => {
                                    data += chunk;
                                }
                            );

                            response.on(
                                'end',
                                () => {

                                    let parsed;

                                    try {

                                        parsed =
                                            JSON.parse(
                                                data
                                            );

                                    } catch (_) {

                                        return reject(
                                            new Error(
                                                `OpenRouter JSON xatosi: HTTP ${response.statusCode}`
                                            )
                                        );
                                    }

                                    if (
                                        response.statusCode <
                                            200 ||
                                        response.statusCode >=
                                            300
                                    ) {

                                        return reject(
                                            new Error(
                                                parsed?.error?.message ||
                                                `OpenRouter HTTP ${response.statusCode}`
                                            )
                                        );
                                    }

                                    resolve(
                                        parsed
                                    );
                                }
                            );
                        }
                    );

                request.on(
                    'timeout',
                    () => {

                        request.destroy();

                        reject(
                            new Error(
                                'OpenRouter timeout.'
                            )
                        );
                    }
                );

                request.on(
                    'error',
                    reject
                );

                request.write(
                    body
                );

                request.end();
            }
        );
    }

    async decide(
        systemPrompt,
        worldState,
        userCommand = null
    ) {

        const messages = [

            {
                role: 'system',
                content:
                    systemPrompt
            },

            {
                role: 'system',
                content:
                    `Minecraft dunyosining joriy holati:\n${JSON.stringify(
                        worldState
                    )}`
            }
        ];

        if (userCommand) {

            messages.push({
                role: 'user',
                content:
                    userCommand
            });
        }

        return this.chat(
            messages
        );
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
}

module.exports =
    new OpenRouter();

module.exports.OpenRouter =
    OpenRouter;
