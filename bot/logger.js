const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

class ChannelLogger {
    constructor(channelName) {
        this.channelName = channelName;
        // Sanitize filename: replace non-alphanumeric (except underscores/hyphens) with underscores
        const safeName = channelName.replace(/[^a-z0-9_-]/gi, '_');
        this.logFile = path.join(LOGS_DIR, `${safeName}.log`);
    }

    _formatMessage(method, args) {
        const ts = new Date().toISOString();
        const content = args.map(arg =>
            typeof arg === 'object' ? JSON.stringify(arg, null, 2) : arg
        ).join(' ');
        return `[${ts}] [${method.toUpperCase()}] ${content}\n`;
    }

    _write(method, ...args) {
        const formatted = this._formatMessage(method, args);

        // Write to file
        fs.appendFileSync(this.logFile, formatted);

        // Also output to console with channel prefix
        const consoleTs = new Date().toTimeString().slice(0, 8);
        console[method](`[${consoleTs}] [${this.channelName}]`, ...args);
    }

    log(...args) {
        this._write('log', ...args);
    }

    warn(...args) {
        this._write('warn', ...args);
    }

    error(...args) {
        this._write('error', ...args);
    }
}

// Global logger for general events
const globalLogger = new ChannelLogger('System');

module.exports = {
    ChannelLogger,
    system: globalLogger
};
