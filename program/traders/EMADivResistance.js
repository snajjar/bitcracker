const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');

class EMADivResistanceTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.trendStrengh = 0.006;


        this.trend = "still";
    }

    analysisIntervalLength() {
        return 50;
    }

    hash() {
        return "Algo_EMADivResistance";
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

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];

            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let upTrend = -0.333;
            let downTrend = +0.333;
            let trendUp = diff < upTrend;
            let trendDown = diff > downTrend;

            if (!this.inTrade) {
                if (trendUp) {
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
                if (trendDown) {
                    // SELL conditions are take profit and stop loss
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

module.exports = EMADivResistanceTrader;