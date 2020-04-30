const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class BuyLowSellHighTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.diffTrigger = 0.003;

        // parameters
        this.emaPeriods = 3;
        this.emaTrigger = 0.3;

        this.count = 0;
    }

    analysisIntervalLength() {
        return 1440;
    }

    hash() {
        return "Algo_buyLowSellHigh";
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

    priceGrowing(candles, price) {
        let prevCandle = candles[candles.length - 2];
        let lastCandle = candles[candles.length - 1];

        return prevCandle.high + prevCandle.low < lastCandle.high + lastCandle.low;
    }

    // decide for an action
    async action(candles, currentBitcoinPrice) {
        // let stopped = this.stopLoss(0.03);
        // if (stopped) return;

        // stopped = this.takeProfit(0.01);
        // if (stopped) return;

        // calculate sma indicator
        try {
            let lowest = +Infinity;
            let highest = -Infinity;
            for (var i = 0; i < candles.length; i++) {
                if (candles[i].close < lowest) {
                    lowest = candles[i].close;
                }
                if (candles[i].close > highest) {
                    highest = candles[i].close;
                }
            }

            let n = candles.length;
            let growth = currentBitcoinPrice > candles[n - 2].close;

            let closeToLastLowest = currentBitcoinPrice * (1 - this.diffTrigger) < lowest;
            let closeToLastHighest = currentBitcoinPrice * (1 + this.diffTrigger) > highest;
            let diffVar = (highest - lowest) / lowest;


            if (!this.inTrade) {
                if (diffVar > 0.01 && closeToLastLowest && this.priceGrowing(candles)) {
                    // BUY condition
                    // console.log(`BUYING at ${currentBitcoinPrice.toFixed(0)}€ (lowest: ${lowest.toFixed(0)}€, highest: ${highest.toFixed(0)}€)`);
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (closeToLastHighest) {
                    // SELL conditions are take profit and stop loss
                    // console.log(`SELLING at ${currentBitcoinPrice.toFixed(0)} (lowest: ${lowest.toFixed(0)}€, highest: ${highest.toFixed(0)}€)`);
                    // console.log(`Profit: ${(currentBitcoinPrice - this.enterTradeValue * 1.0046).toFixed(0)}€`);
                    return this.sell();
                } else {
                    this.count++;
                    return this.hold();
                }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = BuyLowSellHighTrader;