'use strict';

const https = require('https');
const context = require('../core/agent-context');
const logger = require('../core/logger');

class GitHubGateway {

    constructor(options = {}) {
        this.name = 'github-gateway';
        this.running = false;

        this.token =
            options.token ||
            process.env.GITHUB_TOKEN ||
            '';

        this.owner =
            options.owner ||
            process.env.GITHUB_OWNER ||
            '';

        this.repo =
            options.repo ||
            process.env.GITHUB_REPO ||
            '';

        this.issueNumber =
            options.issueNumber ||
            process.env.GITHUB_ISSUE_NUMBER ||
            '';

        this.pollInterval =
            Number(
                options.pollInterval ||
                5000
            );

        this.timer = null;
        this.lastCommentId = null;

        context.register(
            'github-gateway',
            this
        );
    }

    async start() {

        if (this.running) {
            return {
                success: true,
                alreadyRunning: true
            };
        }

        if (
            !this.token ||
            !this.owner ||
            !this.repo ||
            !this.issueNumber
        ) {

            logger.warn(
                'GitHub Gateway sozlanmagan. GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO va GITHUB_ISSUE_NUMBER kerak.'
            );

            return {
                success: false,
                disabled: true
            };
        }

        this.running = true;

        await this.poll();

        this.timer =
            setInterval(
                () => {
                    this.poll()
                        .catch(error => {
                            logger.warn(
                                `GitHub polling xatosi: ${error.message}`
                            );
                        });
                },
                this.pollInterval
            );

        logger.info(
            'GitHub Gateway ishga tushdi.'
        );

        return {
            success: true
        };
    }

    async stop() {

        this.running = false;

        if (this.timer) {
            clearInterval(
                this.timer
            );
            this.timer = null;
        }

        return {
            success: true
        };
    }

    async poll() {

        if (!this.running) {
            return;
        }

        const comments =
            await this.githubRequest(
                `/repos/${this.owner}/${this.repo}/issues/${this.issueNumber}/comments?per_page=20`
            );

        if (
            !Array.isArray(comments)
        ) {
            return;
        }

        /*
         * GitHub commentlar eski -> yangi tartibda keladi.
         */

        for (
            const comment of comments
        ) {

            if (
                this.lastCommentId !== null &&
                Number(comment.id) <=
                Number(this.lastCommentId)
            ) {
                continue;
            }

            /*
             * Birinchi pollingda eski commentlarni
             * buyruq sifatida bajarmaymiz.
             */

            if (
                this.lastCommentId === null
            ) {

                this.lastCommentId =
                    Number(comment.id);

                continue;
            }

            this.lastCommentId =
                Math.max(
                    Number(this.lastCommentId),
                    Number(comment.id)
                );

            await this.handleComment(
                comment
            );
        }
    }

    async handleComment(
        comment
    ) {

        const body =
            String(
                comment.body || ''
            ).trim();

        if (!body) {
            return;
        }

        /*
         * Botning o'zi yozgan commentlarni
         * qayta buyruq qilmaslik.
         */

        if (
            comment.user &&
            comment.user.type === 'Bot'
        ) {
            return;
        }

        const gateway =
            context.get(
                'command-gateway'
            );

        if (
            !gateway ||
            typeof gateway.receive !==
            'function'
        ) {

            logger.warn(
                'Command Gateway topilmadi.'
            );

            return;
        }

        const result =
            await gateway.receive(
                {
                    text:
                        body,

                    source:
                        'github',

                    channel:
                        'github',

                    user:
                        {
                            id:
                                comment.user?.id,

                            username:
                                comment.user?.login,

                            name:
                                comment.user?.login
                        },

                    metadata:
                        {
                            commentId:
                                comment.id,

                            issueNumber:
                                this.issueNumber,

                            url:
                                comment.html_url
                        }
                }
            );

        await this.replyToComment(
            this.buildCommandResponse(
                result
            )
        );
    }

