const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class VariableEMAADXTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.adxPeriods = 14;
        this.emaTrigger = 0.4;
        this.adxTrigger = 13;
    }

    analysisIntervalLength() {
        return 28;
    }

    hash() {
        return "Algo_VariableEMAADX";
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

    // decide for an action
    async action(crypto, dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let trendUp, trendDown;

            if (this.isInTrade()) {
                // the more we past our objective, the more we want to pay attention
                // price variations.
                let objectiveRatio = currentBitcoinPrice / this.objective;
                trendDown = diff > this.emaTrigger / Math.pow(objectiveRatio, 1.7);
            } else {
                trendUp = diff < -this.emaTrigger;
            }

            // determine trend strengh with ADX
            let adx = await this.getADX(dataPeriods);
            let lastADX = adx[adx.length - 1];
            let trendSeemsStrong = !isNaN(lastADX) && lastADX > this.adxTrigger;

            if (!this.isInTrade()) {
                if (trendUp && trendSeemsStrong) {
                    // BUY condition

                    this.objective = currentBitcoinPrice * (1 + this.getBuyTax() + this.getSellTax());

                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (trendDown) {
                    // SELL conditions are take profit and stop loss
                    this.objective = null;
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

module.exports = VariableEMAADXTrader;