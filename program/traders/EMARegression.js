const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');

class EMARegression extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 20;
        this.confirmation = 3;
        this.amplitude = 0.04;
        this.scalpProfit = 0.04;
    }

    analysisIntervalLength() {
        return Math.max(this.emaPeriods) + this.confirmation;
    }

    hash() {
        return "Algo_EMARegression";
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

    getRegressionCoeff(emaValues) {
        let [a, b] = dt.linearRegression(_.range(emaValues.length), lastEMAs);
        return a;
    }

    // decide for an action
    async action(crypto, candles, currentAssetPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let ema = await this.getEMA(candles);

            let coeffs = [];
            for (var i = this.confirmation - 1; i >= 0; i--) {
                let sampleSize = 10;

                // extract ema values
                let emaValues = ema.slice(ema.length - this.confirmation - sampleSize, ema.length - this.confirmation);

                // compute linear regression
                let [a, b] = dt.linearRegression(_.range(sampleSize), emaValues);
                coeffs.push(a);
            }

            let emaAccelerating = true;
            let emaDecelerating = true;
            let emaOverZero = true;
            for (var i = 1; i < coeffs.length; i++) {
                if (coeffs[i] < coeffs[i - 1]) {
                    emaAccelerating = false;
                }
                if (coeffs[i] > coeffs[i - 1]) {
                    emaDecelerating = false;
                }
                if (coeffs[i - 1] < 0 || coeffs[i] < 0) {
                    emaOverZero = false;
                }
            }

            let priceOverEMA = currentAssetPrice > _.last(ema);

            // console.log('priceUp', priceCrossingSMAUp);
            // console.log('priceDown', priceCrossingSMADown);

            if (!this.isInTrade()) {
                if (emaOverZero && emaAccelerating && priceOverEMA) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                let stopped = this.stopLoss(this.amplitude - this.getSellTax());
                if (stopped) return this.sell();

                if (currentAssetPrice > this.getSellWinningPrice() * (1 + this.scalpProfit) && emaDecelerating) {
                    return this.sell();
                }

                return this.hold();

                // if (emaDecelerating) {
                //     return this.sell();
                // } else {
                //     // SELL conditions are take profit and stop loss
                //     return this.hold();
                // }
            }
        } catch (e) {
            console.error("Err: " + e);
            process.exit(-1);
        }
    }
}

module.exports = EMARegression;