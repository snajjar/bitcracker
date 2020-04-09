const csvParser = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const _ = require('lodash');
const moment = require('moment');
const fs = require('fs-extra');
const utils = require('./utils');

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

// make sure the price starting point is where the endpoint is
const equalize = function(data) {
    let endValue = data[data.length - 1].close;

    let startIndex = 0;
    for (var i = 0; i < data.length; i++) {
        if (data[i].low < endValue && endValue < data[i].high) {
            startIndex = i;
            break;
        }
    }

    return data.slice(startIndex);
}

const getDataForInterval = async function(interval) {
    let btcData = null;
    //let adjustedDataFile = `./data/Cex_BTCEUR_${utils.intervalToStr(interval)}_Refined_Adjusted.csv`;
    let dataFile = `./data/Cex_BTCEUR_${utils.intervalToStr(interval)}_Refined.csv`;

    /*
    if (fs.existsSync(adjustedDataFile)) {
        btcData = await getData(adjustedDataFile);
    } else
    */

    if (fs.existsSync(dataFile)) {
        btcData = await getData(dataFile);
    } else {
        console.error(`[*] Error: could not find .csv file ${adjustedDataFile} or ${dataFile}`);
        process.exit(-1);
    }

    return equalize(btcData);
}

const getData = async function(csvFilePath) {
    let btcData = [];
    const csvData = await getDataFromCSV(csvFilePath);
    let i = 0;
    _.each(csvData, (row, index) => {
        i++;
        _.each(row, v => {
            if (isNaN(v) || isNaN(parseFloat(v)) || parseFloat(v) === null) {
                console.log('Error: null or NaN found in CSV file, line: ' + i);
                console.log(row);
                process.exit(-1);
            }
        });

        btcData.push({
            "timestamp": parseInt(row.timestamp),
            "open": parseFloat(row.Open),
            "high": parseFloat(row.High),
            "low": parseFloat(row.Low),
            "close": parseFloat(row.Close),
            "volume": parseFloat(row.Volume)
        });
    });
    return btcData;
}

const setData = async function(csvFilePath, data) {
    let csvWriter = createCsvWriter({
        path: csvFilePath,
        header: [
            { id: 'timestamp', title: 'timestamp' },
            { id: 'open', title: 'Open' },
            { id: 'high', title: 'High' },
            { id: 'low', title: 'Low' },
            { id: 'close', title: 'Close' },
            { id: 'volume', title: 'Volume' },
        ]
    });

    var records = [];
    _.each(data, (period) => {
        records.push({
            timestamp: period.timestamp,
            open: period.open,
            high: period.high,
            low: period.low,
            close: period.close,
            volume: period.volume,
        });
    });

    return csvWriter.writeRecords(records); // promise
}

const setTradeData = async function(csvFilePath, data) {
    let csvWriter = createCsvWriter({
        path: csvFilePath,
        header: [
            { id: 'date', title: 'Date' },
            { id: 'open', title: 'Open' },
            { id: 'high', title: 'High' },
            { id: 'low', title: 'Low' },
            { id: 'close', title: 'Close' },
            { id: 'action', title: 'Action' },
        ]
    });

    var records = [];
    _.each(data, (period) => {
        records.push({
            date: moment.unix(period.timestamp).format('YYYY-MM-DD hh:mm'),
            open: period.open.toFixed(0),
            high: period.high.toFixed(0),
            low: period.low.toFixed(0),
            close: period.close.toFixed(0),
            action: period.action,
        });
    });

    return csvWriter.writeRecords(records); // promise
}

module.exports = {
    getData,
    setData,
    setTradeData,
    getDataForInterval
}