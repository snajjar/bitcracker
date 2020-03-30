const csvParser = require('csv-parser');
const _ = require('lodash');
const moment = require('moment');
const fs = require('fs');

const getDataFromCSV = function(filePath) {
    return new Promise((resolve, reject) => {
        var rows = [];
        fs.createReadStream(filePath)
            .pipe(csvParser())
            .on('data', (row) => {
                rows.push(row);
            })
            .on('end', () => {
                resolve(rows);
            });
    });
}

const fetchData = async function() {
    let btcData = [];
    const csvData = await getDataFromCSV('../data/btceur/Kraken_BTCEUR_1h.csv');
    _.each(csvData.reverse(), (row) => {
        btcData.push({
            "timestamp": moment(row[0], "YYYY-MM-DD hh-A").toDate(),
            "open": parseInt(row[2]),
            "high": parseInt(row[3]),
            "low": parseInt(row[4]),
            "close": parseInt(row[5]),
            "vwap": parseInt(row[6]),
            "volume": parseInt(row[7])
        });
    });
    return btcData;
}

module.exports = {
    fetchData: fetchData
}