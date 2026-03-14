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
            } catch (e) {
                console.error(`Error parsing ${this.filePath}, starting fresh.`, e);
                this.data = {};
            }
        } else {
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

    addOffense(userId, contentType = 'unknown') {
        if (!this.data[userId]) {
            this.data[userId] = { offenses: [] };
        }
        if (!this.data[userId].offenses) {
            // Migrate legacy strike-only records
            this.data[userId].offenses = [];
        }
        this.data[userId].offenses.push({
            timestamp: new Date().toISOString(),
            contentType
        });
        this.save();
        return this.data[userId].offenses;
    }

    getOffenses(userId) {
        if (!this.data[userId] || !this.data[userId].offenses) return [];
        return this.data[userId].offenses;
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

    getAllUserStats(days = 30) {
        const stats = {};
        const now = Date.now();
        const windowMs = days * 86400000;

        for (const [userId, userData] of Object.entries(this.data)) {
            if (userId === '_system') continue;
            if (!userData.offenses) {
                stats[userId] = 0;
                continue;
            }
            const count = userData.offenses.filter(o =>
                now - new Date(o.timestamp).getTime() < windowMs
            ).length;
            stats[userId] = count;
        }
        return stats;
    }
}

module.exports = Database;
