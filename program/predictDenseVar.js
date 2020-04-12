/******************************************************************************
 * predict.js - try some prediction based on kraken data
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const axios = require('axios');
const _ = require('lodash');
const utils = require('./lib/utils');
const colors = require('colors');
const datatools = require('./lib/datatools');

// number of periods of data we provide to the model to determine the output
const nbPeriods = 5;

// cap maximum variance per period to improve neural net's accuracy
const maxVariancePerPeriod = 0.01;

const debug = function(o) {
    console.log(require('util').inspect(o));
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

// variation is between [1-maxVariance, 1+maxVariance], map this to [0, 1]
let activateVariation = function(x) {
    return (x + maxVariancePerPeriod - 1) / (2 * maxVariancePerPeriod);
}

// output is between [0, 1], map this to [1-maxVariance, 1+maxVariance]
let deactivateVariation = function(x) {
    return x * 2 * maxVariancePerPeriod + 1 - maxVariancePerPeriod;
}

const getInputs = async function(btcData) {
    let btcVariations = datatools.dataVariations(btcData, maxVariancePerPeriod);
    btcVariations = btcVariations.slice(btcData.length - nbPeriods);

    let inputs = [];
    _.each(btcVariations, (period) => {
        inputs.push(activateVariation(period.close));
    });

    console.log('inputs: ' + JSON.stringify(inputs));
    return inputs;
}

const getModel = async function(interval) {
    const model = await tf.loadLayersModel(`file://./models/supervised/Cex_BTCEUR_${utils.intervalToStr(interval)}_Variation/model.json`);
    return model;
}

const predict = async function(interval) {
    let model = await getModel(interval);
    let btcData = await getKrakenData(interval);

    let inputData = await getInputs(btcData);
    let inputTensor = tf.tensor2d([inputData], [1, inputData.length], 'float32');
    inputTensor.print();

    let outputTensor = model.predict(inputTensor);
    outputTensor.print();
    let arr = await outputTensor.data();

    tf.dispose(inputTensor);
    tf.dispose(outputTensor);

    let predictedVariation = deactivateVariation(arr[0]);
    let predictedPrice = btcData[btcData.length - 1].close * predictedVariation;

    console.log(`Predicting next period: variation=${predictedVariation} price=${predictedPrice.toFixed(0)}€`);
}

module.exports = predict;