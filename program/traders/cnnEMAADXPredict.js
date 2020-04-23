const Trader = require('./trader');
const _ = require('lodash');
const tulind = require('tulind');
const tf = require('@tensorflow/tfjs-node');
const datatools = require('../lib/datatools');
const config = require('../config');
const CNNPricePredictionModel = require('../models/prediction/cnnPricePrediction');

class TraderCNNEMAADXPredict extends Trader {
    constructor() {
        super();

        // tune theses
        this.emaPeriods = 2;
        this.emaTrigger = 0.4;
        this.adxPeriods = 14;
        this.adxTrigger = 13;
        this.buyTreshold = 0.0015;
        this.sellTreshold = 0.0015;
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
        // 28 periods for ADX don't know why it's not 14
        return Math.max(this.model.getNbInputPeriods() + 5, this.emaPeriods, 28) + 1;
    }

    hash() {
        return "ML_CNNEMAADXPredict";
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

    getADX(dataPeriods) {
        let highPrices = _.map(dataPeriods, p => p.high);
        let lowPrices = _.map(dataPeriods, p => p.low);
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.adx.indicator([highPrices, lowPrices, closePrices], [this.adxPeriods], function(err, results) {
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
        return await this.model.adjustedPredict(dataPeriods);
    }

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate ema indicator
        try {
            // determine trend with EMA
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let upTrend = diff < -this.emaTrigger;
            let downTrend = diff > this.emaTrigger;

            // determine trend strengh with ADX
            let adx = await this.getADX(dataPeriods);
            let lastADX = adx[adx.length - 1];
            let trendSeemsStrong = !isNaN(lastADX) && lastADX > this.adxTrigger;

            if (!this.inTrade) {
                if (upTrend && trendSeemsStrong) {
                    // validate strategy with next prediction
                    let prediction = await this.predictPrice(dataPeriods);
                    if (currentBitcoinPrice * (1 + this.buyTreshold) < prediction) {
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
                    // validate strategy with next prediction
                    let prediction = await this.predictPrice(dataPeriods);
                    if (currentBitcoinPrice * (1 - this.sellTreshold) > prediction) {
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

module.exports = TraderCNNEMAADXPredict;