const Trader = require('../trader');
const tulind = require('tulind');
const _ = require('lodash');

class EMAxSMATrader extends Trader {
    constructor() {
        super();

        // parameters
        this.smaPeriods = 200;
        this.emaPeriods = 5;
        this.takeProfitRatio = 0.02;
        this.stopLossRatio = 0.01;

        // trade decision making
        this.inTrade = false;
        this.enterTradeValue = 0;
    }

    analysisIntervalLength() {
        return Math.max(this.smaPeriods, this.emaPeriods);
    }

    hash() {
        return "Algo_EMAxSMA";
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
        // calculate sma indicator
        try {
            let sma = await this.getSMA(dataPeriods);
            let ema = await this.getEMA(dataPeriods);

            let currSMA = sma[sma.length - 1];
            let currEMA = ema[ema.length - 1];
            let prevSMA = sma[sma.length - 2];
            let prevEMA = ema[ema.length - 2];

            if (!this.inTrade) {
                if (prevEMA < prevSMA && currEMA >= currSMA) {
                    // BUY condition
                    this.inTrade = true;
                    this.enterTradeValue = currentBitcoinPrice;
                    this.buy();
                } else {
                    this.hold();
                }
            } else {
                if (currentBitcoinPrice < this.enterTradeValue * (1 - this.stopLossRatio)) {
                    // SELL condition: stop loss
                    this.inTrade = false;
                    this.enterTradeValue = 0;
                    this.sell(currentBitcoinPrice);
                } else if (currentBitcoinPrice >= this.enterTradeValue * (1 + this.takeProfitRatio)) {
                    // SELL condition: take profit
                    this.inTrade = false;
                    this.enterTradeValue = 0;
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

module.exports = EMAxSMATrader;