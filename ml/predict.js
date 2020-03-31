/******************************************************************************
 * predict.js - try some prediction based on kraken data
 *****************************************************************************/

const tf = require('@tensorflow/tfjs-node');
const axios = require('axios');
const _ = require('lodash');
const config = require('./config');
const utils = require('./utils');
const colors = require('colors');

const debug = function(o) {
    console.log(require('util').inspect(o));
}

const getKrakenData = async function() {
    let response = await axios.get("https://api.kraken.com/0/public/OHLC?pair=BTCEUR&interval=60");
    return response.data.result["XXBTZEUR"];
}

const getBtcData = async function() {
    let kData = await getKrakenData();

    // we need the nbPeriods last items
    let relevantData = kData.slice(kData.length - config.nbPeriods);
    relevantData = _.sortBy(relevantData, ['0']);
    let arr = [];
    _.each(relevantData, (period) => {
        arr.push(utils.priceScaleDown(parseInt(period[1]))); // open
        arr.push(utils.priceScaleDown(parseInt(period[2]))); // high
        arr.push(utils.priceScaleDown(parseInt(period[3]))); // low
        arr.push(utils.priceScaleDown(parseInt(period[4]))); // close
        arr.push(utils.priceScaleDown(parseInt(period[5]))); // vwap
        //arr.push(parseInt(period[6])); // volume
    });
    return arr;
}

const getModel = async function() {
    const model = await tf.loadLayersModel('file://./models/supervised/Kraken_BTCEUR_1h/model.json');
    return model;
}

const main = async function() {
    let model = await getModel();

    let inputData = await getBtcData();
    let inputTensor = tf.tensor2d([inputData], [1, inputData.length], 'float32');
    inputTensor.print();

    let outputTensor = model.predict(inputTensor);
    outputTensor.print();
    let arr = await outputTensor.data();

    tf.dispose(inputTensor);
    tf.dispose(outputTensor);

    let closeValue = utils.priceScaleUp(arr[0]);
    let lowValue = utils.priceScaleUp(arr[1]);
    let highValue = utils.priceScaleUp(arr[2]);

    console.log(`Predicting next bitcoin value between ${lowValue.toFixed(2).red}€ and ${highValue.toFixed(2).green}€, closing at ${closeValue.toFixed(2)}€`);

    //let direction = arr[2] > 0.5 ? 'UP'.green : 'DOWN'.red;
    //console.log(`Predicting next bitcoin value between ${lowValue.toFixed(2).red}€ and ${highValue.toFixed(2).green}€, going ${direction}`);
}

main();