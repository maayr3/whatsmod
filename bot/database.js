const fs = require('fs');

class Database {
    constructor(filePath) {
        this.filePath = filePath;
        this.data = {};
    }

    init() {
        if (fs.existsSync(this.filePath)) {
            try {
                const rawData = fs.readFileSync(this.filePath);
                this.data = JSON.parse(rawData);
                this.migrate();
            } catch (e) {
                console.error(`Error parsing ${this.filePath}, starting fresh.`, e);
                this.data = {};
            }
        } else {
            this.save();
        }
    }

    migrate() {
        // Migration: If we find top-level keys that aren't '_system' and have 'offenses',
        // move them into 'LifeRoom' (the default group).
        const keys = Object.keys(this.data);
        const legacyUsers = keys.filter(k => k !== '_system' && this.data[k].offenses);

        if (legacyUsers.length > 0) {
            console.log(`[Database] Migrating ${legacyUsers.length} users to 'LifeRoom' namespace...`);
            if (!this.data['LifeRoom']) {
                this.data['LifeRoom'] = { users: {} };
            }
            if (!this.data['LifeRoom'].users) {
                this.data['LifeRoom'].users = {};
            }

            for (const user of legacyUsers) {
                this.data['LifeRoom'].users[user] = this.data[user];
                delete this.data[user];
            }
            this.save();
        }
    }

    save() {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
        } catch (e) {
            console.error('Failed to save database to disk:', e);
        }
    }

    _ensureChannel(channelId) {
        if (!this.data[channelId]) {
            this.data[channelId] = { users: {} };
        }
        if (!this.data[channelId].users) {
            this.data[channelId].users = {};
        }
    }

    addOffense(channelId, userId, contentType = 'unknown') {
        this._ensureChannel(channelId);
        const users = this.data[channelId].users;

        if (!users[userId]) {
            users[userId] = { offenses: [] };
        }
        if (!users[userId].offenses) {
            users[userId].offenses = [];
        }
        users[userId].offenses.push({
            timestamp: new Date().toISOString(),
            contentType
        });
        this.save();
        return users[userId].offenses;
    }

    getOffenses(channelId, userId) {
        if (!this.data[channelId] || !this.data[channelId].users || !this.data[channelId].users[userId]) return [];
        return this.data[channelId].users[userId].offenses || [];
    }

    setSystemState(key, value) {
        if (!this.data._system) {
            this.data._system = {};
        }
        this.data._system[key] = value;
        this.save();
    }

    getSystemState(key) {
        if (!this.data._system) return null;
        return this.data._system[key];
    }

    getAllUserStats(channelId, days = 30) {
        if (!this.data[channelId] || !this.data[channelId].users) return {};

        const stats = {};
        const now = Date.now();
        const windowMs = days * 86400000;

        for (const [userId, userData] of Object.entries(this.data[channelId].users)) {
            if (!userData.offenses) {
                stats[userId] = [];
                continue;
            }
            const filtered = userData.offenses.filter(o =>
                now - new Date(o.timestamp).getTime() < windowMs
            );
            stats[userId] = filtered.map(o => ({
                timestamp: o.timestamp,
                reason: o.contentType
            }));
        }
        return stats;
    }
}

module.exports = Database;
