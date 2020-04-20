const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAADXTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 2;
        this.adxPeriods = 14;
        this.emaTrigger = 0.4;
        this.adxTrigger = 13;
    }

    analysisIntervalLength() {
        //return Math.max(this.emaPeriods, this.adxPeriods) + 1;
        return 28;
    }

    hash() {
        return "Algo_EMAADX";
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
    async action(dataPeriods, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            // determine trend with EMA
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let trendUp = diff < -this.emaTrigger;
            let trendDown = diff > this.emaTrigger;

            // determine trend strengh with ADX
            let adx = await this.getADX(dataPeriods);
            let lastADX = adx[adx.length - 1];
            let trendIsStrong = !isNaN(lastADX) && lastADX > this.adxTrigger;

            if (!this.inTrade) {
                if (trendUp && trendIsStrong) {
                    // BUY condition
                    this.buy();
                } else {
                    this.hold();
                }
            } else {
                if (trendDown) {
                    // SELL conditions are take profit and stop loss
                    this.sell();
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

module.exports = EMAADXTrader;