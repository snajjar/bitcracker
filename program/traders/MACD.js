const Trader = require('./trader');
const indicators = require('../lib/indicators');
const _ = require('lodash');
const dt = require('../lib/datatools');

class MACDTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.emaPeriods = 200;
        this.candlePeriod = 5;

        // If we lower this value we are loosing more trades than we win.
        this.risk = 0.01; // 3% risk per trade
    }

    analysisIntervalLength() {
        return 30 * this.candlePeriod;
    }

    hash() {
        return "Algo_MACD";
    }

    getObjective() {
        return this.currentTakeProfit;
    }

    getStopLoss() {
        return this.currentStopLoss;
    }

    // decide for an action
    async action(asset, candles, price) {
        // let stopped = this.stopLoss(this.stopLossRatio);
        // if (stopped) return;

        // stopped = this.takeProfit(this.takeProfitRatio);
        // if (stopped) return;

        // calculate sma indicator
        try {
            // Use MACD to determine buy and sell signals
            let mergedCandles = dt.mergeCandlesBy(candles, this.candlePeriod);
            let [macd, signal, histo] = await indicators.getMACD(mergedCandles);
            let lastMACD = macd[macd.length - 1];
            let prevMACD = macd[macd.length - 2];
            let lastSignal = signal[signal.length - 1];
            let prevSignal = signal[signal.length - 2];
            let lastHisto = _.last(histo);

            // console.log(lastMACD);
            // console.log(lastSignal);
            // console.log(prevMACD);
            // console.log(prevSignal);


            // console.log("histo: " + _.last(histo));

            // the MACD buy signal is when MACD cross the signal line
            // but we only take that signal when crossing happens way below the histo line

            let treshold = 0.01;
            let macdBuySignal = prevMACD < prevSignal && lastMACD >= lastSignal && lastMACD < -5;
            let macdSellSignal = prevMACD > prevSignal && lastMACD <= lastSignal;


            // We want to trade in the direction of the market. Filter trades with 200 ema
            // check if we are currently in uptrend or downtrend
            let ema = await indicators.getEMA(candles, this.emaPeriods);
            let lastEMA = _.last(ema);
            let trendUp = price.marketBuy > lastEMA;

            if (!this.isInTrade()) {
                // if (macdBuySignal) {
                //     console.log('BUY SIGNAL at ' + price.marketBuy);
                //     console.log(`MACD: ${prevMACD} -> ${lastMACD}`);
                //     console.log(`Sig : ${prevSignal} -> ${lastSignal}`);
                //     console.log(`Histo: ${lastHisto}`);
                // }

                if (macdBuySignal && trendUp) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                // if (macdSellSignal) {
                //     // console.log(`MACD: ${prevMACD} -> ${lastMACD}`);
                //     // console.log(`Sig : ${prevSignal} -> ${lastSignal}`);
                //     console.log('SELL SIGNAL at ' + price.marketBuy);
                //     console.log(`MACD: ${prevMACD} -> ${lastMACD}`);
                //     console.log(`Sig : ${prevSignal} -> ${lastSignal}`);
                //     console.log(`Histo: ${lastHisto}`);
                // }

                if (!this.currentStopLoss || !this.currentTakeProfit) {
                    let taxes = this.getBuyTax() + this.getSellTax();
                    let atr = indicators.getATR(candles);
                    this.currentStopLoss = this.currentTrade.enterPrice * (1 - this.risk - atr + taxes);
                    this.currentTakeProfit = this.currentTrade.enterPrice * (1 + this.risk + atr + taxes);
                    // console.log(`Setting ATR=${atr} SL=${this.currentStopLoss} TP=${this.currentTakeProfit}`);
                }

                if (macdSellSignal) {
                    return this.sell();
                } else {
                    // SELL conditions are take profit and stop loss
                    return this.hold();
                }

                // if (price.marketSell >= this.getObjective()) {
                //     this.log('Position hit take profit');
                //     this.currentStopLoss = null;
                //     this.currentTakeProfit = null;
                //     return this.sell();
                // } else if (price.lastTraded <= this.getStopLoss()) {
                //     this.log('Position hit stoploss');
                //     this.currentStopLoss = null;
                //     this.currentTakeProfit = null;
                //     return this.sell();
                // } else {
                //     return this.hold();
                // }
            }
        } catch (e) {
            console.error("Err: " + e.stack);
            process.exit(-1);
        }
    }
}

module.exports = MACDTrader;