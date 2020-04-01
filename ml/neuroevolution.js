/******************************************************************************
 * neuroevolution.js - train bots to trade on bitcoin with a neuroevolution algorithm
 *****************************************************************************/

const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');
const utils = require('./utils');
const modelData = require('./model');
const csv = require('./csv');

const buyTax = 0.0026;
const sellTax = 0.0016;

const nbDataInput = modelData.nbDataInput;

// The main idea is to spawn a population of traders
// each trader can make 3 possible decisions:
// - BUY (0.26% fee)
// - HOLD
// - SELL (0.16% fee)
// each will start with a value of 1000€
// At the end of the provided period, the top traders (or the last ones that were alive) will be selected for reproduction

class Trader {
    constructor(m) {
        if (m) {
            this.model = m;
        } else {
            this.model = tf.sequential({
                layers: [
                    tf.layers.dense({ inputShape: [nbDataInput], units: nbDataInput * 4, activation: 'relu' }),
                    tf.layers.dropout(0.8),
                    tf.layers.dense({ units: nbDataInput * 2, activation: 'relu' }),
                    tf.layers.dropout(0.8),
                    tf.layers.dense({ units: nbDataInput, activation: 'relu' }),
                    tf.layers.dropout(0.8),
                    tf.layers.dense({ units: 3, activation: 'softmax' }),
                ]
            });
        }

        this.btcWallet = 0;
        this.eurWallet = 1000;
    }

    async action(inputTensor, currentBitcoinPrice) {
        let outputTensor = this.model.predict(inputTensor);
        //outputTensor.print();
        let arr = await outputTensor.data();
        tf.dispose(outputTensor);

        // get the action from the output
        var maxVal = _.max(arr);
        var index = arr.indexOf(maxVal);

        switch (index) {
            case 0:
                this.buy(currentBitcoinPrice);
                return "SELL";
            case 1:
                this.hold(currentBitcoinPrice);
                return "HOLD";
            case 2:
                this.sell(currentBitcoinPrice);
                return "BUY";
            default:
                throw "Unrecognized action of index: " + index;
        }
    }

    score(currentBitcoinPrice) {
        return this.eurWallet + this.btcWallet * currentBitcoinPrice;
    }

    buy(currentBitcoinPrice) {
        if (this.eurWallet > 0) {
            this.btcWallet += (this.eurWallet * (1 - buyTax)) / currentBitcoinPrice;
            this.eurWallet = 0;
        }
        console.log(`Trader choose to BUY at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
    }

    sell(currentBitcoinPrice) {
        if (this.btcWallet > 0) {
            this.btcWallet += (this.eurWallet * (1 - sellTax)) * currentBitcoinPrice;
            this.eurWallet = 0;
        }
        console.log(`Trader choose to SELL at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
    }

    hold(currentBitcoinPrice) {
        // doing nothing is what i do best
        console.log(`Trader choose to HOLD at €${currentBitcoinPrice} (score: ${this.score(currentBitcoinPrice)})`);
    }
}

var main = async function() {
    // load data from CSV
    const btcData = await csv.getData(`./data/Cex_BTCEUR_15m_Refined.csv`);
    const trader = new Trader();

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

    let inputs = btcData.slice(0, modelData.nbPeriods - 1);
    for (var i = modelData.nbPeriods - 1; i < btcData.length; i++) {
        let candle = btcData[i]; // current bitcoin data
        inputs.push(candle);
        let inputTensor = getInputTensor(inputs);
        let currentBitcoinPrice = candle.close; // close price of the last candle
        await trader.action(inputTensor, currentBitcoinPrice);

        tf.dispose(inputTensor);
        inputs.shift(); // remove 1st element that is not relevant anymore
    }
}

main();