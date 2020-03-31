const axios = require('axios');
const _ = require('lodash');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const moment = require('moment');

const debug = function(o) {
    console.log(require('util').inspect(o));
}

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

var csvWriter = null;
var main = async function() {
    const dstFileName = `./data/btcusd/Cex_BTCUSD_1m.csv`;
    csvWriter = createCsvWriter({
        path: dstFileName,
        header: [
            { id: 'timestamp', title: 'timestamp' },
            { id: 'open', title: 'Open' },
            { id: 'high', title: 'High' },
            { id: 'low', title: 'Low' },
            { id: 'close', title: 'Close' },
            { id: 'volume', title: 'Volume' },
        ]
    });

    // get all data
    let d = moment('20150101', 'YYYYMMDD');
    while (true) {
        console.log(`[*] fetching data for ${d.format('DD/MM/YYYY')}`);
        try {
            let data = await getCexData(d);
            await writeDataToCSVFile(data);
            d = d.add(1, 'days');
            await sleep(500);
        } catch (e) {
            console.error('caught error: ' + e);
            console.error('terminating');
            process.exit(-1);
        }
    }
}

main();