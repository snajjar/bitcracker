const Trader = require('../trader');
const _ = require('lodash');
const tf = require('@tensorflow/tfjs-node');

class TraderDense extends Trader {
    constructor() {
        super();
    }

    async initialize() {
        this.model = await tf.loadLayersModel(`file://./models/supervised/Cex_BTCEUR_1m/model.json`);
    }

    analysisIntervalLength() {
        return 10; // model trained on 10 periods
    }

    hash() {
        return "ML_Dense";
    }

    // predict next bitcoin price from period
    async predictPrice(dataPeriods) {
        let closed = _.map(dataPeriods, p => p.close); // get closed prices
        let inputTensor = tf.tensor2d([closed], [1, closed.length], 'float32');
        let outputTensor = this.model.predict(inputTensor);
        let arr = await outputTensor.data();
        let predicted = arr[0];
        tf.dispose(inputTensor);
        tf.dispose(outputTensor);
        return predicted;
    }

    // get n predictions
    async getPredictions(dataPeriods, n) {
        let predictions = [];
        let closed = _.map(dataPeriods, p => p.close); // get closed prices

        for (var i = 0; i < n; i++) {
            let inputTensor = tf.tensor2d([closed], [1, closed.length], 'float32');
            let outputTensor = this.model.predict(inputTensor);
            let arr = await outputTensor.data();
            let predicted = arr[0];
            tf.dispose(inputTensor);
            tf.dispose(outputTensor);
            predictions.push(predicted);

            closed.shift();
            closed.push(predicted);
        }

        return predictions;
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // get predicted price. If it's 1% above current price, buy
        // if it's 1% below current price, sell
        //let predicted = await this.predictPrice(dataPeriods);
        //console.log(`current: ${currentBitcoinPrice.toFixed(2)}, prediction: ${predicted.toFixed(2)}`);

        // get predictions
        let predictions = await this.getPredictions(dataPeriods, 2);
        //console.log("price: " + currentBitcoinPrice + ", predictions: " + predictions);

        // buy condition: 2 successive upward predictions
        let bullish = currentBitcoinPrice < predictions[0] && predictions[0] < predictions[1];

        // sell condition: 2 successive downward predictions
        let bearish = currentBitcoinPrice > predictions[0] && predictions[0] > predictions[1];

        if (!this.inTrade) {
            if (bullish) {
                // BUY condition
                this.buy();
            } else {
                this.hold();
            }
        } else {
            if (bearish) {
                this.sell();
            } else {
                this.hold();
            }
            //this.hold();
        }
    }
}

module.exports = TraderDense;