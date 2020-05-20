const Trader = require('./trader');
const tulind = require('tulind');
const _ = require('lodash');

class MACDTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 200;
    }

    analysisIntervalLength() {
        return 201;
    }

    hash() {
        return "Algo_MACD";
    }

    getEMA(candles) {
        let closePrices = _.map(candles, p => p.close);
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

    getMACD(candles) {
        let closePrices = _.map(candles, p => p.close);
        return new Promise((resolve, reject) => {
            tulind.indicators.macd.indicator([closePrices], [10, 26, 9], function(err, results) {
                if (err) {
                    reject(err);
                } else {
                    resolve(results);
                }
            });
        });
    }

    // decide for an action
    async action(candles, currentBitcoinPrice) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            // Use MACD to determine buy and sell signals
            let [macd, signal, histo] = await this.getMACD(candles);
            let lastMACD = _.last(macd);
            let lastSignal = _.last(signal);
            let prevMACD = macd[macd.length - 2];
            let prevSignal = signal[signal.length - 2];
            let lastHisto = _.last(histo);

            // console.log("histo: " + _.last(histo));

            // the MACD buy signal is when MACD cross the signal line
            // but we only take that signal when crossing happens way below the histo line
            let treshold = 0.4;
            let macdBuySignal = prevMACD < prevSignal && lastMACD >= lastSignal && lastMACD < -treshold;
            let macdSellSignal = prevMACD > prevSignal && lastMACD <= lastSignal && lastMACD > treshold;

            // We want to trade in the direction of the market. Filter trades with 200 ema
            // check if we are currently in uptrend or downtrend
            let ema = await this.getEMA(candles);
            let lastEMA = _.last(ema);
            let trendUp = currentBitcoinPrice > lastEMA;

            if (!this.inTrade) {
                if (macdBuySignal && trendUp) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (macdSellSignal) {
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

module.exports = MACDTrader;