    buildCommandResponse(
        result
    ) {

        if (
            result?.success
        ) {

            return [
                '🤖 AI Agent',
                '',
                '✅ Buyruq qabul qilindi.',
                `🆔 Request: ${result.requestId || 'N/A'}`,
                `⚙️ Buyruq: ${this.commandName(result.command)}`
            ].join('\n');
        }

        return [
            '🤖 AI Agent',
            '',
            `❌ Buyruq bajarilmadi: ${result?.error || 'Noma’lum xato'}`
        ].join('\n');
    }

    commandName(
        command
    ) {

        return String(
            command?.type ||
            'ai'
        );
    }

    async replyToComment(
        text
    ) {

        return this.createIssueComment(
            text
        );
    }

    async sendNotification(
        text
    ) {

        return this.createIssueComment(
            text
        );
    }

    async createIssueComment(
        body
    ) {

        if (
            !this.token ||
            !this.owner ||
            !this.repo ||
            !this.issueNumber
        ) {

            return {
                success: false,
                error:
                    'GitHub sozlamalari yetishmaydi.'
            };
        }

        const result =
            await this.githubRequest(
                `/repos/${this.owner}/${this.repo}/issues/${this.issueNumber}/comments`,
                'POST',
                {
                    body:
                        String(body || '')
                }
            );

        return {
            success: true,
            result
        };
    }

    githubRequest(
        path,
        method = 'GET',
        body = null
    ) {

        return new Promise(
            (resolve, reject) => {

                const data =
                    body
                        ? JSON.stringify(body)
                        : null;

                const request =
                    https.request(
                        {
                            hostname:
                                'api.github.com',

                            path,

                            method,

                            headers:
                                {
                                    'Authorization':
                                        `Bearer ${this.token}`,

                                    'Accept':
                                        'application/vnd.github+json',

                                    'X-GitHub-Api-Version':
                                        '2022-11-28',

                                    'User-Agent':
                                        'Minecraft-AI-Agent',

                                    ...(data
                                        ? {
                                            'Content-Type':
                                                'application/json',

                                            'Content-Length':
                                                Buffer
                                                    .byteLength(
                                                        data
                                                    )
                                        }
                                        : {})
                                }
                        },
                        response => {

                            let raw = '';

                            response.on(
                                'data',
                                chunk => {
                                    raw +=
                                        chunk;
                                }
                            );

                            response.on(
                                'end',
                                () => {

                                    const status =
                                        response.statusCode ||
                                        0;

                                    let parsed =
                                        raw;

                                    try {

                                        parsed =
                                            raw
                                                ? JSON.parse(
                                                    raw
                                                )
                                                : null;

                                    } catch {
                                        // JSON bo'lmasa raw qoladi
                                    }

                                    if (
                                        status >= 200 &&
                                        status < 300
                                    ) {

                                        resolve(
                                            parsed
                                        );

                                    } else {

                                        reject(
                                            new Error(
                                                `GitHub API ${status}: ${
                                                    parsed?.message ||
                                                    raw ||
                                                    'Unknown error'
                                                }`
                                            )
                                        );
                                    }
                                }
                            );
                        }
                    );

                request.on(
                    'error',
                    reject
                );

                if (data) {
                    request.write(
                        data
                    );
                }

                request.end();
            }
        );
    }

    getStatus() {

        return {

            running:
                this.running,

            configured:
                Boolean(
                    this.token &&
                    this.owner &&
                    this.repo &&
                    this.issueNumber
                ),

            owner:
                this.owner,

            repo:
                this.repo,

            issueNumber:
                this.issueNumber,

            lastCommentId:
                this.lastCommentId,

            pollInterval:
                this.pollInterval
        };
    }
}

const githubGateway =
    new GitHubGateway();

module.exports =
    githubGateway;

module.exports.GitHubGateway =
    GitHubGateway;
