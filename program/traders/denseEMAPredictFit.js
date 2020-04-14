const Trader = require('./trader');
const _ = require('lodash');
const tulind = require('tulind');
const tf = require('@tensorflow/tfjs-node');
const config = require('../../config');
const DensePricePredictionModel = require('../models/prediction/densePricePrediction');

class TraderDenseEMAPredictFit extends Trader {
    constructor() {
        super();

        this.predictionFitPeriods = 5; // nb of periods in which we try to compute the fit
        this.modelPeriods = 10;
        this.emaPeriods = 5;

        this.maxAvgFitError = 0.0085;
    }

    getDescription() {
        return "Same as denseEMAPredict, but try to be smarter and evaluate a few known prices to calculate accuracy, and invest only if accuracy is good";
    }

    async initialize(interval) {
        this.model = new DensePricePredictionModel();
        let interval = config.getInterval();
        await this.model.load(interval);
        await this.model.initialize();
    }

    analysisIntervalLength() {
        return Math.max(this.model.getNbInputPeriods(), this.emaPeriods) + 1;
    }

    hash() {
        return "ML_DenseEMAPredictFit";
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
        return await this.model.predict(dataPeriods);
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

module.exports = TraderDenseEMAPredictFit;