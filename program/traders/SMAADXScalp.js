const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class SMAADXScalpTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 250;
        this.adxPeriods = 14;
        this.diffTrigger = 0.025;
        this.adxTrigger = 25;
    }

    analysisIntervalLength() {
        return Math.max(this.adxPeriods, this.smaPeriods) + 1;
    }

    hash() {
        return "Algo_SMAADXScalp";
    }

    getSMA(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.sma.indicator([closePrices], [this.smaPeriods], function(err, results) {
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

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let sma = await this.getSMA(dataPeriods);
            let currSMA = sma[sma.length - 1];

            // determine trend strengh with ADX
            let adx = await this.getADX(dataPeriods);
            let lastADX = adx[adx.length - 1];
            let trendSeemsStrong = !isNaN(lastADX) && lastADX > this.adxTrigger;

            if (!this.inTrade) {
                let delta = (currSMA - currentBitcoinPrice) / currSMA;
                if (delta > this.diffTrigger && !trendSeemsStrong) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                let delta = (currentBitcoinPrice - currSMA) / currSMA;
                if (delta > this.diffTrigger && trendSeemsStrong) {
                    // SELL conditions are take profit and stop loss
                    return this.sell();
                } else {
                    return this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e);
            process.exit(-1);
        }
    }
}

module.exports = SMAADXScalpTrader;