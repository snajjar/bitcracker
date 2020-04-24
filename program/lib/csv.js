const csvParser = require('csv-parser');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const _ = require('lodash');
const moment = require('moment');
const fs = require('fs-extra');
const utils = require('./utils');
const config = require('../config');
const dt = require('./datatools');

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

const removeBlankLines = function(filePath) {
    var content = fs.readFileSync(filePath, "utf8");
    content = content.replace(/^\s*[\r\n]/gm, '');
    fs.writeFileSync(filePath, content);
}

const getData = async function() {
    console.log('[*] Retrieving bitcoin history...');
    let data = await getDataForInterval(config.getInterval());
    return data;
}

const getDataForInterval = async function(interval) {
    let btcData = null;
    let dataFile = `./data/Cex_BTCEUR_${utils.intervalToStr(interval)}_Refined.csv`;

    if (fs.existsSync(dataFile)) {
        btcData = await getFileData(dataFile);
    } else {
        console.error(`[*] Error: could not find .csv file ${adjustedDataFile} or ${dataFile}`);
        process.exit(-1);
    }

    let startTimestamp = config.getStartDate();
    let endTimestamp = config.getEndDate();

    if (startTimestamp || endTimestamp) {
        if (startTimestamp) {
            btcData = dt.cutDataBefore(startTimestamp, btcData);
        }
        if (endTimestamp) {
            btcData = dt.cutDataAfter(endTimestamp, btcData);
        }
    }

    if (btcData.length === 0) {
        throw 'No bitcoin data is available for the selected period';
    }

    console.log(`[*] Dataset: ${dt.rangeStr(btcData)}`);
    return btcData;
}

const getFileData = async function(csvFilePath) {
    let btcData = [];
    const csvData = await getDataFromCSV(csvFilePath);
    let i = 0;
    _.each(csvData, (row, index) => {
        i++;
        _.each(row, v => {
            if (isNaN(v) || isNaN(parseFloat(v)) || parseFloat(v) === null) {
                console.log(`Error: null or NaN found in CSV file ${csvFilePath}, line: ${i}`);
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

const setFileData = async function(csvFilePath, data) {
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

    return csvWriter.writeRecords(data); // promise
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
            date: moment.unix(period.timestamp).format('YYYY-MM-DD HH:mm'),
            open: period.open.toFixed(0),
            high: period.high.toFixed(0),
            low: period.low.toFixed(0),
            close: period.close.toFixed(0),
            action: period.action,
        });
    });

    return csvWriter.writeRecords(records); // promise
}

const setPricePredictionData = async function(csvFilePath, data) {
    let csvWriter = createCsvWriter({
        path: csvFilePath,
        header: [
            { id: 'date', title: 'Date' },
            { id: 'open', title: 'Open' },
            { id: 'high', title: 'High' },
            { id: 'low', title: 'Low' },
            { id: 'close', title: 'Close' },
            { id: 'prediction', title: 'Prediction' },
            { id: 'adjustedPrediction', title: 'AdjustedPrediction' },
        ]
    });

    var records = [];
    _.each(data, (period) => {
        records.push({
            date: moment.unix(period.timestamp).format('YYYY-MM-DD HH:mm'),
            open: period.open.toFixed(0),
            high: period.high.toFixed(0),
            low: period.low.toFixed(0),
            close: period.close.toFixed(0),
            prediction: period.prediction ? period.prediction.toFixed(0) : "",
            adjustedPrediction: period.adjustedPrediction ? period.adjustedPrediction.toFixed(0) : "",
        });
    });

    return csvWriter.writeRecords(records); // promise
}

const setTrendPredictionData = async function(csvFilePath, data) {
    let csvWriter = createCsvWriter({
        path: csvFilePath,
        header: [
            { id: 'date', title: 'Date' },
            { id: 'open', title: 'Open' },
            { id: 'high', title: 'High' },
            { id: 'low', title: 'Low' },
            { id: 'close', title: 'Close' },
            { id: 'trend', title: 'Trend' },
            { id: 'predictedTrend', title: 'PredictedTrend' },
            { id: 'predictedProbability', title: 'PredictedProbability' },
        ]
    });

    var records = [];
    _.each(data, (period) => {
        records.push({
            date: moment.unix(period.timestamp).format('YYYY-MM-DD HH:mm'),
            open: period.open.toFixed(0),
            high: period.high.toFixed(0),
            low: period.low.toFixed(0),
            close: period.close.toFixed(0),
            trend: period.trend,
            predictedTrend: period.predictedTrend,
            predictedProbability: (period.predictedProbability * 100).toFixed(1) + "%",
        });
    });

    return csvWriter.writeRecords(records); // promise
}

module.exports = {
    getData,
    getFileData,
    setFileData,
    setTradeData,
    setPricePredictionData,
    setTrendPredictionData,
    getDataForInterval,
    removeBlankLines
}