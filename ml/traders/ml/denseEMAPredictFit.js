const Trader = require('../trader');
const _ = require('lodash');
const tulind = require('tulind');
const tf = require('@tensorflow/tfjs-node');

class TraderDense extends Trader {
    constructor() {
        super();

        this.predictionFitPeriods = 5; // nb of periods in which we try to compute the fit
        this.modelPeriods = 10;
        this.emaPeriods = 5;

        this.maxAvgFitError = 0.0085;
    }

    async initialize() {
        this.model = await tf.loadLayersModel(`file://./models/supervised/Cex_BTCEUR_1m/model.json`);
    }

    analysisIntervalLength() {
        return Math.max(this.modelPeriods, this.emaPeriods + 1) + this.predictionFitPeriods;
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

    // try to predict the last [this.predictionFitPeriods] prices we got in the data periods, and compute the avg error
    async getPredictionFitError(dataPeriods) {
        let predictions = [];
        let realValues = _.map(dataPeriods.slice(this.modelPeriods), candle => candle.close);
        let periods = dataPeriods.slice(0, this.modelPeriods - 1);
        for (var i = this.modelPeriods; i < dataPeriods.length; i++) {
            let candle = dataPeriods[i];
            periods.push(candle);
            let predicted = await this.predictPrice(periods);
            predictions.push(predicted);
            periods.shift(); // remove the last period
        }

        let fitErrors = [];
        for (var i = 0; i < predictions.length; i++) {
            fitErrors[i] = Math.abs(realValues[i] - predictions[i]);
        }

        return _.mean(fitErrors);
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

        let avgFitError = await this.getPredictionFitError(dataPeriods);

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
                    let lastPeriods = dataPeriods.slice(dataPeriods.length - this.modelPeriods);
                    let prediction = await this.predictPrice(lastPeriods);
                    if (currentBitcoinPrice < prediction && avgFitError < this.maxAvgFitError * currentBitcoinPrice) {
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
                    let lastPeriods = dataPeriods.slice(dataPeriods.length - this.modelPeriods);
                    let prediction = await this.predictPrice(lastPeriods);
                    if (currentBitcoinPrice > prediction && avgFitError < this.maxAvgFitError * currentBitcoinPrice) {
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