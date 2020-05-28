const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');
const dt = require('../lib/datatools');

class EMADivTrader extends Trader {
    constructor() {
        super();

        this.emaPeriods1 = 2;
        this.emaPeriods2 = 5;
        this.emaPeriods3 = 8;
        this.emaPeriods4 = 11;
        this.candlePeriod = 60 * 12;
    }

    analysisIntervalLength() {
        return this.emaPeriods4 * this.candlePeriod;
    }

    hash() {
        return "Algo_EMA4";
    }

    getEMA(candles, period) {
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.ema.indicator([closePrices], [period], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results[0]);
                }
            });
        });
    }

    // decide for an action
    async action(crypto, candles, currentAssetPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let mergedCandles = dt.mergeCandlesBy(candles, this.candlePeriod);

            let ema1 = await this.getEMA(mergedCandles, this.emaPeriods1);
            let ema2 = await this.getEMA(mergedCandles, this.emaPeriods2);
            let ema3 = await this.getEMA(mergedCandles, this.emaPeriods3);
            let ema4 = await this.getEMA(mergedCandles, this.emaPeriods4);

            let lastEma1 = _.last(ema1);
            let lastEma2 = _.last(ema2);
            let lastEma3 = _.last(ema3);
            let lastEma4 = _.last(ema4);

            let upTrend = lastEma1 > lastEma2 && lastEma2 > lastEma3 && lastEma3 > lastEma4;

            // console.log('candles: ' + candles);
            // console.log('ema1: ', lastEma1);
            // console.log('ema2: ', lastEma2);
            // console.log('ema3: ', lastEma3);
            // console.log('ema4: ', lastEma4);
            // console.log('uptrend: ', upTrend);

            if (!this.isInTrade()) {
                if (upTrend) {
                    // BUY condition
                    return this.bid(currentAssetPrice);
                } else {
                    return this.hold();
                }
            } else {
                if (!upTrend) {
                    // SELL conditions are take profit and stop loss
                    return this.ask(currentAssetPrice);
                } else {
                    return this.hold();
                }
                // if (this.takeProfit(0.002)) {
                //     return this.sell();
                // }

                // if (this.stopLoss(0.002)) {
                //     return this.sell();
                // }

                return this.hold();
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = EMADivTrader;