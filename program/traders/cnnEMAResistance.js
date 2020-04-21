const Trader = require('./trader');
const _ = require('lodash');
const tulind = require('tulind');
const dt = require('../lib/datatools');
const config = require('../config');
const CNNPriceVariationPredictionModel = require('../models/prediction/cnnPriceVariationPrediction');

class TraderCNNEMAPredictVar extends Trader {
    constructor() {
        super();
        this.emaPeriods = 2;
        this.emaTrigger = 0.333;
        this.trendStrengh = 0.006;
    }

    getDescription() {
        return "Use EMA to predict uptrends, then check it against a dense neural network trained to predict prices variations";
    }

    async initialize() {
        this.model = new CNNPriceVariationPredictionModel();
        let interval = config.getInterval();
        await this.model.load(interval);
        await this.model.initialize();
    }

    analysisIntervalLength() {
        return Math.max(this.model.getNbInputPeriods(), this.emaPeriods) + 1;
    }

    hash() {
        return "ML_CNNEMAPredictVar";
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

    getNextResistancePrice(periods, currentBitcoinPrice) {
        periods = dt.labelTrends(periods, this.trendStrengh, this.trendStrengh);

        let downTrendPeriods = _.filter(periods, p => p.trend == "down");
        let resistancePeriods = _.filter(downTrendPeriods, p => p.high > currentBitcoinPrice);
        let nextResistance = _.minBy(resistancePeriods, p => p.high);

        if (nextResistance) {
            // return avg of the down trend start period, so we make sure
            return nextResistance.high;
        } else {
            return null;
        }
    }

    // predict next bitcoin price from period
    async predictPrice(dataPeriods) {
        return await this.model.predict(dataPeriods);
    }

    getNextResistancePrice(periods, currentBitcoinPrice) {
        periods = dt.labelTrends(periods, this.trendStrengh, this.trendStrengh);

        let downTrendPeriods = _.filter(periods, p => p.trend == "down");
        let resistancePeriods = _.filter(downTrendPeriods, p => p.high > currentBitcoinPrice);
        let nextResistance = _.minBy(resistancePeriods, p => p.high);

        if (nextResistance) {
            // return avg of the down trend start period, so we make sure
            return nextResistance.high;
        } else {
            return null;
        }
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
                    if (currentBitcoinPrice < prediction) {
                        // find the last resistance
                        let lastResistancePrice = this.getNextResistancePrice(dataPeriods, currentBitcoinPrice);
                        if (lastResistancePrice) {
                            if (currentBitcoinPrice * (1 + this.buyTax + this.sellTax) < lastResistancePrice) {
                                // BUY condition
                                return this.buy();
                            } else {
                                return this.hold();
                            }
                        } else {
                            return this.buy();
                        }
                    } else {
                        return this.hold();
                    }
                } else {
                    return this.hold();
                }
            } else {
                if (downTrend) {
                    return this.sell();
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

module.exports = TraderCNNEMAPredictVar;