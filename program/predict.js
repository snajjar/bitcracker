/******************************************************************************
 * predict.js - try some prediction based on kraken data
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const axios = require('axios');
const _ = require('lodash');
const colors = require('colors');
const config = require('./config.js');

const debug = function(o) {
    console.log(require('util').inspect(o));
}

const extractFieldsFromKrakenData = function(arr) {
    return {
        "timestamp": arr[0],
        "open": arr[1],
        "high": arr[2],
        "low": arr[3],
        "close": arr[4],
        "volume": arr[6],
    }
}

const getKrakenData = async function(interval) {
    let response = await axios.get(`https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=${interval}`);
    let results = response.data.result["XXBTZEUR"];

    let periods = [];
    _.each(results, r => {
        periods.push(extractFieldsFromKrakenData(r));
    });
    return _.sortBy(periods, p => p.timestamp);
}

const predict = async function(modelName, adjusted) {
    // load model class
    let Model = require('./models/prediction/' + modelName);
    let model = new Model();
    await model.load();

    // get btcdata
    let btcData = await getKrakenData(config.getInterval());

    let predicted;
    if (adjusted) {
        predicted = await model.adjustedPredict(btcData);
    } else {
        predicted = await model.predict(btcData);
    }

    console.log(`prediction=${JSON.stringify(predicted)}`);
}

module.exports = predict;