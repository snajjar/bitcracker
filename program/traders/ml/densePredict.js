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
        return "ML_DensePredict";
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

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // get predictions
        let prediction = await this.predictPrice(dataPeriods);

        // buy condition: 2 successive upward predictions
        let bullish = currentBitcoinPrice < prediction;

        // sell condition: 2 successive downward predictions
        let bearish = currentBitcoinPrice > prediction;

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