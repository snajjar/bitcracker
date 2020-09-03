const Trader = require('./trader');
const _ = require('lodash');
const indicators = require('../lib/indicators');
const dt = require('../lib/datatools');

class EMACrossOverTrader extends Trader {
    constructor() {
        super();

        // parameters
        this.ema1Period = 7;
        this.ema2Period = 200;
        this.candlePeriod = 5;
        this.risk = 0.03;

        // price is low
        this.zoneTreshold = 0.04; // - we are on the lowest 4% of price amplitude of history
        this.minZoneVolatility = 1.03; // - we observe at least 4% volatility on the period history (150 candles)
    }

    analysisIntervalLength() {
        return 700;
    }

    hash() {
        return "Algo_EMACrossOver";
    }

    getObjective() {
        return this.currentTakeProfit;
    }

    getStopLoss() {
        return this.currentStopLoss;
    }


    // decide for an action
    async action(asset, candles, price) {
        // calculate sma indicator
        try {
            if (!this.isInTrade()) {
                let ema1 = await indicators.getEMA(candles, this.ema1Period);
                let ema2 = await indicators.getEMA(candles, this.ema2Period);
                let currEMA1 = ema1[ema1.length - 1];
                let currEMA2 = ema2[ema2.length - 1];
                let prevEMA1 = ema1[ema1.length - 2];
                let prevEMA2 = ema2[ema2.length - 2];

                let buySignal = prevEMA1 < prevEMA2 && currEMA1 > currEMA2;
                let trendUp = price.marketBuy > currEMA2;

                // check is the asset price has been dropping down lately, increase the chance of our position to be positive
                let assetVolatility = indicators.getVolatility(candles);
                let highest = indicators.getHighest(candles);
                let lowest = indicators.getLowest(candles);
                let amplitude = highest - lowest;
                let priceDroppedRecently = assetVolatility > this.minZoneVolatility && price.marketBuy < lowest + amplitude * this.zoneTreshold;

                if (buySignal && trendUp && priceDroppedRecently) {
                    // BUY condition
                    return this.buy();
                } else {
                    return this.hold();
                }
            } else {
                if (!this.currentStopLoss || !this.currentTakeProfit) {
                    let taxes = this.getBuyTax() + this.getSellTax();
                    let atr = indicators.getATR(candles);
                    this.currentStopLoss = this.currentTrade.enterPrice * (1 - this.risk - atr + taxes);
                    this.currentTakeProfit = this.currentTrade.enterPrice * (1 + this.risk + atr + taxes);
                    // console.log(`Setting ATR=${atr} SL=${this.currentStopLoss} TP=${this.currentTakeProfit}`);
                }

                if (price.marketSell >= this.getObjective()) {
                    this.log('Position hit take profit');
                    this.currentStopLoss = null;
                    this.currentTakeProfit = null;
                    return this.sell();
                } else if (price.lastTraded <= this.getStopLoss()) {
                    this.log('Position hit stoploss');
                    //this.wait[asset] = 300; // wait 5h
                    this.currentStopLoss = null;
                    this.currentTakeProfit = null;
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

module.exports = EMACrossOverTrader;