/******************************************************************************
 * predict.js - try some prediction based on kraken data
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const axios = require('axios');
const _ = require('lodash');
const utils = require('./lib/utils');
const colors = require('colors');

const nbPeriods = 10;

const debug = function(o) {
    console.log(require('util').inspect(o));
}

const getKrakenData = async function(interval) {
    let response = await axios.get(`https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=${interval}`);
    return response.data.result["XXBTZEUR"];
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

const getBtcData = async function(interval) {
    let kData = await getKrakenData(interval);

    // we need the nbPeriods last items
    let relevantData = kData.slice(kData.length - nbPeriods);
    relevantData = _.sortBy(relevantData, ['0']);
    let inputs = [];
    _.each(relevantData, (period) => {
        let data = extractFieldsFromKrakenData(period);
        inputs.push(data.close);
    });

    console.log('inputs: ' + JSON.stringify(inputs));
    return inputs;
}

const getModel = async function(interval) {
    const model = await tf.loadLayersModel(`file://./models/supervised/Cex_BTCEUR_${utils.intervalToStr(interval)}/model.json`);
    return model;
}

const predict = async function(interval) {
    let model = await getModel(interval);

    let inputData = await getBtcData(interval);
    let inputTensor = tf.tensor2d([inputData], [1, inputData.length], 'float32');
    inputTensor.print();

    let outputTensor = model.predict(inputTensor);
    outputTensor.print();
    let arr = await outputTensor.data();

    tf.dispose(inputTensor);
    tf.dispose(outputTensor);

    let output = arr[0];

    console.log(`Predicting next period: price=${output.toFixed(0)}€`);
}

module.exports = predict;