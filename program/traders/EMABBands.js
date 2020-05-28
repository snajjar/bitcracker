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
        this.bbandTrigger = 0.014;
    }

    analysisIntervalLength() {
        //return Math.max(this.emaPeriods, this.adxPeriods) + 1;
        return 28;
    }

    hash() {
        return "Algo_EMABBand";
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

    getBBands(dataPeriods) {
        let closePrices = _.map(dataPeriods, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.bbands.indicator([closePrices], [20, 2], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve([results[0], results[1], results[2]]);
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
            // determine trend with EMA
            let ema = await this.getEMA(dataPeriods);
            let currEMA = ema[ema.length - 1];
            var diff = (currentBitcoinPrice / currEMA * 100) - 100;
            let trendUp = diff < -this.emaTrigger;
            let trendDown = diff > this.emaTrigger;

            // determine trend strengh with ADX
            // let adx = await this.getADX(dataPeriods);
            // let lastADX = adx[adx.length - 1];
            // let trendSeemsStrong = !isNaN(lastADX) && lastADX > this.adxTrigger;

            // get Bollinger bands, check if the standard deviation is increasing
            let [lowBand, midBand, highBand] = await this.getBBands(dataPeriods);
            let newDiff = highBand[highBand.length - 1] - currentBitcoinPrice;
            let diffRatio = newDiff / currentBitcoinPrice;
            let priceChannelOK = diffRatio > this.bbandTrigger;

            // if (trendUp) {
            //     console.log("DiffRatio:", diffRatio, "bbandTrigger:", this.bbandTrigger);
            // }

            //console.log(bbands);

            if (!this.isInTrade()) {
                if (trendUp && priceChannelOK) {
                    // BUY condition
                    return this.buy();
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

module.exports = EMAADXTrader;