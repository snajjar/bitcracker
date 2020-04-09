/******************************************************************************
 * plot.js - extract plottable data from model training on a given dataset
 *           useful for analyzing a trader's behavior
 *****************************************************************************/

const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const utils = require('./lib/utils');
const modelData = require('./model');
const csv = require('./lib/csv');
const NeuroTrader = require('./neuroevolution').NeuroTrader;
const utils = require('./lib/utils');

const getInputTensor = function(periodArray) {
    let arr = [];
    _.each(periodArray, (period) => {
        let activatedInputData = modelData.activateInput(period);
        _.each(activatedInputData, (v) => {
            arr.push(v);
        });
    });

    return tf.tensor2d(arr, [1, modelData.nbDataInput], 'float32');
}

var plot = async function(interval) {
    // load data from CSV
    let btcData = await csv.getDataForInterval(interval);
    //let [trainData, testData] = datatools.splitData(btcData, 0.6);

    // load Trader from model
    const model = await tf.loadLayersModel(`file://./models/neuroevolution/generation76/Cex_BTCEUR_4h_Top3/model.json`);
    let trader = new NeuroTrader(model);

    let trades = [];
    let lastAction = "SELL";
    let lastActionPrice = 0;

    // make the trader trade on all data
    let marketData = btcData;
    console.log(`[*] Trading on ${utils.intervalToStr(interval)} test sample`);
    let inputs = marketData.slice(0, modelData.nbPeriods - 1);
    for (var j = modelData.nbPeriods - 1; j < marketData.length; j++) {
        let candle = marketData[j]; // current bitcoin data
        inputs.push(candle);
        let currentBitcoinPrice = candle.close; // close price of the last candle
        let action = await trader.action(inputs, currentBitcoinPrice);
        candle.action = action; // save the action into the candle
        inputs.shift(); // remove 1st element that is not relevant anymore

        if (action == "BUY") {
            if (lastAction == "SELL") {
                lastAction = "BUY";
                lastActionPrice = currentBitcoinPrice;
            }
        } else if (action == "SELL") {
            if (lastAction == "BUY") {
                trades.push(currentBitcoinPrice / lastActionPrice);
                lastAction = "SELL";
                lastActionPrice = currentBitcoinPrice;
            }
        }
    }

    utils.displayTraders([trader]);

    let outputFileName = `./data/Trade_Data_${utils.intervalToStr(interval)}.csv`;
    console.log(`[*] saving trade data into file: ${outputFileName}`);
    csv.setTradeData(outputFileName, btcData);
}

module.exports = plot;