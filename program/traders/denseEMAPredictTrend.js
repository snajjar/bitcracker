const Trader = require('./trader');
const _ = require('lodash');
const tulind = require('tulind');
const tf = require('@tensorflow/tfjs-node');
const datatools = require('../lib/datatools');
const config = require('../../config');
const DensePriceTrendPredictionModel = require('../models/prediction/densePriceTrendPrediction');

class DenseEMAPredictTrendTrader extends Trader {
    constructor() {
        super();
        this.emaPeriods = 5;
        this.emaTrigger = 0.333;
    }

    getDescription() {
        return "Use EMA to predict uptrends, then check it against a dense neural network trained to predict prices variations";
    }

    async initialize() {
        this.model = new DensePriceVariationPredictionModel();
        let interval = config.getInterval();
        await this.model.load(interval);
        await this.model.initialize();
    }

    analysisIntervalLength() {
        return Math.max(this.model.getNbInputPeriods(), this.emaPeriods) + 1;
    }

    hash() {
        return "ML_DenseEMAPredictVar";
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
    async predictTrend(dataPeriods) {
        return await this.model.predict(dataPeriods);
    }

    // decide for an action
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate ema indicator
        try {
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];

            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let upTrend = diff < -this.emaTrigger;
            let downTrend = diff > this.emaTrigger;

            if (!this.isInTrade()) {
                if (upTrend) {
                    // validate EMA strategy with next prediction
                    let prediction = await this.predictTrend(dataPeriods);
                    if (prediction == "up") {
                        // BUY condition
                        return this.buy();
                    } else {
                        return this.hold();
                    }
                } else {
                    return this.hold();
                }
            } else {
                if (downTrend) {
                    // validate EMA strategy with next prediction
                    let prediction = await this.predictTrend(dataPeriods);
                    if (prediction == "down") {
                        // SELL conditions are take profit and stop loss
                        return this.sell();
                    } else {
                        return this.hold();
                    }
                } else {
                    return this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = DenseEMAPredictTrendTrader;