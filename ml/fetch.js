const axios = require('axios');
const _ = require('lodash');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const moment = require('moment');
const fs = require('fs-extra');
const csv = require('./lib/csv');

const getKrakenData = async function(interval, since = 0) {
    let apiUrl = `https://api.kraken.com/0/public/OHLC?pair=BTCUSD&interval=${interval}&since=${since}`;
    let response = await axios.get(apiUrl);

    if (response.error) {
        console.error(response.error);
        process.exit(-1);
    }

    return [response.data];
}

const getCexData = async function(day) {
    let apiUrl = `https://cex.io/api/ohlcv/hd/${moment(day).format('YYYYMMDD')}/BTC/EUR`;
    let response = await axios.get(apiUrl);

    if (response.error) {
        console.error(response.error);
        process.exit(-1);
    }

    let stringifiedData = response.data["data1m"];
    let data = JSON.parse(stringifiedData);
    return data;
}

const sleep = function(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

const writeDataToCSVFile = function(data) {
    var records = [];
    _.each(data, (period) => {
        records.push({
            timestamp: period[0],
            open: period[1],
            high: period[2],
            low: period[3],
            close: period[4],
            volume: period[5],
        });
    });

    return csvWriter.writeRecords(records); // promise
}

let getExistingData = async function(pair, source) {
    let filePath = getRawFilePath(pair, source);
    if (fs.existsSync(filePath)) {
        return await csv.getData(filePath);
    } else {
        return [];
    }
}

let getRawFilePath = function(pair, source) {
    return `./data/${source}_${pair}_1m.csv`;
}

var csvWriter = null;
const fetch = async function(pair, source, continueFromLast) {
    let data = continueFromLast ? await getExistingData(pair, source) : [];
    let lastDataWritten = null;
    let d = null;

    csvWriter = createCsvWriter({
        path: getRawFilePath(pair, source),
        header: [
            { id: 'timestamp', title: 'timestamp' },
            { id: 'open', title: 'Open' },
            { id: 'high', title: 'High' },
            { id: 'low', title: 'Low' },
            { id: 'close', title: 'Close' },
            { id: 'volume', title: 'Volume' },
        ]
    });

    if (continueFromLast) {
        // find last day of data we have, start over from that day
        let lastTimestamp = null;
        for (var i = data.length - 1; i >= 0; i--) {
            let lastData = data[i];
            lastTimestamp = lastData.timestamp;
            if (lastTimestamp && !isNaN(lastTimestamp)) {
                break;
            }
        }
        if (lastTimestamp) {
            lastDataWritten = moment.unix(lastTimestamp);
            d = moment(lastDataWritten).startOf('day').subtract(1, 'day');

            // delete existing data from that day
            // for (var i = data.length - 1; i >= 0; i--) {
            //     let date = moment.unix(data[i].timestamp);
            //     if (date.isAfter(d)) {
            //         data.pop(); // remove that element
            //     }
            // }
            await csvWriter.writeRecords(data);
        } else {
            d = moment('20150101', 'YYYYMMDD');
        }
    } else {
        d = moment('20150101', 'YYYYMMDD');
    }

    // get all data
    let yesterday = moment().startOf('day').subtract(1, 'day');
    while (d.isBefore(yesterday)) {
        console.log(`[*] fetching data for ${d.format('DD/MM/YYYY')}`);
        try {
            let newData = await getCexData(d);

            // check if it's not data we already have
            let firstDataDate = moment.unix(newData[0][0]);
            if (lastDataWritten && lastDataWritten.isAfter(firstDataDate)) {
                // cut the new data to add only relevant stuff
                let startIndex = 0;
                for (startIndex = 0; startIndex < newData.length; startIndex++) {
                    let newDataDate = moment.unix(newData[startIndex][0]);
                    if (lastDataWritten.isBefore(newDataDate)) {
                        break;
                    }
                }
                newData = newData.slice(startIndex);
            }

            await writeDataToCSVFile(newData);
            d = d.add(1, 'days');
            await sleep(500);
        } catch (e) {
            console.error('caught error: ' + e);
            console.error('terminating');
            process.exit(-1);
        }
    }
}

module.exports = fetch;