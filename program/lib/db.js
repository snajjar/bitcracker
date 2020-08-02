const csvParser = require('csv-parser');
const sqlite3 = require('sqlite3').verbose();
// const sqlite3 = require('better-sqlite3');
const fs = require('fs-extra');
const moment = require('moment');

class Database {
    constructor() {
        this.db = null;
        fs.ensureDirSync('../data/db');
    }

    connect() {
        this.db = new sqlite3.Database('./data/db/assets.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
            if (err) {
                console.error(err.message);
            } else {
                console.log('[*] Connected to the asset database.');
            }

            this.db.exec('PRAGMA page_size=512;', function(error) {
                if (error) {
                    console.error("Pragma statement didn't work.")
                }
            });
        });
    }

    close() {
        this.db.close((err) => {
            if (err) {
                console.error(err.message);
            }
            console.log('[*] Closed the database connection.');
        });
    }

    async build() {
        await this.run('CREATE TABLE IF NOT EXISTS assets ( timestamp DATETIME PRIMARY KEY )');
    }

    async addAsset(asset) {
        try {
            await this.run(`ALTER TABLE assets ADD ${asset}_OPEN REAL`);
            await this.run(`ALTER TABLE assets ADD ${asset}_HIGH REAL`);
            await this.run(`ALTER TABLE assets ADD ${asset}_LOW REAL`);
            await this.run(`ALTER TABLE assets ADD ${asset}_CLOSE REAL`);
            await this.run(`ALTER TABLE assets ADD ${asset}_VOLUME REAL`);
        } catch (e) {

        }
    }

    upsert(asset, candles) {
        return new Promise(async (resolve, reject) => {
            this.db.serialize(async () => {
                this.db.run('begin transaction');
                var insertQuery = this.db.prepare(`INSERT OR IGNORE INTO assets (timestamp, ${asset}_OPEN, ${asset}_HIGH, ${asset}_LOW, ${asset}_CLOSE, ${asset}_VOLUME) VALUES (?, ?, ?, ?, ?, ?)`);
                var updateQuery = this.db.prepare(`UPDATE assets SET ${asset}_OPEN = ?, ${asset}_HIGH = ?, ${asset}_LOW = ?, ${asset}_CLOSE = ?, ${asset}_VOLUME = ? WHERE timestamp = ?`);

                for (let candle of candles) {
                    let timestamp = moment.unix(candle.timestamp).format('YYYY-MM-DD hh:mm:00');
                    // if (timestamp.endsWith('01:00:00')) {
                    //     console.log(`saving ${asset} for ${moment.unix(candle.timestamp).format('YYYY-MM-DD')}`);
                    // }
                    // console.log(`${asset} adding timestamp ${timestamp}`);

                    insertQuery.run(timestamp, candle.open, candle.high, candle.low, candle.close, candle.volume);
                    updateQuery.run(candle.open, candle.high, candle.low, candle.close, candle.volume, timestamp, function() {
                        if (timestamp.endsWith('01:00:00')) {
                            console.log(`saving ${asset} for ${moment.unix(candle.timestamp).format('YYYY-MM-DD')}`);
                        }
                    });

                    // await this.run(`INSERT OR IGNORE INTO assets (timestamp, ${asset}_OPEN, ${asset}_HIGH, ${asset}_LOW, ${asset}_CLOSE, ${asset}_VOLUME) VALUES ('${timestamp}', ${candle.open}, ${candle.high}, ${candle.low}, ${candle.close}, ${candle.volume})`);
                    // await this.run(`UPDATE assets SET ${asset}_OPEN = ${candle.open}, ${asset}_HIGH = ${candle.high}, ${asset}_LOW = ${candle.low}, ${asset}_CLOSE = ${candle.close}, ${asset}_VOLUME = ${candle.volume}  WHERE timestamp='${timestamp}'`);
                }

                insertQuery.finalize();
                updateQuery.finalize();
                this.db.run("commit", () => {
                    resolve();
                });
            });
        });
    }

    run(command) {
        return new Promise((resolve, reject) => {
            this.db.run(command, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }

    all(query) {
        return new Promise((resolve, reject) => {
            this.db.all(query, [], (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }
}

module.exports = new Database();