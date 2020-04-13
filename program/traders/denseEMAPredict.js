const Trader = require('./trader');
const _ = require('lodash');
const tulind = require('tulind');
const tf = require('@tensorflow/tfjs-node');

class TraderDense extends Trader {
    constructor() {
        super();

        this.modelPeriods = 10;
        this.emaPeriods = 5;
    }

    async initialize() {
        this.model = await tf.loadLayersModel(`file://./models/supervised/Cex_BTCEUR_1m/model.json`);
    }

    analysisIntervalLength() {
        return Math.max(this.modelPeriods, this.emaPeriods + 1);
    }

    hash() {
        return "ML_DenseEMAPredict";
    }

    getEMA(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.ema.indicator([closePrices], [this.emaPeriods], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
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

        // calculate sma indicator
        try {
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];

            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let upTrend = -0.333;
            let downTrend = +0.333;
            let trendingUp = diff < upTrend;
            let trendingDown = diff > downTrend;

            if (!this.inTrade) {
                if (trendingUp) {
                    // validate EMA strategy with next prediction
                    let prediction = await this.predictPrice(dataPeriods);
                    if (currentBitcoinPrice < prediction) {
                        // BUY condition
                        this.buy();
                    } else {
                        this.hold();
                    }
                } else {
                    this.hold();
                }
            } else {
                if (trendingDown) {
                    // validate EMA strategy with next prediction
                    let prediction = await this.predictPrice(dataPeriods);
                    if (currentBitcoinPrice > prediction) {
                        // SELL conditions are take profit and stop loss
                        this.sell();
                    } else {
                        this.hold();
                    }
                } else {
                    this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = TraderDense;