const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class SMAScalpTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 250;
        this.diffTrigger = 0.025;
    }

    analysisIntervalLength() {
        return this.smaPeriods + 1;
    }

    hash() {
        return "Algo_SMAScalp";
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


            if (!this.inTrade) {
                let delta = (currSMA - currentBitcoinPrice) / currSMA;
                if (delta > this.diffTrigger) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                let delta = (currentBitcoinPrice - currSMA) / currSMA;
                if (delta > this.diffTrigger) {
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

module.exports = SMAScalpTrader;