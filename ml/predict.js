/******************************************************************************
 * predict.js - try some prediction based on kraken data
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const axios = require('axios');
const _ = require('lodash');
const modelData = require('./model');
const utils = require('./utils');
const colors = require('colors');

const debug = function(o) {
    console.log(require('util').inspect(o));
}

const getKrakenData = async function() {
    let response = await axios.get("https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=15");
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

const getBtcData = async function() {
    let kData = await getKrakenData();

    // we need the nbPeriods last items
    let relevantData = kData.slice(kData.length - modelData.nbPeriods);
    relevantData = _.sortBy(relevantData, ['0']);
    let inputs = [];
    _.each(relevantData, (period) => {
        let data = extractFieldsFromKrakenData(period);
        let activatedData = modelData.activateInput(data);
        _.each(activatedData, (v) => {
            inputs.push(v);
        });
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

    let inputData = await getBtcData();
    let inputTensor = tf.tensor2d([inputData], [1, inputData.length], 'float32');
    inputTensor.print();

    let outputTensor = model.predict(inputTensor);
    outputTensor.print();
    let arr = await outputTensor.data();

    tf.dispose(inputTensor);
    tf.dispose(outputTensor);

    let output = modelData.deactivateOutput(arr);

    console.log(`Predicting next period:`);
    _.each(output, (v, k) => {
        console.log(`   ${k}: ${v.toFixed(2)}€`);
    });
}

module.exports = {
    predict
}