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

    addStrike(userId) {
        if (!this.data[userId]) {
            this.data[userId] = { strikes: 0 };
        }
        this.data[userId].strikes += 1;
        this.save();
        return this.data[userId].strikes;
    }

    getStats(userId) {
        if (!this.data[userId]) return 0;
        return this.data[userId].strikes || 0;
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
}

module.exports = Database;
