const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAAndStochasticTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 5;
        this.stochasticPeriods = 120;
    }

    analysisIntervalLength() {
        return Math.max(this.emaPeriods, this.stochasticPeriods) + 1;
    }

    hash() {
        return "Algo_EMAAndStochastic";
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

    getStochastic(dataPeriods) {
        let highPrices = _.map(dataPeriods, p => p.high);
        let lowPrices = _.map(dataPeriods, p => p.low);
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.stoch.indicator([highPrices, lowPrices, closePrices], [14, 3, 3], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    // decide for an action
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            // compute trend with EMA
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];

            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let upTrend = -0.5;
            let downTrend = +0.5;
            let trendUp = diff < upTrend;
            let trendDown = diff > downTrend;

            // compute momentum with stochastic
            let stoch = await this.getStochastic(dataPeriods);
            let lastStoch = stoch[0][stoch[0].length - 1];
            let oversell = lastStoch < 70;
            let overbought = lastStoch > 30;

            if (!this.isInTrade()) {
                if (trendUp && oversell) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (trendDown || overbought) {
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

module.exports = EMAAndStochasticTrader;