const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class ADXAndStochastic extends Trader {
    constructor() {
        super();
    }

    analysisIntervalLength() {
        return 27;
    }

    hash() {
        return "Algo_ADX_and_stochastic";
    }

    getStochastic(dataPeriods) {
        let highPrices = _.map(dataPeriods, p => p.high);
        let lowPrices = _.map(dataPeriods, p => p.low);
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.stoch.indicator([highPrices, lowPrices, closePrices], [14, 3, 3], function(err, results) {
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
            tulind.indicators.adx.indicator([highPrices, lowPrices, closePrices], [14], function(err, results) {
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
            let stoch = await this.getStochastic(dataPeriods);
            let lastStoch = stoch[stoch.length - 1];

            let adx = await this.getADX(dataPeriods);
            let lastADX = adx[adx.length - 1];
            // console.log("stoch:", lastStoch);
            // console.log("adx:", lastADX);

            if (!this.inTrade) {
                if (lastStoch < 20 && lastADX > 25) {
                    // BUY condition: oversell and strong trend
                    this.buy();
                } else {
                    this.hold();
                }
            } else {
                if (lastStoch > 70 || lastADX < 20) {
                    // SELL condition: overbought or trend loosing strengh
                    this.sell(currentBitcoinPrice);
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

module.exports = ADXAndStochastic;