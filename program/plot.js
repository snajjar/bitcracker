/******************************************************************************
 * plot.js - extract plottable data from model training on a given dataset
 *           useful for analyzing a trader's behavior
 *****************************************************************************/

const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const utils = require('./lib/utils');
const csv = require('./lib/csv');
const config = require('./config');

const getTrader = async function(name) {
    let TraderConstructor = require('./traders/' + name);
    if (!TraderConstructor) {
        console.error(`Trader ${name} is not implemented (yet!)`);
        process.exit(-1);
    }

    let trader = new TraderConstructor();
    await trader.initialize(config.getInterval());
    return trader;
}

const plotTrader = async function(name, outputFilePath) {
    let trader = await getTrader(name);
    let btcData = await csv.getData();

    let trades = [];
    let lastAction = "SELL";
    let lastActionPrice = 0;

    // make the trader trade on all data
    let candles = btcData;
    let inputs = candles.slice(0, trader.analysisIntervalLength() - 1);
    for (var j = trader.analysisIntervalLength(); j < candles.length; j++) {
        let candle = candles[j]; // current bitcoin data
        inputs.push(candle);
        let currentBitcoinPrice = candle.close; // close price of the last candle
        let action = await trader.decideAction(inputs);
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

    await utils.displayTrader(trader);

    console.log(`[*] saving trade data as CSV into file: ${outputFilePath}`);
    csv.setTradeData(outputFilePath, btcData);
}

const plotModel = async function(name, outputFilePath) {
    let btcData = await csv.getData();

    // load model class
    let Model = require('./models/prediction/' + name);
    let m = new Model();
    await m.load();

    // add candles for prediction adjustement
    let nbInput = m.getNbInputPeriods() + 4;

    // make the trader trade on all data
    let candles = btcData;
    let inputs = candles.slice(0, nbInput - 1);
    for (var j = nbInput; j < candles.length; j++) {
        let candle = candles[j]; // current bitcoin data
        inputs.push(candle);

        let prediction = await m.predict(inputs);
        if (j < candles.length - 1) {
            candles[j].prediction = prediction;
        }

        let adjustedPrediction = await m.adjustedPredict(inputs);
        if (j < candles.length - 1) {
            candles[j].adjustedPrediction = adjustedPrediction;
        }

        inputs.shift(); // remove 1st element that is not relevant anymore
    }

    console.log(`[*] saving prediction data as CSV into file: ${outputFilePath}`);
    csv.setPredictionData(outputFilePath, btcData);
}

var plot = async function(type, name, outputFilePath) {
    if (type == "trader") {
        await plotTrader(name, outputFilePath);
    } else if (type == "model") {
        await plotModel(name, outputFilePath);
    }
}

module.exports = plot;