const Trader = require('./trader');
const _ = require('lodash');
const tulind = require('tulind');
const tf = require('@tensorflow/tfjs-node');
const datatools = require('../lib/datatools');
const config = require('../config');
const CNNPricePredictionModel = require('../models/prediction/cnnPricePrediction');

class TraderCNNEMAPredict extends Trader {
    constructor() {
        super();

        // tune theses
        this.emaPeriods = 2;
        this.emaTrigger = 0.333;
        this.buyTreshold = 0.002;
        this.sellTreshold = 0.002;
    }

    getDescription() {
        return "Use EMA to predict uptrends, then check it against a dense neural network trained to predict prices variations";
    }

    async initialize() {
        this.model = new CNNPricePredictionModel();
        let interval = config.getInterval();
        await this.model.load(interval);
        await this.model.initialize();
    }

    analysisIntervalLength() {
        return Math.max(this.model.getNbInputPeriods(), this.emaPeriods) + 1;
    }

    hash() {
        return "ML_CNNEMAPredict";
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
        return await this.model.predict(dataPeriods);
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
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

            if (!this.inTrade) {
                if (upTrend) {
                    // validate EMA strategy with next prediction
                    let prediction = await this.predictPrice(dataPeriods);
                    if (currentBitcoinPrice * (1 + this.buyTreshold) < prediction) {
                        // BUY condition
                        this.buy();
                    } else {
                        this.hold();
                    }
                } else {
                    this.hold();
                }
            } else {
                if (downTrend) {
                    // validate EMA strategy with next prediction
                    let prediction = await this.predictPrice(dataPeriods);
                    if (currentBitcoinPrice * (1 - this.sellTreshold) > prediction) {
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

module.exports = TraderCNNEMAPredict;