/******************************************************************************
 * plot.js - extract plottable data from model training on a given dataset
 *           useful for analyzing a trader's behavior
 *****************************************************************************/

const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const utils = require('./lib/utils');
const csv = require('./lib/csv');
const config = require('./config');
const dt = require('./lib/datatools');

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
        } else if (action == "BID") {
            candle.bid = trader.bidPrice;
        } else if (action == "ASK") {
            candle.ask = trader.askPrice;
        } else {
            console.log("unknown action: " + action);
        }
    }

    await utils.displayTrader(trader);

    console.log(`[*] saving trade data as CSV into file: ${outputFilePath}`);
    csv.setTradeData(outputFilePath, btcData);
}

const plotModel = async function(name, outputFilePath) {
    // load model class
    let Model = require('./models/prediction/' + name);
    let m = new Model();
    await m.load();

    let modelType = null;
    if (name.indexOf('Price') !== -1) {
        modelType = "price";
    } else if (name.indexOf('Trend') !== -1) {
        modelType = "trend";
    } else {
        throw "Can not detect model type";
    }

    // fetch btc data
    let btcData = await csv.getData();
    if (modelType == "trend") {
        btcData = dt.labelTrends(btcData, 0.01, 0.01);
    }

    // add candles for prediction adjustement
    let nbInput = m.getNbInputPeriods() + 4;

    // make the trader trade on all data
    let candles = btcData;
    let inputs = candles.slice(0, nbInput - 1);
    for (var j = nbInput; j < candles.length; j++) {
        let candle = candles[j]; // current bitcoin data
        inputs.push(candle);

        if (modelType == "price") {
            let prediction = await m.predict(inputs);
            if (j < candles.length - 1) {
                candles[j].prediction = prediction;
            }

            if (m.adjustedPredict) {
                let adjustedPrediction = await m.adjustedPredict(inputs);
                if (j < candles.length - 1) {
                    candles[j].adjustedPrediction = adjustedPrediction;
                }
            }
        } else if (modelType == "trend") {
            let prediction = await m.predict(inputs);
            if (j < candles.length - 1) {
                candles[j].predictedTrend = prediction.trend;
                candles[j].predictedProbability = prediction.probability;
            }
        }

        inputs.shift(); // remove 1st element that is not relevant anymore
    }

    console.log(`[*] Saving prediction data as CSV into file: ${outputFilePath}`);
    if (modelType == "price") {
        csv.setPricePredictionData(outputFilePath, btcData);
    } else if (modelType == "trend") {
        csv.setTrendPredictionData(outputFilePath, btcData);
    } else {
        throw "Unknown model type: " + modelType;
    }
}

var plot = async function(type, name, outputFilePath) {
    if (type == "trader") {
        await plotTrader(name, outputFilePath);
    } else if (type == "model") {
        await plotModel(name, outputFilePath);
    }
}

module.exports = plot;