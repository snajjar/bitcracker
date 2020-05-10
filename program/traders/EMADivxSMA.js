const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAxSMATrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 1000;
        this.emaPeriods = 5;
        this.emaTrigger = 0.333;
    }

    analysisIntervalLength() {
        return Math.max(this.smaPeriods, this.emaPeriods) + 1;
    }

    hash() {
        return "Algo_EMADivxSMA";
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

    // decide for an action
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let sma = await this.getSMA(dataPeriods);
            let ema = await this.getEMA(dataPeriods);

            let currSMA = sma[sma.length - 1];
            let currEMA = ema[ema.length - 1];
            let prevSMA = sma[sma.length - 2];
            let prevEMA = ema[ema.length - 2];

            // compute EMA diff
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let bigDown = diff < -this.emaTrigger;
            let bigUp = diff > this.emaTrigger;

            let priceUnderSMA = currentBitcoinPrice < currSMA;

            let prevBitcoinPrice = dataPeriods[dataPeriods.length - 2].close;
            let priceDownCrossingSMA = currentBitcoinPrice < currSMA && prevBitcoinPrice >= prevSMA;

            if (!this.inTrade) {
                if (bigDown && priceUnderSMA) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (priceDownCrossingSMA) {
                    return this.sell();
                } else {
                    // SELL conditions are take profit and stop loss
                    return this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = EMAxSMATrader;